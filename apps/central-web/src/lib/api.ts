import {
  debugLogsResponseSchema,
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
