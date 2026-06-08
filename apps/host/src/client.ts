import {
  appendMessageRequestSchema,
  clearSessionRequestSchema,
  createTaskRequestSchema,
  listTasksQuerySchema,
  type HostStatus,
  type Message,
  mailboxSchema,
  messageSchema,
  taskSchema,
  threadDetailSchema,
  workPackageSchema,
  bindSessionRequestSchema,
  machineHeartbeatRequestSchema,
  machineSchema,
  registerMachineRequestSchema,
  registerMailboxRequestSchema,
  sessionHeartbeatRequestSchema,
  sessionSchema,
  updateTaskStatusRequestSchema
} from "@agent-mail/shared";

export class CentralApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

export class CentralApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit,
    parser: (value: unknown) => T
  ): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), init);
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? ((await response.json()) as unknown) : null;

    if (!response.ok) {
      const errorBody = payload as
        | {
            error?: {
              code?: string;
              message?: string;
              details?: unknown;
            };
          }
        | null;

      throw new CentralApiError(
        response.status,
        errorBody?.error?.code ?? "http_error",
        errorBody?.error?.message ?? `Central API request failed: ${response.status}`,
        errorBody?.error?.details
      );
    }

    return parser(payload);
  }

  registerMachine(payload: Parameters<typeof registerMachineRequestSchema.parse>[0]) {
    const body = registerMachineRequestSchema.parse(payload);

    return this.request(
      "/api/v1/machines/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      machineSchema.parse
    );
  }

  sendMachineHeartbeat(machineId: string, host_status: HostStatus) {
    const body = machineHeartbeatRequestSchema.parse({ host_status });

    return this.request(
      `/api/v1/machines/${encodeURIComponent(machineId)}/heartbeat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      (payload) =>
        payload as {
          ok: boolean;
          last_heartbeat_at: string;
        }
    );
  }

  registerMailbox(payload: Parameters<typeof registerMailboxRequestSchema.parse>[0]) {
    const body = registerMailboxRequestSchema.parse(payload);

    return this.request(
      "/api/v1/mailboxes/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      mailboxSchema.parse
    );
  }

  getMailbox(mailbox: string) {
    return this.request(
      `/api/v1/mailboxes/${encodeURIComponent(mailbox)}`,
      {
        method: "GET"
      },
      mailboxSchema.parse
    );
  }

  bindSession(payload: Parameters<typeof bindSessionRequestSchema.parse>[0]) {
    const body = bindSessionRequestSchema.parse(payload);

    return this.request(
      "/api/v1/sessions/bind",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      sessionSchema.parse
    );
  }

  sendSessionHeartbeat(sessionId: string, payload: Parameters<typeof sessionHeartbeatRequestSchema.parse>[0]) {
    const body = sessionHeartbeatRequestSchema.parse(payload);

    return this.request(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      (value) =>
        value as {
          ok: boolean;
          last_heartbeat_at: string;
        }
    );
  }

  clearSession(sessionId: string, payload: Parameters<typeof clearSessionRequestSchema.parse>[0]) {
    const body = clearSessionRequestSchema.parse(payload);

    return this.request(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/clear`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      (value) =>
        value as {
          ok: boolean;
          session_status: string;
          cleared_at: string;
        }
    );
  }

  listMailboxTasks(mailbox: string) {
    return this.request(
      `/api/v1/mailboxes/${encodeURIComponent(mailbox)}/tasks`,
      {
        method: "GET"
      },
      (value) => taskSchema.array().parse(value)
    );
  }

  listTasks(query: Parameters<typeof listTasksQuerySchema.parse>[0] = {}) {
    const params = new URLSearchParams();
    const parsed = listTasksQuerySchema.parse(query);

    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        params.set(key, value);
      }
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";

    return this.request(
      `/api/v1/tasks${suffix}`,
      {
        method: "GET"
      },
      (value) => taskSchema.array().parse(value)
    );
  }

  getTaskWorkPackage(taskId: string) {
    return this.request(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/work-package`,
      {
        method: "GET"
      },
      workPackageSchema.parse
    );
  }

  getThreadDelta(threadId: string, afterMessageId?: string) {
    const suffix = afterMessageId
      ? `?after_message_id=${encodeURIComponent(afterMessageId)}`
      : "";

    return this.request(
      `/api/v1/threads/${encodeURIComponent(threadId)}/delta${suffix}`,
      {
        method: "GET"
      },
      (value) => ({
        thread_id: (value as { thread_id: string }).thread_id,
        messages: messageSchema.array().parse((value as { messages: unknown[] }).messages) as Message[]
      })
    );
  }

  getFullThread(threadId: string) {
    return this.request(
      `/api/v1/threads/${encodeURIComponent(threadId)}`,
      {
        method: "GET"
      },
      threadDetailSchema.parse
    );
  }

  replyThread(
    threadId: string,
    payload: Parameters<typeof appendMessageRequestSchema.parse>[0]
  ) {
    const body = appendMessageRequestSchema.parse(payload);

    return this.request(
      `/api/v1/threads/${encodeURIComponent(threadId)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      messageSchema.parse
    );
  }

  createTask(payload: Parameters<typeof createTaskRequestSchema.parse>[0]) {
    const body = createTaskRequestSchema.parse(payload);

    return this.request(
      "/api/v1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      taskSchema.parse
    );
  }

  updateTaskStatus(
    taskId: string,
    payload: Parameters<typeof updateTaskStatusRequestSchema.parse>[0]
  ) {
    const body = updateTaskStatusRequestSchema.parse(payload);

    return this.request(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      },
      taskSchema.parse
    );
  }

  listAgents() {
    return this.request(
      "/api/v1/agents",
      {
        method: "GET"
      },
      (value) => mailboxSchema.array().parse(value)
    );
  }
}
