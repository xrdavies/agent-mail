import { type HostStatus, type RuntimeContext, SESSION_STATUSES, runtimeContextSchema } from "@agent-mail/shared";

import { CentralApiClient, CentralApiError } from "./client.js";
import type { HostConfig, HostMailboxConfig } from "./config.js";
import { CodexSessionResolver } from "./codex-sessions.js";
import type { HostState, PersistedSessionState } from "./state.js";
import { HostStateStore } from "./state.js";

type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionBindingInput = {
  mailbox: string;
  session_id: string;
  session_status: SessionStatus;
};

export type SessionRuntimePatch = {
  session_status?: SessionStatus;
  active_task_id?: string | null;
  last_processed_message_id?: string | null;
  latest_summary?: string | null;
  last_heartbeat_at?: string | null;
};

export type BootstrapSessionInput = {
  mailbox: string;
  role: string;
  name: string;
  workspacePath: string;
};

export type HostServiceOptions = {
  config: HostConfig;
  client: CentralApiClient;
  stateStore: HostStateStore;
  centralBaseUrl: string;
  hostVersion: string;
  machineHeartbeatIntervalMs: number;
  sessionHeartbeatIntervalMs: number;
  sessionResolver?: CodexSessionResolver;
};

type TimerHandle = ReturnType<typeof setInterval>;

export type HostStatusSnapshot = {
  machine_id: string;
  label: string;
  central_base_url: string;
  host_version: string;
  host_status: HostStatus;
  started_at: string;
  last_registration_at: string | null;
  last_machine_heartbeat_at: string | null;
  last_session_heartbeat_at: string | null;
  last_error: string | null;
  mailboxes: Array<
    HostMailboxConfig & {
      current_session: PersistedSessionState | null;
      recent_cleared_session_count: number;
    }
  >;
};

const nowIso = () => new Date().toISOString();

export class HostService {
  private readonly sessionResolver: CodexSessionResolver;
  private state!: HostState;
  private hostStatus: HostStatus = "online";
  private startedAt = nowIso();
  private lastRegistrationAt: string | null = null;
  private lastMachineHeartbeatAt: string | null = null;
  private lastSessionHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private machineTimer: TimerHandle | null = null;
  private sessionTimer: TimerHandle | null = null;

  constructor(private readonly options: HostServiceOptions) {
    this.sessionResolver = options.sessionResolver ?? new CodexSessionResolver();
  }

