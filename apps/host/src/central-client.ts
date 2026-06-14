import { z } from "zod";

import {
  agentProfileSchema,
  createTaskRequestSchema,
  deliverySchema,
  emailSchema,
  getDeliveryOutputSchema,
  healthResponseSchema,
  hostAuthExchangeRequestSchema,
  hostAuthExchangeResponseSchema,
  hostHeartbeatRequestSchema,
  hostHeartbeatResponseSchema,
  hostSchema,
  issueIdempotencyKeyRequestSchema,
  issueIdempotencyKeyResponseSchema,
  markDeliveryReadRequestSchema,
  markDeliveryReadResponseSchema,
  registerAgentRequestSchema,
  registerAgentResponseSchema,
  sendEmailRequestSchema,
  sendEmailResponseSchema,
  taskSchema,
  threadDetailResponseSchema,
  updateTaskStatusRequestSchema
} from "@agent-mail/contracts";

export class CentralAuthError extends Error {}

export class CentralClient {
  constructor(private readonly baseUrl: string) {}

  async exchangeHostToken(input: z.infer<typeof hostAuthExchangeRequestSchema>) {
    return this.request("/api/v1/host-auth/exchange", {
      method: "POST",
      body: hostAuthExchangeRequestSchema.parse(input)
    }, hostAuthExchangeResponseSchema);
  }

  async registerHost(token: string, input: z.infer<typeof hostAuthExchangeRequestSchema>) {
    return this.request(
      "/api/v1/hosts/register",
      {
        method: "POST",
        token,
        body: {
          host_id: input.host_id,
          label: input.label,
          host_version: input.host_version ?? null
        }
      },
      hostSchema
    );
  }

  async heartbeat(token: string, hostId: string, input: z.infer<typeof hostHeartbeatRequestSchema>) {
    return this.request(
      `/api/v1/hosts/${encodeURIComponent(hostId)}/heartbeat`,
      {
        method: "POST",
        token,
        body: hostHeartbeatRequestSchema.parse(input)
      },
      hostHeartbeatResponseSchema
    );
  }

  async issueIdempotencyKey(
    token: string,
    input: z.infer<typeof issueIdempotencyKeyRequestSchema>
  ) {
    return this.request(
      "/api/v1/idempotency-keys/issue",
      {
        method: "POST",
        token,
        body: issueIdempotencyKeyRequestSchema.parse(input)
      },
      issueIdempotencyKeyResponseSchema
    );
  }

  async registerAgent(token: string, input: z.infer<typeof registerAgentRequestSchema>) {
    return this.request(
      "/api/v1/agents/register",
      {
        method: "POST",
        token,
        body: registerAgentRequestSchema.parse(input)
      },
      registerAgentResponseSchema
    );
  }

  async listAgents(token: string) {
    return this.request(
      "/api/v1/agents",
      { method: "GET", token },
      z.array(agentProfileSchema)
    );
  }

  async getAgentByMailbox(token: string, mailbox: string) {
    return this.request(
      `/api/v1/agents/${encodeURIComponent(mailbox)}`,
      { method: "GET", token },
      agentProfileSchema
    );
  }

  async sendEmail(token: string, input: z.infer<typeof sendEmailRequestSchema>) {
    return this.request(
      "/api/v1/emails/send",
      {
        method: "POST",
        token,
        body: sendEmailRequestSchema.parse(input)
      },
      sendEmailResponseSchema
    );
  }

  async listDeliveries(
    token: string,
    mailbox: string,
    query: { readStatus?: "unread" | "read"; limit?: number; order?: "oldest_first" | "newest_first" } = {}
  ) {
    const search = new URLSearchParams();
    if (query.readStatus) search.set("read_status", query.readStatus);
    if (query.limit) search.set("limit", String(query.limit));
    if (query.order) search.set("order", query.order);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return this.request(
      `/api/v1/mailboxes/${encodeURIComponent(mailbox)}/deliveries${suffix}`,
      { method: "GET", token },
      z.array(deliverySchema)
    );
  }

  async getOldestUnreadDelivery(token: string, mailbox: string) {
    return this.request(
      `/api/v1/mailboxes/${encodeURIComponent(mailbox)}/unread-deliveries/oldest`,
      { method: "GET", token },
      deliverySchema.nullable()
    );
  }

  async markDeliveryRead(token: string, deliveryId: string, mailbox: string) {
    return this.request(
      `/api/v1/deliveries/${encodeURIComponent(deliveryId)}/read`,
      {
        method: "POST",
        token,
        body: markDeliveryReadRequestSchema.parse({ mailbox })
      },
      markDeliveryReadResponseSchema
    );
  }

  async getEmail(token: string, emailId: string) {
    return this.request(
      `/api/v1/emails/${encodeURIComponent(emailId)}`,
      { method: "GET", token },
      emailSchema
    );
  }

  async getThread(token: string, threadId: string) {
    return this.request(
      `/api/v1/threads/${encodeURIComponent(threadId)}`,
      { method: "GET", token },
      threadDetailResponseSchema
    );
  }

  async createTask(token: string, input: z.infer<typeof createTaskRequestSchema>) {
    return this.request(
      "/api/v1/tasks",
      {
        method: "POST",
        token,
        body: createTaskRequestSchema.parse(input)
      },
      taskSchema
    );
  }

  async listTasks(
    token: string,
    query: {
      assigneeMailbox?: string;
      status?: "new" | "in_progress" | "paused" | "done" | "blocked";
      threadId?: string;
      triggerEmailId?: string;
      parentTaskId?: string;
    } = {}
  ) {
    const search = new URLSearchParams();
    if (query.assigneeMailbox) search.set("assignee_mailbox", query.assigneeMailbox);
    if (query.status) search.set("status", query.status);
    if (query.threadId) search.set("thread_id", query.threadId);
    if (query.triggerEmailId) search.set("trigger_email_id", query.triggerEmailId);
    if (query.parentTaskId) search.set("parent_task_id", query.parentTaskId);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return this.request(`/api/v1/tasks${suffix}`, { method: "GET", token }, z.array(taskSchema));
  }

  async updateTaskStatus(
    token: string,
    taskId: string,
    input: z.infer<typeof updateTaskStatusRequestSchema>
  ) {
    return this.request(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/status`,
      {
        method: "PATCH",
        token,
        body: updateTaskStatusRequestSchema.parse(input)
      },
      taskSchema
    );
  }

  private async request<T>(
    pathname: string,
    init: {
      method: "GET" | "POST" | "PATCH";
      token?: string;
      body?: unknown;
    },
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method: init.method,
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {})
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {})
    });

    if (response.status === 401) {
      throw new CentralAuthError("Central rejected host token");
    }

    const text = await response.text();
    const payload = text.length > 0 ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: { message?: string } }).error?.message ?? response.statusText)
          : response.statusText;
      throw new Error(message);
    }

    return schema.parse(payload);
  }
}
