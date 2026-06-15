import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { CentralLogEvent } from "@agent-mail/contracts";

import { createDebugLogStream, getDebugLogs } from "../lib/api.js";

const INITIAL_TAIL = 120;

function formatTimestamp(input: string): string {
  return new Date(input).toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

function formatLine(event: CentralLogEvent): string {
  return JSON.stringify(event);
}

export function DebugPage() {
  const [events, setEvents] = useState<CentralLogEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "connected" | "paused" | "error">(
    "connecting"
  );
  const streamRef = useRef<EventSource | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["debug-logs", INITIAL_TAIL],
    queryFn: () => getDebugLogs({ tail: INITIAL_TAIL })
  });

  useEffect(() => {
    if (!data) {
      return;
    }
    setEvents(data.events);
  }, [data]);

  useEffect(() => {
    if (paused) {
      streamRef.current?.close();
      streamRef.current = null;
      setStreamStatus("paused");
      return;
    }

    const source = createDebugLogStream(
      { tail: 20 },
      {
        onReady: () => setStreamStatus("connected"),
        onLog: (event) => {
          setEvents((current) => [...current, event].slice(-200));
        },
        onError: () => setStreamStatus("error")
      }
    );

    streamRef.current = source;
    return () => {
      source.close();
      if (streamRef.current === source) {
        streamRef.current = null;
      }
    };
  }, [paused]);

  useEffect(() => {
    if (!autoScroll || !scrollerRef.current) {
      return;
    }
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [autoScroll, events]);

  const errorCount = events.filter((event) => event.level === "error" || (event.status ?? 0) >= 400).length;
  const debugCount = events.filter((event) => event.debug).length;
  const durations = events
    .map((event) => event.duration_ms)
    .filter((value): value is number => value !== null);
  const avgDuration =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);

  return (
    <>
      <section className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Requests</p>
          <p className="stat-value">{events.length}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Errors</p>
          <p className="stat-value">{errorCount}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Debug Reads</p>
          <p className="stat-value">{debugCount}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Avg Duration</p>
          <p className="stat-value">{avgDuration} ms</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="chip-row">
            <span className="chip active">All</span>
            <span className="chip">Errors Only</span>
            <span className="chip">Debug Only</span>
            <span className="chip">Host mac-local</span>
            <span className="chip">/api/v1/tasks</span>
          </div>
          <div className="button-row">
            <span className="button subtle">request_id</span>
            <span className="button subtle">status &gt;= 400</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <p className="eyebrow">Errors</p>
          <h2 className="panel-title">Recent Failures</h2>
          <div className="timeline">
            {(events
              .filter((event) => event.level === "error" || (event.status ?? 0) >= 400)
              .slice(-3)
              .reverse()).map((event) => (
              <div className="timeline-item" key={event.id}>
                <h4>
                  {formatTimestamp(event.ts)} · {event.method ?? event.event} · {event.path ?? event.event}
                </h4>
                <p>{event.message ?? `status=${event.status ?? "unknown"}`}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live Tail</p>
              <h2 className="panel-title">Central Log Stream</h2>
            </div>
            <div className="button-row">
              <span className={`chip ${statusChipClass(streamStatus)}`}>{streamStatus}</span>
              <button className="button subtle" onClick={() => setPaused((value) => !value)} type="button">
                {paused ? "Resume" : "Pause"}
              </button>
              <button className="button subtle" onClick={() => setEvents([])} type="button">
                Clear
              </button>
            </div>
          </div>

          <div className="button-row debug-stream-controls">
            <label className="toggle">
              <input
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
                type="checkbox"
              />
              <span>Auto-scroll</span>
            </label>
            <span className="button subtle">SSE</span>
          </div>

          <div
            ref={scrollerRef}
            className="log-stream log-stream-live terminal-stream"
            aria-live="polite"
          >
            {events.length === 0 ? (
              <div className="log-line">
                {isLoading ? "Loading logs..." : isError ? "Failed to load logs." : "No logs yet."}
              </div>
            ) : (
              events.map((event) => (
                <div className="log-line" key={event.id}>
                  {formatLine(event)}
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Central Request Audit</p>
            <h2 className="panel-title">HTTP Request Events</h2>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Method</th>
              <th>Path</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Host</th>
              <th>Debug</th>
              <th>Request ID</th>
            </tr>
          </thead>
          <tbody>
            {(events.slice(-20).reverse()).map((event) => (
              <tr key={event.id}>
                <td>{formatTimestamp(event.ts)}</td>
                <td>
                  <span className={`chip ${event.level === "error" ? "danger" : "info"}`}>
                    {event.event}
                  </span>
                </td>
                <td>{event.method ?? "-"}</td>
                <td className="mono">{event.path ?? "-"}</td>
                <td>{event.status ?? "-"}</td>
                <td>{event.duration_ms !== null ? `${event.duration_ms} ms` : "-"}</td>
                <td>{event.auth_host_id ?? "-"}</td>
                <td>{event.debug ? "true" : "false"}</td>
                <td className="mono">{event.request_id ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function statusChipClass(status: "connecting" | "connected" | "paused" | "error") {
  if (status === "connected") {
    return "success";
  }
  if (status === "paused") {
    return "warning";
  }
  if (status === "error") {
    return "danger";
  }
  return "info";
}
