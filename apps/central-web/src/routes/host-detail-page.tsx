import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getHostDetail, getHosts } from "../lib/api.js";

function formatTimestamp(input: string | null): string {
  if (!input) {
    return "n/a";
  }
  return new Date(input).toLocaleTimeString("zh-CN", { hour12: false });
}

function hostChipClass(status: string): string {
  if (status === "online") return "success";
  if (status === "degraded") return "warning";
  if (status === "offline" || status === "auth_failed") return "danger";
  return "info";
}

export function HostDetailPage() {
  const { hostId = "" } = useParams();

  const hostDetail = useQuery({
    queryKey: ["host-detail", hostId],
    queryFn: () => getHostDetail(hostId),
    enabled: hostId.length > 0
  });

  const hosts = useQuery({
    queryKey: ["hosts"],
    queryFn: getHosts
  });

  if (hostDetail.isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Host Detail</h2>
        <p className="panel-copy">Loading host detail...</p>
      </section>
    );
  }

  if (hostDetail.isError || !hostDetail.data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Host Detail</h2>
        <p className="panel-copy">Failed to load host detail.</p>
      </section>
    );
  }

  const summary = hosts.data?.hosts.find((item) => item.host.host_id === hostId) ?? null;
  const { host, bindings, runtimes } = hostDetail.data;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{host.host_id}</h2>
            <p className="panel-copy">
              {host.host_status} · v{host.host_version ?? "unknown"} · last heartbeat {formatTimestamp(host.last_heartbeat_at)} · last auth {formatTimestamp(host.last_authenticated_at)}
            </p>
          </div>
          <div className="chip-row">
            <span className={`chip ${hostChipClass(host.host_status)}`}>{host.host_status}</span>
            <span className="chip">{summary?.managed_mailboxes ?? bindings.length} mailboxes</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <h2 className="panel-title">Roster</h2>
          <div className="list">
            {bindings.length === 0 ? (
              <div className="list-row">
                <span className="list-row-key">No managed mailboxes</span>
              </div>
            ) : (
              bindings.map((binding) => {
                const runtime = runtimes.find((item) => item.mailbox === binding.mailbox) ?? null;
                return (
                  <div className="list-row" key={binding.binding_id}>
                    <Link className="list-row-key" to={`/mailboxes/${encodeURIComponent(binding.mailbox)}`}>
                      {binding.mailbox}
                    </Link>
                    <p className="list-row-copy">
                      {runtime?.mailbox_runtime_status ?? binding.binding_status}
                      {runtime?.active_task_id ? ` · active task ${runtime.active_task_id}` : ""}
                      {runtime?.latest_summary ? ` · ${runtime.latest_summary}` : ""}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="panel">
          <h2 className="panel-title">Runtime Health</h2>
          <div className="list">
            <div className="list-row">
              <span className="list-row-key">Unread total</span>
              <p className="list-row-copy">{summary?.unread_deliveries ?? 0}</p>
            </div>
            <div className="list-row">
              <span className="list-row-key">Running mailboxes</span>
              <p className="list-row-copy">{summary?.running_mailboxes ?? 0}</p>
            </div>
            <div className="list-row">
              <span className="list-row-key">Failed mailboxes</span>
              <p className="list-row-copy">{summary?.failed_mailboxes ?? 0}</p>
            </div>
            <div className="list-row">
              <span className="list-row-key">Snapshot rows</span>
              <p className="list-row-copy">{runtimes.length}</p>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Runtime Snapshot Table</h2>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Mailbox</th>
              <th>Session</th>
              <th>Status</th>
              <th>Active Task</th>
              <th>Latest Summary</th>
            </tr>
          </thead>
          <tbody>
            {runtimes.length === 0 ? (
              <tr>
                <td colSpan={5}>No runtime snapshots.</td>
              </tr>
            ) : (
              runtimes.map((runtime) => (
                <tr key={runtime.mailbox}>
                  <td>
                    <Link to={`/mailboxes/${encodeURIComponent(runtime.mailbox)}`}>{runtime.mailbox}</Link>
                  </td>
                  <td>{runtime.current_session_id ?? "-"}</td>
                  <td>{runtime.mailbox_runtime_status}</td>
                  <td>{runtime.active_task_id ?? "-"}</td>
                  <td>{runtime.latest_summary ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