  async start(): Promise<void> {
    this.state = await this.options.stateStore.load(this.options.config);

    try {
      await this.registerWithCentral();
      await this.sendMachineHeartbeat();
      await this.sendSessionHeartbeats();
    } catch (error) {
      this.recordError(error, "host_start");
    }

    this.machineTimer = setInterval(() => {
      void this.sendMachineHeartbeat();
    }, this.options.machineHeartbeatIntervalMs);

    this.sessionTimer = setInterval(() => {
      void this.sendSessionHeartbeats();
    }, this.options.sessionHeartbeatIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.machineTimer) {
      clearInterval(this.machineTimer);
      this.machineTimer = null;
    }

    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  async registerWithCentral(): Promise<void> {
    await this.options.client.registerMachine({
      machine_id: this.options.config.machine_id,
      label: this.options.config.label,
      host_version: this.options.hostVersion
    });

    for (const mailbox of this.options.config.mailboxes) {
      await this.options.client.registerMailbox({
        ...mailbox,
        machine_id: this.options.config.machine_id
      });
    }

    this.hostStatus = "online";
    this.lastRegistrationAt = nowIso();
    this.lastError = null;
  }

  async sendMachineHeartbeat(): Promise<void> {
    try {
      const result = await this.options.client.sendMachineHeartbeat(
        this.options.config.machine_id,
        "online"
      );
      this.hostStatus = "online";
      this.lastMachineHeartbeatAt = result.last_heartbeat_at;
      this.lastError = null;
    } catch (error) {
      if (error instanceof CentralApiError && error.status === 404) {
        await this.registerWithCentral();
        return this.sendMachineHeartbeat();
      }

      this.recordError(error, "machine_heartbeat");
    }
  }

  async bindSession(input: SessionBindingInput): Promise<PersistedSessionState> {
    const mailboxConfig = this.requireMailboxConfig(input.mailbox);
    const currentMailboxState = this.requireMailboxState(input.mailbox);

    if (
      currentMailboxState.current_session &&
      currentMailboxState.current_session.session_id !== input.session_id &&
      currentMailboxState.current_session.session_status !== "cleared"
    ) {
      throw new Error(
        `Mailbox ${input.mailbox} is already bound to ${currentMailboxState.current_session.session_id}.`
      );
    }

    const centralSession = await this.options.client.bindSession({
      session_id: input.session_id,
      mailbox: input.mailbox,
      machine_id: this.options.config.machine_id,
      workspace_path: mailboxConfig.workspace_path,
      session_status: input.session_status
    });

    const persisted: PersistedSessionState = {
      session_id: centralSession.session_id,
      workspace_path: centralSession.workspace_path,
      session_status: centralSession.session_status,
      active_task_id: centralSession.active_task_id,
      last_processed_message_id: centralSession.last_processed_message_id,
      latest_summary: centralSession.latest_summary,
      last_heartbeat_at: centralSession.last_heartbeat_at,
      started_at: centralSession.started_at,
      cleared_at: centralSession.cleared_at
    };

    this.state.mailboxes[input.mailbox] = {
      ...currentMailboxState,
      current_session: persisted
    };
    await this.persistState();

    return persisted;
  }

  async bootstrapSession(input: BootstrapSessionInput): Promise<RuntimeContext> {
    const mailboxConfig = this.requireMailboxConfig(input.mailbox);

    if (mailboxConfig.role !== input.role) {
      throw new Error(`Mailbox ${input.mailbox} role mismatch: expected ${mailboxConfig.role}.`);
    }

    if (mailboxConfig.name !== input.name) {
      throw new Error(`Mailbox ${input.mailbox} name mismatch: expected ${mailboxConfig.name}.`);
    }

    if (mailboxConfig.workspace_path !== input.workspacePath) {
      throw new Error(
        `Mailbox ${input.mailbox} workspace mismatch: expected ${mailboxConfig.workspace_path}.`
      );
    }

    const codexSession = await this.sessionResolver.findLatestByWorkspace(input.workspacePath);

    if (!codexSession) {
      throw new Error(
        `No Codex session metadata found for workspace ${input.workspacePath}. Start Codex in that workspace first.`
      );
    }

    await this.bindSession({
      mailbox: input.mailbox,
      session_id: codexSession.id,
      session_status: "bootstrapping"
    });

    await this.updateSession(input.mailbox, {
      session_status: "idle"
    });

    await this.sendSessionHeartbeatForMailbox(this.requireMailboxState(input.mailbox));

    return this.getRuntimeContext(input.mailbox);
  }

  getRuntimeContext(mailbox: string): RuntimeContext {
    const mailboxConfig = this.requireMailboxConfig(mailbox);
    const currentSession = this.requireMailboxState(mailbox).current_session;

    return runtimeContextSchema.parse({
      mailbox: mailboxConfig.mailbox,
      role: mailboxConfig.role,
      name: mailboxConfig.name,
      workspace_path: mailboxConfig.workspace_path,
      machine_id: this.options.config.machine_id,
      session_id: currentSession?.session_id ?? null,
      session_status: currentSession?.session_status ?? null,
      active_task_id: currentSession?.active_task_id ?? null,
      last_processed_message_id: currentSession?.last_processed_message_id ?? null,
      latest_summary: currentSession?.latest_summary ?? null
    });
  }

  getCurrentSession(mailbox: string): PersistedSessionState | null {
    return this.requireMailboxState(mailbox).current_session;
  }

  getClient(): CentralApiClient {
    return this.options.client;
  }

  async updateSession(mailbox: string, patch: SessionRuntimePatch): Promise<void> {
    const mailboxState = this.requireMailboxState(mailbox);

    if (!mailboxState.current_session) {
      throw new Error(`Mailbox ${mailbox} does not have an active session.`);
    }

    mailboxState.current_session = {
      ...mailboxState.current_session,
      ...patch
    };

    await this.persistState();
  }

  async clearActiveSession(
    mailbox: string,
    requestedBy = "human-user",
    force = false
  ): Promise<void> {
    const mailboxState = this.requireMailboxState(mailbox);

    if (!mailboxState.current_session) {
      return;
    }

    await this.options.client.clearSession(mailboxState.current_session.session_id, {
      mailbox,
      requested_by: requestedBy,
      force
    });

    await this.markSessionCleared(mailbox);
  }

  async markSessionCleared(mailbox: string): Promise<void> {
    const mailboxState = this.requireMailboxState(mailbox);

    if (!mailboxState.current_session) {
      return;
    }

    const clearedSession: PersistedSessionState = {
      ...mailboxState.current_session,
      session_status: "cleared",
      cleared_at: nowIso()
    };

    mailboxState.current_session = null;
    mailboxState.recent_cleared_sessions = [
      clearedSession,
      ...mailboxState.recent_cleared_sessions
    ].slice(0, 20);

    await this.persistState();
  }

  async sendSessionHeartbeats(): Promise<void> {
    const activeMailboxes = Object.values(this.state.mailboxes).filter(
      (mailbox) => mailbox.current_session && mailbox.current_session.session_status !== "cleared"
    );

    for (const mailboxState of activeMailboxes) {
      await this.sendSessionHeartbeatForMailbox(mailboxState);
    }

    await this.persistState();
  }

  getStatusSnapshot(): HostStatusSnapshot {
    return {
      machine_id: this.options.config.machine_id,
      label: this.options.config.label,
      central_base_url: this.options.centralBaseUrl,
      host_version: this.options.hostVersion,
      host_status: this.hostStatus,
      started_at: this.startedAt,
      last_registration_at: this.lastRegistrationAt,
      last_machine_heartbeat_at: this.lastMachineHeartbeatAt,
      last_session_heartbeat_at: this.lastSessionHeartbeatAt,
      last_error: this.lastError,
      mailboxes: this.options.config.mailboxes.map((mailbox) => ({
        ...mailbox,
        current_session: this.state.mailboxes[mailbox.mailbox]?.current_session ?? null,
        recent_cleared_session_count:
          this.state.mailboxes[mailbox.mailbox]?.recent_cleared_sessions.length ?? 0
      }))
    };
  }

  private async sendSessionHeartbeatForMailbox(mailboxState: HostState["mailboxes"][string]): Promise<void> {
    const currentSession = mailboxState.current_session;

    if (!currentSession || currentSession.session_status === "cleared") {
      return;
    }

    try {
      const result = await this.options.client.sendSessionHeartbeat(currentSession.session_id, {
        mailbox: mailboxState.mailbox,
        session_status: currentSession.session_status,
        active_task_id: currentSession.active_task_id,
        last_processed_message_id: currentSession.last_processed_message_id,
        latest_summary: currentSession.latest_summary
      });

      mailboxState.current_session = {
        ...currentSession,
        last_heartbeat_at: result.last_heartbeat_at
      };
      this.lastSessionHeartbeatAt = result.last_heartbeat_at;
      this.hostStatus = "online";
      this.lastError = null;
    } catch (error) {
      if (error instanceof CentralApiError && error.status === 404) {
        await this.options.client.bindSession({
          session_id: currentSession.session_id,
          mailbox: mailboxState.mailbox,
          machine_id: this.options.config.machine_id,
          workspace_path: currentSession.workspace_path,
          session_status: currentSession.session_status
        });
        return this.sendSessionHeartbeatForMailbox(mailboxState);
      }

      this.recordError(error, `session_heartbeat:${mailboxState.mailbox}`);
    }
  }

  private requireMailboxConfig(mailbox: string): HostMailboxConfig {
    const mailboxConfig = this.options.config.mailboxes.find((item) => item.mailbox === mailbox);

    if (!mailboxConfig) {
      throw new Error(`Unknown local mailbox: ${mailbox}`);
    }

    return mailboxConfig;
  }

  private requireMailboxState(mailbox: string) {
    this.requireMailboxConfig(mailbox);
    return (this.state.mailboxes[mailbox] ??= {
      mailbox,
      current_session: null,
      recent_cleared_sessions: []
    });
  }

  private async persistState(): Promise<void> {
    this.state.updated_at = nowIso();
    await this.options.stateStore.save(this.state);
  }

  private recordError(error: unknown, action: string): void {
    const message = error instanceof Error ? error.message : String(error);
    this.hostStatus = "degraded";
    this.lastError = `${action}: ${message}`;
  }
}
