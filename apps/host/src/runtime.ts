import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentProfile, Delivery, Task } from "@agent-mail/contracts";

import { CentralAuthError, CentralClient } from "./central-client.js";
import type { HostConfig, ManagedMailboxConfig } from "./config.js";
import { buildCodexMcpConfigArgs } from "./codex.js";
import { HostHttpError } from "./errors.js";
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
  private lastAuthError: string | null;
  private pollInFlight = false;
  private readonly mailboxRuns = new Set<string>();

  constructor(
    readonly config: HostConfig,
    readonly state: HostStateStore
  ) {
    this.client = new CentralClient(config.centralBaseUrl);
    this.token = state.getHostToken();
    this.lastAuthError = state.getLastAuthError();
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

  getMcpConfigPayload() {
    const url = this.getMcpUrl();
    return {
      url,
      command: `codex mcp add agent-mail-host --url ${url}`,
      json: {
        mcpServers: {
          "agent-mail-host": {
            url
          }
        }
      },
      toml: `[mcp_servers.agent-mail-host]\nurl = "${url}"\n`
    };
  }

  getHostStatus(): "online" | "degraded" | "auth_failed" {
    if (!this.isAuthenticated()) {
      return "auth_failed";
    }
    const hasFailedMailbox = this.getManagedMailboxStates().some((item) => item.runtimeStatus === "failed");
    return hasFailedMailbox ? "degraded" : "online";
  }

  async bootstrapAgent(input: {
    mailbox: string;
    name: string;
    role: string;
    responsibilities: string;
    workspacePath: string;
  }) {
    const mailbox = this.requireManagedMailbox(input.mailbox);

    try {
      await this.requireAuthenticated();
      await this.assertWorkspaceReady(mailbox.workspacePath);
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
      this.state.recordEvent({
        mailbox: mailbox.mailbox,
        level: "info",
        title: "Bootstrap succeeded",
        message: `Mailbox registered and binding became active on ${this.config.hostId}.`,
        at: new Date().toISOString()
      });
      await this.sendHeartbeat();

      return {
        hostId: this.config.hostId,
        mailbox: mailbox.mailbox,
        workspacePath: mailbox.workspacePath,
        profileStatus: response.profile.profile_status,
        bindingStatus: response.binding.binding_status
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.markBootstrapFailed(mailbox.mailbox, message);
      this.state.recordEvent({
        mailbox: mailbox.mailbox,
        level: "error",
        title: "Bootstrap failed",
        message,
        at: new Date().toISOString()
      });
      throw error;
    }
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

  async reauthenticateHost() {
    try {
      await this.ensureAuthenticated({ forceExchange: true });
      this.state.recordEvent({
        mailbox: null,
        level: "info",
        title: "Host re-authenticated",
        message: `Host ${this.config.hostId} exchanged a fresh Central token.`,
        at: new Date().toISOString()
      });
      await this.sendHeartbeat();
      return {
        ok: true as const,
        host_status: this.getHostStatus(),
        last_authenticated_at: this.lastAuthenticatedAt,
        last_auth_error: this.lastAuthError
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastAuthError = message;
      this.state.setLastAuthError(message);
      this.state.recordEvent({
        mailbox: null,
        level: "error",
        title: "Host re-auth failed",
        message,
        at: new Date().toISOString()
      });
      throw error;
    }
  }

  async resumeMailboxNow(mailbox: string) {
    await this.requireAuthenticated();
    const mailboxConfig = this.requireManagedMailbox(mailbox);
    const state = this.requireBootstrappedMailbox(mailbox);
    if (!state) {
      throw new Error(`Mailbox ${mailbox} has not been bootstrapped`);
    }
    const actions = this.buildAvailableActions(state);

    if (!actions.can_resume_now || this.mailboxRuns.has(mailbox)) {
      return {
        ok: true as const,
        mailbox,
        accepted: false,
        runtime_status: state.runtimeStatus
      };
    }

    const delivery = await this.client.getOldestUnreadDelivery(this.token!, mailbox);
    if (!delivery) {
      return {
        ok: true as const,
        mailbox,
        accepted: false,
        runtime_status: state.runtimeStatus
      };
    }

    this.queueResumeMailbox(mailboxConfig, delivery, "manual");
    return {
      ok: true as const,
      mailbox,
      accepted: true,
      runtime_status: "running" as const
    };
  }

  async clearMailboxFailure(mailbox: string) {
    const state = this.state.clearFailure(mailbox);
    this.state.recordEvent({
      mailbox,
      level: "info",
      title: "Failure cleared",
      message: "Failure count, backoff timer, and last error were cleared locally.",
      at: new Date().toISOString()
    });
    await this.sendHeartbeat();
    return {
      ok: true as const,
      mailbox,
      runtime_status: state.runtimeStatus,
      failure_count: state.failureCount,
      next_resume_after: state.nextResumeAfter,
      last_error: state.lastError
    };
  }

  async enableMailbox(mailbox: string) {
    const current = this.state.getMailboxState(mailbox);
    if (!current) {
      throw new Error(`Mailbox ${mailbox} is not configured`);
    }
    if (current.managementStatus === "removed") {
      throw new Error("Removed mailbox must be bootstrapped again from the agent session");
    }
    const state = this.state.setManagementStatus(mailbox, "enabled");
    this.state.recordEvent({
      mailbox,
      level: "info",
      title: "Mailbox enabled",
      message: "Automatic polling and resume are enabled for this mailbox.",
      at: new Date().toISOString()
    });
    await this.sendHeartbeat();
    return {
      ok: true as const,
      mailbox,
      management_status: state.managementStatus
    };
  }

  async disableMailbox(mailbox: string) {
    const current = this.state.getMailboxState(mailbox);
    if (!current) {
      throw new Error(`Mailbox ${mailbox} is not configured`);
    }
    if (current.managementStatus === "removed") {
      throw new Error("Mailbox is no longer managed by this host");
    }
    const state = this.state.setManagementStatus(mailbox, "disabled");
    this.state.recordEvent({
      mailbox,
      level: "info",
      title: "Mailbox disabled",
      message: "Automatic polling and resume are paused for this mailbox.",
      at: new Date().toISOString()
    });
    await this.sendHeartbeat();
    return {
      ok: true as const,
      mailbox,
      management_status: state.managementStatus
    };
  }

  async removeLocalBinding(mailbox: string) {
    const state = this.state.getMailboxState(mailbox);
    if (!state) {
      throw new Error(`Mailbox ${mailbox} is not configured`);
    }
    if (state.runtimeStatus === "running") {
      throw new HostHttpError(
        409,
        "Cannot remove local binding while mailbox runtime is running"
      );
    }

    if (state.managementStatus !== "removed" && state.bindingStatus === "active" && state.bootstrapped) {
      await this.requireAuthenticated();
      await this.client.releaseMailboxBinding(this.token!, this.config.hostId, mailbox);
    }

    const next = this.state.markBindingRemoved(mailbox);
    this.state.recordEvent({
      mailbox,
      level: "info",
      title: "Local binding removed",
      message: `Mailbox was removed from Host ${this.config.hostId} management.`,
      at: new Date().toISOString()
    });
    await this.sendHeartbeat();
    return {
      ok: true as const,
      mailbox,
      binding_status: next.bindingStatus,
      management_status: next.managementStatus
    };
  }

  async getStatusPayload() {
    const mailboxes = this.getManagedMailboxStates();
    const unreadCountByMailbox = await this.getUnreadCountByMailbox(mailboxes);
    const mailboxStatus = mailboxes.map((item) => ({
      mailbox: item.mailbox,
      mailbox_runtime_status: item.runtimeStatus,
      current_session_id: item.currentSessionId,
      pending_unread_count: unreadCountByMailbox.get(item.mailbox) ?? 0
    }));

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

  async getWebOverviewPayload() {
    const mailboxes = this.getManagedMailboxStates();
    const unreadCountByMailbox = await this.getUnreadCountByMailbox(mailboxes);
    const attentionMailboxes = mailboxes
      .filter((state) => this.needsAttention(state, unreadCountByMailbox.get(state.mailbox) ?? 0))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map((state) => this.toAttentionMailboxSummary(state, unreadCountByMailbox.get(state.mailbox) ?? 0));

    const counters = {
      managed_mailboxes: mailboxes.length,
      enabled_mailboxes: mailboxes.filter((item) => item.managementStatus === "enabled").length,
      disabled_mailboxes: mailboxes.filter((item) => item.managementStatus === "disabled").length,
      running_mailboxes: mailboxes.filter((item) => item.runtimeStatus === "running").length,
      failed_mailboxes: mailboxes.filter((item) => item.runtimeStatus === "failed").length,
      stuck_unread_mailboxes: mailboxes.filter((item) => {
        const unread = unreadCountByMailbox.get(item.mailbox) ?? 0;
        return unread > 0 && this.needsAttention(item, unread);
      }).length
    };

    return {
      host: {
        host_id: this.config.hostId,
        label: this.config.label,
        host_version: this.config.hostVersion,
        host_status: this.getHostStatus(),
        started_at: this.startedAt
      },
      auth: {
        central_base_url: this.config.centralBaseUrl,
        authenticated: this.isAuthenticated(),
        last_authenticated_at: this.lastAuthenticatedAt,
        last_heartbeat_at: this.lastHeartbeatAt,
        last_auth_error: this.lastAuthError
      },
      mcp: this.getMcpConfigPayload(),
      counters,
      attention_mailboxes: attentionMailboxes
    };
  }

  async listWebMailboxesPayload(query: {
    q?: string | undefined;
  } = {}) {
    const search = query.q?.trim().toLowerCase() ?? "";
    const mailboxes = this.getManagedMailboxStates();
    const unreadCountByMailbox = await this.getUnreadCountByMailbox(mailboxes);
    const filtered = mailboxes.filter((state) => {
      if (search.length === 0) {
        return true;
      }
      return [state.mailbox, state.name ?? ""].some((value) =>
        value.toLowerCase().includes(search)
      );
    });

    return {
      counters: {
        total: filtered.length,
        enabled: filtered.filter((item) => item.managementStatus === "enabled").length,
        disabled: filtered.filter((item) => item.managementStatus === "disabled").length,
        failed: filtered.filter((item) => item.runtimeStatus === "failed").length,
        with_unread: filtered.filter((item) => (unreadCountByMailbox.get(item.mailbox) ?? 0) > 0).length
      },
      mailboxes: filtered.map((state) =>
        this.toMailboxSummary(state, unreadCountByMailbox.get(state.mailbox) ?? 0)
      )
    };
  }

  async getWebMailboxDetailPayload(mailbox: string) {
    const state = this.state.getMailboxState(mailbox);
    if (!state) {
      throw new Error(`Mailbox ${mailbox} is not configured`);
    }
    const pendingUnreadCount = await this.getPendingUnreadCount(mailbox, state);

    return {
      profile: {
        mailbox: state.mailbox,
        name: state.name,
        role: state.role,
        responsibilities: state.responsibilities
      },
      binding: {
        host_id: this.config.hostId,
        binding_status: state.bindingStatus,
        bound_at: state.boundAt
      },
      workspace: {
        workspace_path: state.workspacePath,
        git_user_name: state.gitUserName,
        git_user_email: state.gitUserEmail
      },
      bootstrap: {
        bootstrap_status: state.bootstrapStatus,
        last_bootstrap_at: state.lastBootstrapAt
      },
      runtime: {
        management_status: state.managementStatus,
        runtime_status: state.runtimeStatus,
        current_session_id: state.currentSessionId,
        active_task_id: state.activeTaskId,
        pending_unread_count: pendingUnreadCount,
        last_processed_delivery_id: state.lastProcessedDeliveryId,
        latest_summary: state.latestSummary,
        next_resume_after: state.nextResumeAfter,
        last_error: state.lastError,
        last_error_at: state.lastErrorAt,
        updated_at: state.updatedAt
      },
      recovery: {
        suggested_action: this.buildSuggestedAction(state, pendingUnreadCount)
      },
      recent_events: this.state.listEvents({ mailbox, limit: 12 }),
      available_actions: this.buildAvailableActions(state)
    };
  }

  private async ensureAuthenticated(options: {
    forceExchange?: boolean;
  } = {}): Promise<void> {
    if (this.token && !options.forceExchange) {
      try {
        await this.client.registerHost(this.token, {
          host_id: this.config.hostId,
          label: this.config.label,
          bootstrap_key: this.config.bootstrapKey,
          host_version: this.config.hostVersion
        });
        this.lastAuthenticatedAt = new Date().toISOString();
        this.lastAuthError = null;
        this.state.setLastAuthError(null);
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
    this.lastAuthError = null;
    this.state.setLastAuthError(null);
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
        managed_mailboxes: this.getManagedMailboxStates().map((item) => ({
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
        this.handleAuthFailure("Central rejected host token during heartbeat");
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
        if (
          state.managementStatus !== "enabled" ||
          state.bindingStatus !== "active" ||
          state.runtimeStatus === "running" ||
          state.runtimeStatus === "failed" ||
          this.mailboxRuns.has(mailbox.mailbox)
        ) {
          continue;
        }
        if (state.nextResumeAfter && Date.parse(state.nextResumeAfter) > Date.now()) {
          continue;
        }

        const delivery = await this.client.getOldestUnreadDelivery(this.token, mailbox.mailbox);
        if (!delivery) {
          continue;
        }
        this.queueResumeMailbox(mailbox, delivery, "poll");
      }
    } catch (error) {
      if (error instanceof CentralAuthError) {
        this.handleAuthFailure("Central rejected host token during polling");
      } else {
        console.error("Polling failed:", error);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private queueResumeMailbox(
    mailbox: ManagedMailboxConfig,
    delivery: Delivery,
    trigger: "manual" | "poll"
  ): void {
    if (this.mailboxRuns.has(mailbox.mailbox)) {
      return;
    }
    this.mailboxRuns.add(mailbox.mailbox);
    this.state.markResumeStarted(mailbox.mailbox);
    this.state.recordEvent({
      mailbox: mailbox.mailbox,
      level: "info",
      title: trigger === "manual" ? "Manual resume started" : "Automatic resume started",
      message: `Processing delivery ${delivery.delivery_id}.`,
      at: new Date().toISOString()
    });
    void this.resumeMailboxLocked(mailbox, delivery, trigger);
  }

  private async resumeMailboxLocked(
    mailbox: ManagedMailboxConfig,
    delivery: Delivery,
    trigger: "manual" | "poll"
  ): Promise<void> {
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
      this.state.recordEvent({
        mailbox: mailbox.mailbox,
        level: "info",
        title: trigger === "manual" ? "Manual resume completed" : "Automatic resume completed",
        message: summary ?? `Processed delivery ${delivery.delivery_id}.`,
        at: new Date().toISOString()
      });
      await this.sendHeartbeat();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = this.state.markResumeFailure(mailbox.mailbox, {
        maxFailures: this.config.resumeMaxFailures,
        backoffBaseMs: this.config.resumeBackoffBaseMs,
        errorMessage: message
      });
      this.state.recordEvent({
        mailbox: mailbox.mailbox,
        level: "error",
        title: next.runtimeStatus === "failed" ? "Resume failed" : "Resume backed off",
        message,
        at: new Date().toISOString()
      });
      console.error(`Resume failed for ${mailbox.mailbox}:`, message);
      if (next.runtimeStatus === "failed") {
        await this.sendHeartbeat();
      }
    } finally {
      this.mailboxRuns.delete(mailbox.mailbox);
    }
  }

  private async executeResumeCommand(
    mailbox: ManagedMailboxConfig,
    prompt: string
  ): Promise<string | null> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-mail-host-"));
    const outputPath = path.join(tempDir, "last-message.txt");
    try {
      await this.assertWorkspaceReady(mailbox.workspacePath);
      if (this.config.resumeCommandTemplate) {
        await runProcess(
          "sh",
          [
            "-lc",
            this.config.resumeCommandTemplate
              .replaceAll("{mailbox}", mailbox.mailbox)
              .replaceAll("{workspacePath}", mailbox.workspacePath)
              .replaceAll("{prompt}", JSON.stringify(prompt))
              .replaceAll("{outputPath}", outputPath)
          ],
          mailbox.workspacePath
        );
      } else {
        const args = [
          "exec",
          "-C",
          mailbox.workspacePath,
          ...buildCodexMcpConfigArgs(this.getMcpUrl()),
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

  private handleAuthFailure(message: string): void {
    this.token = null;
    this.state.setHostToken(null);
    this.lastAuthError = message;
    this.state.setLastAuthError(message);
    this.state.recordEvent({
      mailbox: null,
      level: "error",
      title: "Host authentication failed",
      message,
      at: new Date().toISOString()
    });
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

  private async assertWorkspaceReady(workspacePath: string): Promise<void> {
    let workspaceStats;
    try {
      workspaceStats = await stat(workspacePath);
    } catch {
      throw new Error(`Workspace does not exist: ${workspacePath}`);
    }
    if (!workspaceStats.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${workspacePath}`);
    }

    const gitPath = path.join(workspacePath, ".git");
    let gitStats;
    try {
      gitStats = await stat(gitPath);
    } catch {
      throw new Error(`Workspace is missing .git metadata: ${workspacePath}`);
    }
    if (!gitStats.isDirectory() && !gitStats.isFile()) {
      throw new Error(`Workspace has invalid .git metadata: ${workspacePath}`);
    }
  }

  private getManagedMailboxStates(): MailboxLocalState[] {
    return this.state.listMailboxStates().filter((item) => item.managementStatus !== "removed");
  }

  private async getUnreadCountByMailbox(states: MailboxLocalState[]): Promise<Map<string, number>> {
    const entries = await Promise.all(
      states.map(async (state) => [state.mailbox, await this.getPendingUnreadCount(state.mailbox, state)] as const)
    );
    return new Map(entries);
  }

  private async getPendingUnreadCount(
    mailbox: string,
    state = this.state.getMailboxState(mailbox)
  ): Promise<number> {
    if (
      !this.token ||
      !state ||
      !state.bootstrapped ||
      state.managementStatus === "removed" ||
      state.bindingStatus !== "active"
    ) {
      return 0;
    }

    try {
      const rows = await this.client.listDeliveries(this.token, mailbox, {
        readStatus: "unread",
        limit: 100,
        order: "oldest_first"
      });
      return rows.length;
    } catch (error) {
      if (error instanceof CentralAuthError) {
        this.handleAuthFailure("Central rejected host token while loading unread counts");
      }
      return 0;
    }
  }

  private buildAvailableActions(state: MailboxLocalState) {
    const canResumeBase =
      state.bootstrapped &&
      state.bindingStatus === "active" &&
      state.managementStatus === "enabled" &&
      state.runtimeStatus !== "running";

    return {
      can_resume_now: canResumeBase,
      can_clear_failure:
        state.managementStatus !== "removed" &&
        (state.runtimeStatus === "failed" || state.failureCount > 0 || state.lastError !== null || state.nextResumeAfter !== null),
      can_enable: state.managementStatus === "disabled",
      can_disable: state.managementStatus === "enabled",
      can_remove_local_binding: state.managementStatus !== "removed" && state.runtimeStatus !== "running"
    };
  }

  private buildSuggestedAction(state: MailboxLocalState, pendingUnreadCount: number): string {
    if (state.bootstrapStatus === "failed") {
      return "Return to the agent session, fix the bootstrap problem, then retry bootstrap there.";
    }
    if (state.managementStatus === "removed") {
      return "This mailbox is no longer managed by this host. Bootstrap again from the agent session if it should return.";
    }
    if (state.runtimeStatus === "failed") {
      return "Clear failure, inspect the agent session or workspace, then resume now.";
    }
    if (state.nextResumeAfter) {
      return "Mailbox is in backoff. Wait for the next retry window or clear failure after fixing the underlying issue.";
    }
    if (state.managementStatus === "disabled") {
      return "Enable this mailbox when the workspace is ready for automatic polling again.";
    }
    if (pendingUnreadCount > 0) {
      return "Unread work is waiting. Use resume now if you want to process it immediately.";
    }
    return "Mailbox is healthy. No manual action is needed right now.";
  }

  private needsAttention(state: MailboxLocalState, pendingUnreadCount: number): boolean {
    return (
      state.bootstrapStatus === "failed" ||
      state.runtimeStatus === "failed" ||
      state.managementStatus === "disabled" ||
      state.bindingStatus !== "active" ||
      state.nextResumeAfter !== null ||
      (pendingUnreadCount > 0 && state.managementStatus !== "enabled")
    );
  }

  private toAttentionMailboxSummary(state: MailboxLocalState, pendingUnreadCount: number) {
    return {
      mailbox: state.mailbox,
      name: state.name,
      role: state.role,
      management_status: state.managementStatus,
      binding_status: state.bindingStatus,
      runtime_status: state.runtimeStatus,
      pending_unread_count: pendingUnreadCount,
      last_error: state.lastError,
      bootstrap_status: state.bootstrapStatus,
      updated_at: state.updatedAt,
      available_actions: this.buildAvailableActions(state)
    };
  }

  private toMailboxSummary(state: MailboxLocalState, pendingUnreadCount: number) {
    return {
      mailbox: state.mailbox,
      name: state.name,
      role: state.role,
      binding_status: state.bindingStatus,
      management_status: state.managementStatus,
      runtime_status: state.runtimeStatus,
      pending_unread_count: pendingUnreadCount,
      current_session_id: state.currentSessionId,
      bootstrap_status: state.bootstrapStatus,
      updated_at: state.updatedAt,
      available_actions: this.buildAvailableActions(state)
    };
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
