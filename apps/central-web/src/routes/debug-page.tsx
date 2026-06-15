import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createDebugLogStream, getDebugLogs } from "../lib/api.js";
import type { CentralLogEvent } from "@agent-mail/contracts";

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
          setEvents((current) => {
            const next = [...current, event];
            return next.slice(-200);
          });
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
    <div className="min-h-screen px-8 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="grid gap-4 md:grid-cols-4">
          <StatCard label="Requests" value={String(events.length)} />
          <StatCard label="Errors" value={String(errorCount)} />
          <StatCard label="Debug Reads" value={String(debugCount)} />
          <StatCard label="Avg Duration" value={`${avgDuration} ms`} />
        </section>

        <section className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] px-8 py-7 shadow-[0_0_0_1px_rgba(17,24,39,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Central Debug</p>
              <h2 className="mt-3 text-4xl tracking-tight text-[var(--display)]">Live Request Audit</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
              <StatusBadge status={streamStatus} />
              <button className="rounded-full border border-[var(--line-soft)] px-4 py-2 hover:bg-white/70" onClick={() => setPaused((value) => !value)} type="button">
                {paused ? "Resume" : "Pause"}
              </button>
              <button className="rounded-full border border-[var(--line-soft)] px-4 py-2 hover:bg-white/70" onClick={() => setEvents([])} type="button">
                Clear
              </button>
              <label className="flex items-center gap-2 rounded-full border border-[var(--line-soft)] px-4 py-2">
                <input checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} type="checkbox" />
                <span>Auto-scroll</span>
              </label>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.8fr)]">
            <div className="overflow-hidden rounded-[22px] border border-[var(--line)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[var(--panel)] text-[var(--muted)]">
                  <tr>
                    {["Time", "Event", "Method", "Path", "Status", "Duration", "Host", "Debug"].map((item) => (
                      <th key={item} className="border-b border-[var(--line-soft)] px-4 py-3 text-left font-medium uppercase tracking-[0.12em]">
                        {item}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white/70">
                  {(events.slice(-20).reverse()).map((event) => (
                    <tr key={event.id}>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{formatTimestamp(event.ts)}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.event}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.method ?? "-"}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3 font-mono text-xs">{event.path ?? "-"}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.status ?? "-"}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.duration_ms ?? "-"}{event.duration_ms !== null ? " ms" : ""}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.auth_host_id ?? "-"}</td>
                      <td className="border-b border-[var(--line-soft)] px-4 py-3">{event.debug ? "true" : "false"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <div className="rounded-[22px] border border-[var(--terminal-border)] bg-[var(--terminal-bg)] px-5 py-5 text-[var(--terminal-fg)] shadow-[0_0_24px_rgba(0,217,0,0.08)]">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--terminal-dim)]">
                      Live Tail
                    </p>
                    <h3 className="mt-2 text-lg text-[var(--terminal-bright)]">Central Log Stream</h3>
                  </div>
                  <span className="font-mono text-xs text-[var(--terminal-dim)]">SSE</span>
                </div>

                <div
                  ref={scrollerRef}
                  className="max-h-[34rem] overflow-y-auto rounded-[16px] border border-[var(--terminal-border)] bg-black/70 px-4 py-4 font-mono text-xs leading-6"
                >
                  {events.length === 0 ? (
                    <p className="text-[var(--terminal-dim)]">
                      {isLoading ? "Loading logs..." : isError ? "Failed to load logs." : "No logs yet."}
                    </p>
                  ) : (
                    events.map((event) => (
                      <div key={event.id} className="break-all py-1 text-[var(--terminal-fg)]">
                        {formatLine(event)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-[var(--line)] bg-[var(--card)] px-5 py-5 shadow-[0_0_0_1px_rgba(17,24,39,0.04)]">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{props.label}</p>
      <p className="mt-3 text-3xl tracking-tight text-[var(--display)]">{props.value}</p>
    </div>
  );
}

function StatusBadge(props: { status: "connecting" | "connected" | "paused" | "error" }) {
  const config = {
    connecting: "border-amber-500/20 bg-amber-500/10 text-amber-800",
    connected: "border-emerald-500/20 bg-emerald-500/10 text-emerald-800",
    paused: "border-slate-500/20 bg-slate-500/10 text-slate-700",
    error: "border-red-500/20 bg-red-500/10 text-red-800"
  }[props.status];

  return (
    <span className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] ${config}`}>
      {props.status}
    </span>
  );
}
