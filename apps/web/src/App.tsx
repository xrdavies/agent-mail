import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Machine, Mailbox, Session, Task } from "@agent-mail/shared";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBase}${path}`, init);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

const formatTime = (value: string | null) =>
  value ? new Intl.DateTimeFormat("zh-CN", { hour12: false, dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "N/A";

const hostStatusTone: Record<string, string> = {
  online: "is-online",
  degraded: "is-degraded",
  offline: "is-offline"
};

const sessionStatusTone: Record<string, string> = {
  bootstrapping: "is-degraded",
  idle: "is-online",
  running: "is-online",
  waiting_human: "is-degraded",
  waiting_child: "is-degraded",
  failed: "is-offline",
  cleared: "is-offline"
};

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const machinesQuery = useQuery({
    queryKey: ["machines"],
    queryFn: () => fetchJson<Machine[]>("/machines")
  });

  const mailboxesQuery = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => fetchJson<Mailbox[]>("/mailboxes")
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetchJson<Session[]>("/sessions"),
    refetchInterval: 5000
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => fetchJson<Task[]>("/tasks"),
    refetchInterval: 5000
  });

  const selectedSessionQuery = useQuery({
    queryKey: ["session", selectedSessionId],
    queryFn: () => fetchJson<Session>(`/sessions/${selectedSessionId}`),
    enabled: Boolean(selectedSessionId),
    refetchInterval: 5000
  });

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data && sessionsQuery.data.length > 0) {
      setSelectedSessionId(sessionsQuery.data[0].session_id);
    }
  }, [selectedSessionId, sessionsQuery.data]);

  const clearSessionMutation = useMutation({
    mutationFn: async (session: Session) =>
      fetchJson<{ ok: boolean }>(`/sessions/${session.session_id}/clear`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          mailbox: session.mailbox,
          requested_by: "human-user",
          force: false
        })
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId] })
      ]);
    }
  });

  const machines = machinesQuery.data ?? [];
  const mailboxes = mailboxesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const selectedSession = selectedSessionQuery.data ?? sessions.find((session) => session.session_id === selectedSessionId) ?? null;

  const mailboxById = Object.fromEntries(mailboxes.map((mailbox) => [mailbox.mailbox, mailbox]));
  const machineById = Object.fromEntries(machines.map((machine) => [machine.machine_id, machine]));

  const activeTaskCountByMailbox = tasks.reduce<Record<string, number>>((acc, task) => {
    if (!task.assignee_mailbox || task.status === "done") {
      return acc;
    }

    acc[task.assignee_mailbox] = (acc[task.assignee_mailbox] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="operator-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Agent Mail Operator</p>
          <h1>Hosts, sessions, and mailbox runtime state</h1>
          <p className="hero-copy">
            Inspect which machine owns a mailbox, which session it is using, and clear stuck session bindings without dropping into the terminal.
          </p>
        </div>
        <div className="hero-stats">
          <article>
            <span>Hosts</span>
            <strong>{machines.length}</strong>
          </article>
          <article>
            <span>Sessions</span>
            <strong>{sessions.length}</strong>
          </article>
          <article>
            <span>Open tasks</span>
            <strong>{tasks.filter((task) => task.status !== "done").length}</strong>
          </article>
        </div>
      </header>

      <section className="host-strip">
        {machines.map((machine) => {
          const machineMailboxes = mailboxes.filter((mailbox) => mailbox.machine_id === machine.machine_id);
          const machineSessions = sessions.filter((session) => session.machine_id === machine.machine_id && session.session_status !== "cleared");

          return (
            <article className="host-card" key={machine.machine_id}>
              <div className="card-head">
                <div>
                  <h2>{machine.label}</h2>
                  <p>{machine.machine_id}</p>
                </div>
                <span className={`status-pill ${hostStatusTone[machine.host_status] ?? ""}`}>
                  {machine.host_status}
                </span>
              </div>
              <div className="host-meta">
                <span>{machineMailboxes.length} mailboxes</span>
                <span>{machineSessions.length} active sessions</span>
                <span>heartbeat {formatTime(machine.last_heartbeat_at)}</span>
              </div>
            </article>
          );
        })}
      </section>

      <main className="operator-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Sessions</p>
              <h2>Mailbox sessions</h2>
            </div>
          </div>
          <div className="session-list">
            {sessions.map((session) => {
              const mailbox = mailboxById[session.mailbox];
              const machine = machineById[session.machine_id];
              const isSelected = session.session_id === selectedSessionId;

              return (
                <button
                  className={`session-card ${isSelected ? "is-selected" : ""}`}
                  key={session.session_id}
                  onClick={() => setSelectedSessionId(session.session_id)}
                  type="button"
                >
                  <div className="card-head">
                    <div>
                      <h3>{mailbox?.name ?? session.mailbox}</h3>
                      <p>{session.mailbox}</p>
                    </div>
                    <span className={`status-pill ${sessionStatusTone[session.session_status] ?? ""}`}>
                      {session.session_status}
                    </span>
                  </div>
                  <div className="session-meta">
                    <span>{mailbox?.role ?? "unknown role"}</span>
                    <span>{machine?.label ?? session.machine_id}</span>
                    <span>{activeTaskCountByMailbox[session.mailbox] ?? 0} active tasks</span>
                  </div>
                  <p className="summary">{session.latest_summary ?? "No summary captured yet."}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel detail-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Detail</p>
              <h2>Session detail</h2>
            </div>
            {selectedSession ? (
              <button
                className="danger-button"
                disabled={clearSessionMutation.isPending || selectedSession.session_status === "cleared"}
                onClick={() => clearSessionMutation.mutate(selectedSession)}
                type="button"
              >
                Clear Session
              </button>
            ) : null}
          </div>

          {selectedSession ? (
            <div className="detail-stack">
              <div className="detail-grid">
                <article>
                  <span>Agent</span>
                  <strong>{mailboxById[selectedSession.mailbox]?.name ?? selectedSession.mailbox}</strong>
                </article>
                <article>
                  <span>Role</span>
                  <strong>{mailboxById[selectedSession.mailbox]?.role ?? "unknown"}</strong>
                </article>
                <article>
                  <span>Mailbox</span>
                  <strong>{selectedSession.mailbox}</strong>
                </article>
                <article>
                  <span>Machine</span>
                  <strong>{machineById[selectedSession.machine_id]?.label ?? selectedSession.machine_id}</strong>
                </article>
                <article>
                  <span>Workspace</span>
                  <strong>{selectedSession.workspace_path}</strong>
                </article>
                <article>
                  <span>Session id</span>
                  <strong>{selectedSession.session_id}</strong>
                </article>
                <article>
                  <span>Active task count</span>
                  <strong>{activeTaskCountByMailbox[selectedSession.mailbox] ?? 0}</strong>
                </article>
                <article>
                  <span>Last heartbeat</span>
                  <strong>{formatTime(selectedSession.last_heartbeat_at)}</strong>
                </article>
                <article>
                  <span>Last processed message</span>
                  <strong>{selectedSession.last_processed_message_id ?? "N/A"}</strong>
                </article>
                <article>
                  <span>Active task id</span>
                  <strong>{selectedSession.active_task_id ?? "N/A"}</strong>
                </article>
              </div>

              <article className="summary-block">
                <span>Latest summary</span>
                <p>{selectedSession.latest_summary ?? "No summary captured yet."}</p>
              </article>
            </div>
          ) : (
            <div className="empty-state">Select a session to inspect its machine, workspace, and control-plane state.</div>
          )}
        </section>
      </main>
    </div>
  );
};
