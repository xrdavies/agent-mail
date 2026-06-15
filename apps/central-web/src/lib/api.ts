import {
  debugLogsResponseSchema,
  emailSchema,
  hostsListResponseSchema,
  runtimeSnapshotSchema,
  threadDetailResponseSchema,
  webMailboxDetailResponseSchema,
  webMailboxesResponseSchema,
  webEmailsResponseSchema,
  webThreadsResponseSchema,
  webOverviewResponseSchema,
  type CentralLogEvent,
  type Host
} from "@agent-mail/contracts";

export interface DebugLogsQuery {
  tail?: number;
  errorsOnly?: boolean;
  debugOnly?: boolean;
  hostId?: string;
  path?: string;
  requestId?: string;
}

export interface DebugLogsResponse {
  events: CentralLogEvent[];
}

function buildQueryString(query: DebugLogsQuery): string {
  const search = new URLSearchParams();
  if (query.tail) search.set("tail", String(query.tail));
  if (query.errorsOnly) search.set("errors_only", "true");
  if (query.debugOnly) search.set("debug_only", "true");
  if (query.hostId) search.set("host_id", query.hostId);
  if (query.path) search.set("path", query.path);
  if (query.requestId) search.set("request_id", query.requestId);
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

export async function getDebugLogs(query: DebugLogsQuery = {}): Promise<DebugLogsResponse> {
  const response = await fetch(`/api/v1/debug/logs${buildQueryString(query)}`);
  if (!response.ok) {
    throw new Error(`Failed to load debug logs: ${response.status}`);
  }
  return debugLogsResponseSchema.parse(await response.json());
}

export function createDebugLogStream(
  query: DebugLogsQuery,
  handlers: {
    onLog: (event: CentralLogEvent) => void;
    onReady?: () => void;
    onPing?: () => void;
    onError?: () => void;
  }
) {
  const source = new EventSource(`/api/v1/debug/logs/stream${buildQueryString(query)}`);

  source.addEventListener("ready", () => {
    handlers.onReady?.();
  });

  source.addEventListener("log", (message) => {
    const payload = JSON.parse((message as MessageEvent<string>).data) as CentralLogEvent;
    handlers.onLog(payload);
  });

  source.addEventListener("ping", () => {
    handlers.onPing?.();
  });

  source.onerror = () => {
    handlers.onError?.();
  };

  return source;
}

export interface HostSummary {
  host: Host;
  managed_mailboxes: number;
  running_mailboxes: number;
  failed_mailboxes: number;
  unread_deliveries: number;
}

export type HostsListResponse = ReturnType<typeof hostsListResponseSchema.parse>;
export type RuntimeSnapshot = ReturnType<typeof runtimeSnapshotSchema.parse>;
export type WebThreadsResponse = ReturnType<typeof webThreadsResponseSchema.parse>;
export type ThreadDetailResponse = ReturnType<typeof threadDetailResponseSchema.parse>;
export type WebEmailsResponse = ReturnType<typeof webEmailsResponseSchema.parse>;
export type MailDetailResponse = ReturnType<typeof emailSchema.parse>;
export type WebMailboxesResponse = ReturnType<typeof webMailboxesResponseSchema.parse>;
export type MailboxDetailResponse = ReturnType<typeof webMailboxDetailResponseSchema.parse>;

export type WebOverviewResponse = ReturnType<typeof webOverviewResponseSchema.parse>;

export async function getWebOverview(): Promise<WebOverviewResponse> {
  const response = await fetch("/api/v1/web/overview");
  if (!response.ok) {
    throw new Error(`Failed to load overview: ${response.status}`);
  }
  return webOverviewResponseSchema.parse(await response.json());
}

export async function getHosts(): Promise<HostsListResponse> {
  const response = await fetch("/api/v1/hosts");
  if (!response.ok) {
    throw new Error(`Failed to load hosts: ${response.status}`);
  }
  return hostsListResponseSchema.parse(await response.json());
}

export async function getHostDetail(hostId: string): Promise<RuntimeSnapshot> {
  const response = await fetch(`/api/v1/hosts/${encodeURIComponent(hostId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load host detail: ${response.status}`);
  }
  return runtimeSnapshotSchema.parse(await response.json());
}

export async function getThreads(): Promise<WebThreadsResponse> {
  const response = await fetch("/api/v1/web/threads?limit=50");
  if (!response.ok) {
    throw new Error(`Failed to load threads: ${response.status}`);
  }
  return webThreadsResponseSchema.parse(await response.json());
}

export async function getThreadDetail(threadId: string): Promise<ThreadDetailResponse> {
  const response = await fetch(`/api/v1/web/threads/${encodeURIComponent(threadId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load thread detail: ${response.status}`);
  }
  return threadDetailResponseSchema.parse(await response.json());
}

export async function getMails(): Promise<WebEmailsResponse> {
  const response = await fetch("/api/v1/web/emails?limit=50");
  if (!response.ok) {
    throw new Error(`Failed to load mails: ${response.status}`);
  }
  return webEmailsResponseSchema.parse(await response.json());
}

export async function getMailDetail(emailId: string): Promise<MailDetailResponse> {
  const response = await fetch(`/api/v1/web/emails/${encodeURIComponent(emailId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load mail detail: ${response.status}`);
  }
  return emailSchema.parse(await response.json());
}

export async function getMailboxes(): Promise<WebMailboxesResponse> {
  const response = await fetch("/api/v1/web/mailboxes");
  if (!response.ok) {
    throw new Error(`Failed to load mailboxes: ${response.status}`);
  }
  return webMailboxesResponseSchema.parse(await response.json());
}

export async function getMailboxDetail(mailbox: string): Promise<MailboxDetailResponse> {
  const response = await fetch(`/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}?activity_limit=50`);
  if (!response.ok) {
    throw new Error(`Failed to load mailbox detail: ${response.status}`);
  }
  return webMailboxDetailResponseSchema.parse(await response.json());
}
