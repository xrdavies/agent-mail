import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type {
  AgentProfile,
  Delivery,
  Task
} from "@agent-mail/contracts";

import { CentralAuthError, CentralClient } from "./central-client.js";
import type { HostConfig, ManagedMailboxConfig } from "./config.js";
import { buildResumePrompt, createSyntheticSessionId } from "./prompt.js";
import { HostStateStore, type MailboxLocalState } from "./state.js";

export class HostRuntime {
  private readonly client: CentralClient;
  private token: string | null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly startedAt = new Date().toISOString();
  private lastHeartbeatAt: string | null = null;
  private lastAuthenticatedAt: string | null = null;
  private pollInFlight = false;

  constructor(
    readonly config: HostConfig,
    readonly state: HostStateStore
  ) {
    this.client = new CentralClient(config.centralBaseUrl);
    this.token = state.getHostToken();
  }

  async start(): Promise<void> {
    await this.ensureAuthenticated();
    await this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.state.close();
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  getMcpUrl(): string {
    const baseUrl = this.config.publicBaseUrl ?? `http://${this.config.host}:${this.config.port}`;
    return `${baseUrl}/mcp`;
  }

  getHostStatus(): "online" | "degraded" | "auth_failed" {
    if (!this.isAuthenticated()) {
      return "auth_failed";
    }
    const hasFailedMailbox = this.state.listMailboxStates().some((item) => item.runtimeStatus === "failed");
    return hasFailedMailbox ? "degraded" : "online";
  }

  async bootstrapAgent(input: {
    mailbox: string;
    name: string;
    role: string;
    responsibilities: string;
    workspacePath: string;
  }) {
    await this.requireAuthenticated();
    const mailbox = this.requireManagedMailbox(input.mailbox);
    if (path.resolve(mailbox.workspacePath) !== path.resolve(input.workspacePath)) {
      throw new Error("workspacePath must match the configured mailbox workspace");
    }

    const response = await this.client.registerAgent(this.token!, {
      host_id: this.config.hostId,
      mailbox: mailbox.mailbox,
      name: input.name,
      role: input.role,
      responsibilities: input.responsibilities,
      workspace_path: mailbox.workspacePath,
      git_user_name: mailbox.gitUserName,
      git_user_email: mailbox.gitUserEmail
    });

    const sessionId = createSyntheticSessionId(mailbox.mailbox);
    this.state.markBootstrapped({
      mailbox: mailbox.mailbox,
      workspacePath: mailbox.workspacePath,
      gitUserName: mailbox.gitUserName,
      gitUserEmail: mailbox.gitUserEmail,
      name: input.name,
      role: input.role,
      responsibilities: input.responsibilities,
      sessionId
    });
    await this.sendHeartbeat();

    return {
      hostId: this.config.hostId,
      mailbox: mailbox.mailbox,
      workspacePath: mailbox.workspacePath,
      profileStatus: response.profile.profile_status,
      bindingStatus: response.binding.binding_status
    };
  }

  async getOldestUnreadDelivery(mailbox: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    const delivery = await this.client.getOldestUnreadDelivery(this.token!, mailbox);
    if (!delivery) {
      return null;
    }
    return {
      deliveryId: delivery.delivery_id,
      emailId: delivery.email_id,
      threadId: delivery.thread_id,
      recipientMailbox: delivery.recipient_mailbox ?? mailbox,
      readStatus: delivery.read_status,
      createdAt: delivery.created_at
    } as const;
  }

  async getDelivery(mailbox: string, deliveryId: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    const unread = await this.client.listDeliveries(this.token!, mailbox, {
      readStatus: "unread",
      limit: 100,
      order: "oldest_first"
    });
    const read = await this.client.listDeliveries(this.token!, mailbox, {
      readStatus: "read",
      limit: 100,
      order: "newest_first"
    });
    const delivery = [...unread, ...read].find((item) => item.delivery_id === deliveryId);
    if (!delivery) {
      throw new Error("Delivery not found");
    }
    return {
      deliveryId: delivery.delivery_id,
      emailId: delivery.email_id,
      threadId: delivery.thread_id,
      recipientAddress: delivery.recipient_address,
      recipientMailbox: delivery.recipient_mailbox,
      deliveryKind: delivery.delivery_kind,
      readStatus: delivery.read_status,
      createdAt: delivery.created_at
    };
  }

  async getEmail(mailbox: string, emailId: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    return this.client.getEmail(this.token!, emailId);
  }

  async getThread(mailbox: string, threadId: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    return this.client.getThread(this.token!, threadId);
  }

  async markDeliveryRead(mailbox: string, deliveryId: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    const response = await this.client.markDeliveryRead(this.token!, deliveryId, mailbox);
    return {
      ok: true,
      deliveryId: response.delivery_id,
      readStatus: response.read_status,
      readAt: response.read_at
    } as const;
  }

  async sendEmail(input: {
    mailbox: string;
    to: AgentProfile["mailbox"] extends never ? never : { display_name: string; address: string }[];
    cc: { display_name: string; address: string }[];
    subject: string;
    bodyText: string;
    rawBody: string;
    inReplyTo?: string | null;
    references?: string[];
    linkedResources?: {
      url: string;
      title?: string | null;
      mime_type?: string | null;
      size_bytes?: number | null;
    }[];
    emailKind?: "agent_reply" | "agent_delegation" | "agent_receipt" | "system_note";
  }) {
    await this.requireAuthenticated();
    const state = this.requireBootstrappedMailbox(input.mailbox);
    if (!state) {
      throw new Error(`Mailbox ${input.mailbox} has not been bootstrapped`);
    }
    const idempotencyKey = await this.client.issueIdempotencyKey(this.token!, {
      host_id: this.config.hostId,
      mailbox: input.mailbox,
      action: "send_email"
    });
    const response = await this.client.sendEmail(this.token!, {
      idempotency_key: idempotencyKey.idempotency_key,
      mailbox: input.mailbox,
      from: {
        display_name: state.name ?? input.mailbox,
        address: input.mailbox
      },
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body_text: input.bodyText,
      raw_body: input.rawBody,
      raw_headers: {
        from: `${state.name ?? input.mailbox} <${input.mailbox}>`,
        to: input.to.map((item) => `${item.display_name} <${item.address}>`).join(", "),
        cc: input.cc.map((item) => `${item.display_name} <${item.address}>`).join(", "),
        subject: input.subject
      },
      in_reply_to: input.inReplyTo ?? null,
      references: input.references ?? [],
      email_kind: input.emailKind ?? "agent_reply",
      linked_resources: input.linkedResources ?? []
    });
    return {
      emailId: response.email.email_id,
      threadId: response.thread.thread_id,
      messageId: response.email.message_id
    };
  }

  async createTask(input: {
    mailbox: string;
    threadId: string;
    triggerEmailId: string;
    assigneeMailbox: string;
    title: string;
    instructions?: string | null;
    parentTaskId?: string | null;
    requiresArtifact: boolean;
  }) {
    await this.requireAuthenticated();
    this.requireBootstrappedMailbox(input.mailbox);
    const idempotencyKey = await this.client.issueIdempotencyKey(this.token!, {
      host_id: this.config.hostId,
      mailbox: input.mailbox,
      action: "create_task"
    });
    const response = await this.client.createTask(this.token!, {
      idempotency_key: idempotencyKey.idempotency_key,
      mailbox: input.mailbox,
      thread_id: input.threadId,
      trigger_email_id: input.triggerEmailId,
      assignee_mailbox: input.assigneeMailbox,
      title: input.title,
      instructions: input.instructions ?? null,
      parent_task_id: input.parentTaskId ?? null,
      requires_artifact: input.requiresArtifact
    });
    return {
      taskId: response.task_id,
      status: response.status
    };
  }

  async getTask(mailbox: string, taskId: string): Promise<Task> {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    const tasks = await this.client.listTasks(this.token!);
    const visible = tasks.find(
      (task) =>
        task.task_id === taskId &&
        (task.assignee_mailbox === mailbox || task.created_by_mailbox === mailbox)
    );
    if (!visible) {
      throw new Error("Task not found or not visible for mailbox");
    }
    return visible;
  }

  async listTasks(input: {
    mailbox: string;
    threadId?: string;
    status?: "new" | "in_progress" | "paused" | "done" | "blocked";
    parentTaskId?: string;
  }): Promise<Task[]> {
    await this.requireAuthenticated();
    this.requireManagedMailbox(input.mailbox);
    const tasks = await this.client.listTasks(this.token!, {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {})
    });
    return tasks.filter(
      (task) => task.assignee_mailbox === input.mailbox || task.created_by_mailbox === input.mailbox
    );
  }

