import {
  type HostStatus,
  bindSessionRequestSchema,
  machineHeartbeatRequestSchema,
  machineSchema,
  mailboxSchema,
  registerMachineRequestSchema,
  registerMailboxRequestSchema,
  sessionHeartbeatRequestSchema,
  sessionSchema
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
}
