import type { CentralLogEvent } from "@agent-mail/contracts";

import { createPrefixedId } from "./ids.js";
import { now } from "./time.js";

export interface CentralLogFilter {
  errorsOnly?: boolean;
  debugOnly?: boolean;
  hostId?: string;
  path?: string;
  requestId?: string;
}

type CentralLogLevel = CentralLogEvent["level"];

type CentralLogEventInput = {
  level: CentralLogLevel;
  event: string;
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  durationMs?: number | null;
  authHostId?: string | null;
  debug?: boolean;
  message?: string | null;
  stack?: string | null;
};

function createEvent(input: CentralLogEventInput): CentralLogEvent {
  return {
    id: createPrefixedId("evt"),
    ts: now().toISOString(),
    level: input.level,
    event: input.event,
    request_id: input.requestId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    status: input.status ?? null,
    duration_ms: input.durationMs ?? null,
    auth_host_id: input.authHostId ?? null,
    debug: input.debug ?? false,
    message: input.message ?? null,
    stack: input.stack ?? null
  };
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? null
    };
  }

  return {
    message: String(error),
    stack: null
  };
}

export function matchesCentralLogFilter(event: CentralLogEvent, filter: CentralLogFilter): boolean {
  if (filter.errorsOnly && event.level !== "error" && (event.status ?? 0) < 400) {
    return false;
  }
  if (filter.debugOnly && !event.debug) {
    return false;
  }
  if (filter.hostId && event.auth_host_id !== filter.hostId) {
    return false;
  }
  if (filter.path && !(event.path ?? "").includes(filter.path)) {
    return false;
  }
  if (filter.requestId && event.request_id !== filter.requestId) {
    return false;
  }

  return true;
}

export class CentralLogger {
  private readonly buffer: CentralLogEvent[] = [];
  private readonly subscribers = new Set<(event: CentralLogEvent) => void>();

  constructor(private readonly bufferLimit = 1000) {}

  logRequest(input: {
    requestId: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    authHostId?: string;
    debug?: boolean;
  }): CentralLogEvent {
    return this.write(
      createEvent({
        level: input.status >= 400 ? "error" : "info",
        event: "http_request",
        requestId: input.requestId,
        method: input.method,
        path: input.path,
        status: input.status,
        durationMs: input.durationMs,
        authHostId: input.authHostId ?? null,
        debug: input.debug ?? false
      })
    );
  }

  logError(input: {
    error: unknown;
    requestId?: string | null;
    method?: string | null;
    path?: string | null;
    status?: number | null;
    authHostId?: string | null;
    debug?: boolean;
    event?: string;
  }): CentralLogEvent {
    const normalized = normalizeError(input.error);
    return this.write(
      createEvent({
        level: "error",
        event: input.event ?? "error",
        requestId: input.requestId ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        status: input.status ?? null,
        authHostId: input.authHostId ?? null,
        debug: input.debug ?? false,
        message: normalized.message,
        stack: normalized.stack
      })
    );
  }

  logInfo(input: {
    event: string;
    message?: string | null;
    requestId?: string | null;
    method?: string | null;
    path?: string | null;
    status?: number | null;
    durationMs?: number | null;
    authHostId?: string | null;
    debug?: boolean;
  }): CentralLogEvent {
    return this.write(
      createEvent({
        level: "info",
        event: input.event,
        message: input.message ?? null,
        requestId: input.requestId ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        status: input.status ?? null,
        durationMs: input.durationMs ?? null,
        authHostId: input.authHostId ?? null,
        debug: input.debug ?? false
      })
    );
  }

  query(filter: CentralLogFilter = {}, tail = 100): CentralLogEvent[] {
    return this.buffer.filter((event) => matchesCentralLogFilter(event, filter)).slice(-tail);
  }

  subscribe(listener: (event: CentralLogEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private write(event: CentralLogEvent): CentralLogEvent {
    this.buffer.push(event);
    while (this.buffer.length > this.bufferLimit) {
      this.buffer.shift();
    }

    const line = `${JSON.stringify(event)}\n`;
    if (event.level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }

    return event;
  }
}