  async updateTaskStatus(input: {
    mailbox: string;
    taskId: string;
    status: "in_progress" | "paused" | "done" | "blocked";
    completedByEmailId?: string | null;
    artifacts?: {
      repository?: string | null;
      path: string;
      branch?: string | null;
      commit_sha?: string | null;
      pr_link?: string | null;
    }[];
  }) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(input.mailbox);
    return this.client.updateTaskStatus(this.token!, input.taskId, {
      mailbox: input.mailbox,
      status: input.status,
      completed_by_email_id: input.completedByEmailId ?? null,
      artifacts: input.artifacts
    });
  }

  async listAgents(mailbox: string) {
    await this.requireAuthenticated();
    this.requireManagedMailbox(mailbox);
    const agents = await this.client.listAgents(this.token!);
    return agents.map((agent) => ({
      mailbox: agent.mailbox,
      name: agent.name,
      role: agent.role,
      status: agent.profile_status
    }));
  }

  async getStatusPayload() {
    const mailboxes = this.state.listMailboxStates();
    const mailboxStatus = await Promise.all(
      mailboxes.map(async (item) => {
        const pending = this.isAuthenticated() && item.bootstrapped
          ? await this.client.listDeliveries(this.token!, item.mailbox, {
              readStatus: "unread",
              limit: 100,
              order: "oldest_first"
            }).then((rows) => rows.length).catch(() => 0)
          : 0;
        return {
          mailbox: item.mailbox,
          mailbox_runtime_status: item.runtimeStatus,
          current_session_id: item.currentSessionId,
          pending_unread_count: pending
        };
      })
    );

    return {
      host: {
        host_id: this.config.hostId,
        label: this.config.label,
        host_version: this.config.hostVersion,
        host_status: this.getHostStatus(),
        last_heartbeat_at: this.lastHeartbeatAt,
        last_authenticated_at: this.lastAuthenticatedAt,
        created_at: this.startedAt,
        updated_at: new Date().toISOString()
      },
      managed_mailboxes: mailboxes.map((item) => item.mailbox),
      mailbox_status: mailboxStatus
    };
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) {
      try {
        await this.client.registerHost(this.token, {
          host_id: this.config.hostId,
          label: this.config.label,
          bootstrap_key: this.config.bootstrapKey,
          host_version: this.config.hostVersion
        });
        this.lastAuthenticatedAt = new Date().toISOString();
        return;
      } catch (error) {
        if (!(error instanceof CentralAuthError)) {
          throw error;
        }
      }
    }

    const exchange = await this.client.exchangeHostToken({
      host_id: this.config.hostId,
      label: this.config.label,
      bootstrap_key: this.config.bootstrapKey,
      host_version: this.config.hostVersion
    });
    this.token = exchange.host_token;
    this.state.setHostToken(this.token);
    this.lastAuthenticatedAt = exchange.host.last_authenticated_at;
    await this.client.registerHost(this.token, {
      host_id: this.config.hostId,
      label: this.config.label,
      bootstrap_key: this.config.bootstrapKey,
      host_version: this.config.hostVersion
    });
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.token) {
      return;
    }

    try {
      const response = await this.client.heartbeat(this.token, this.config.hostId, {
        host_status: this.getHostStatus(),
        managed_mailboxes: this.state.listMailboxStates().map((item) => ({
          mailbox: item.mailbox,
          binding_status: item.bindingStatus,
          mailbox_runtime_status: item.runtimeStatus,
          workspace_path: item.workspacePath,
          last_processed_delivery_id: item.lastProcessedDeliveryId,
          current_session_id: item.currentSessionId,
          active_task_id: item.activeTaskId,
          latest_summary: item.latestSummary
        }))
      });
      this.lastHeartbeatAt = response.last_heartbeat_at;
    } catch (error) {
      if (error instanceof CentralAuthError) {
        this.handleAuthFailure();
        return;
      }
      console.error("Heartbeat failed:", error);
    }
  }

  private async poll(): Promise<void> {
    if (!this.token || this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      for (const mailbox of this.config.managedMailboxes) {
        const state = this.requireBootstrappedMailbox(mailbox.mailbox, false);
        if (!state) {
          continue;
        }
        if (state.runtimeStatus === "running" || state.runtimeStatus === "failed") {
          continue;
        }
        if (state.nextResumeAfter && Date.parse(state.nextResumeAfter) > Date.now()) {
          continue;
        }

        const delivery = await this.client.getOldestUnreadDelivery(this.token, mailbox.mailbox);
        if (!delivery) {
          continue;
        }
        void this.resumeMailbox(mailbox, state, delivery);
      }
    } catch (error) {
      if (error instanceof CentralAuthError) {
        this.handleAuthFailure();
      } else {
        console.error("Polling failed:", error);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async resumeMailbox(
    mailbox: ManagedMailboxConfig,
    state: MailboxLocalState,
    delivery: Delivery
  ): Promise<void> {
    this.state.markResumeStarted(mailbox.mailbox);
    try {
      const profile = await this.client.getAgentByMailbox(this.token!, mailbox.mailbox);
      const prompt = buildResumePrompt(profile, {
        deliveryId: delivery.delivery_id,
        emailId: delivery.email_id,
        threadId: delivery.thread_id
      });
      const summary = await this.executeResumeCommand(mailbox, prompt);
      this.state.markResumeSuccess(mailbox.mailbox, {
        lastProcessedDeliveryId: delivery.delivery_id,
        latestSummary: summary
      });
      await this.sendHeartbeat();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = this.state.markResumeFailure(mailbox.mailbox, {
        maxFailures: this.config.resumeMaxFailures,
        backoffBaseMs: this.config.resumeBackoffBaseMs,
        errorMessage: message
      });
      console.error(`Resume failed for ${mailbox.mailbox}:`, message);
      if (next.runtimeStatus === "failed") {
        await this.sendHeartbeat();
      }
    }
  }

  private async executeResumeCommand(
    mailbox: ManagedMailboxConfig,
    prompt: string
  ): Promise<string | null> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-mail-host-"));
    const outputPath = path.join(tempDir, "last-message.txt");
    try {
      if (this.config.resumeCommandTemplate) {
        await runProcess("sh", [
          "-lc",
          this.config.resumeCommandTemplate
            .replaceAll("{mailbox}", mailbox.mailbox)
            .replaceAll("{workspacePath}", mailbox.workspacePath)
            .replaceAll("{prompt}", JSON.stringify(prompt))
            .replaceAll("{outputPath}", outputPath)
        ], mailbox.workspacePath);
      } else {
        const args = [
          "exec",
          "-C",
          mailbox.workspacePath,
          ...(this.config.resumeDangerouslyBypass ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
          "resume",
          "--last",
          "--output-last-message",
          outputPath,
          prompt
        ];
        await runProcess("codex", args, mailbox.workspacePath);
      }

      const content = await readFile(outputPath, "utf8").catch(() => "");
      const summary = content.trim();
      return summary.length > 0 ? summary : null;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private handleAuthFailure(): void {
    this.token = null;
    this.state.setHostToken(null);
  }

  private requireManagedMailbox(mailbox: string): ManagedMailboxConfig {
    const match = this.config.managedMailboxes.find((item) => item.mailbox === mailbox);
    if (!match) {
      throw new Error(`Mailbox ${mailbox} is not managed by this host`);
    }
    return match;
  }

  private requireBootstrappedMailbox(mailbox: string, strict = true): MailboxLocalState | null {
    const state = this.state.getMailboxState(mailbox);
    if (!state || !state.bootstrapped) {
      if (strict) {
        throw new Error(`Mailbox ${mailbox} has not been bootstrapped`);
      }
      return null;
    }
    return state;
  }

  private async requireAuthenticated(): Promise<void> {
    if (!this.token) {
      await this.ensureAuthenticated();
    }
    if (!this.token) {
      throw new Error("Host is not authenticated");
    }
  }
}

async function runProcess(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? -1}`));
      }
    });
  });
}
