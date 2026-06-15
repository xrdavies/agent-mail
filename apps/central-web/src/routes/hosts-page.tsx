import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getHosts } from "../lib/api.js";

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

export function HostsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["hosts"],
    queryFn: getHosts
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Hosts</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="panel-copy">Loading hosts...</p>
      ) : isError || !data ? (
        <p className="panel-copy">Failed to load hosts.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Host</th>
              <th>Status</th>
              <th>Heartbeat</th>
              <th>Managed Mailboxes</th>
              <th>Unread</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.hosts.map((item) => (
              <tr key={item.host.host_id}>
                <td>
                  <Link to={`/hosts/${encodeURIComponent(item.host.host_id)}`}>{item.host.host_id}</Link>
                </td>
                <td>
                  <span className={`chip ${hostChipClass(item.host.host_status)}`}>
                    {item.host.host_status}
                  </span>
                </td>
                <td>{formatTimestamp(item.host.last_heartbeat_at)}</td>
                <td>{item.managed_mailboxes}</td>
                <td>{item.unread_deliveries}</td>
                <td>
                  <Link to={`/hosts/${encodeURIComponent(item.host.host_id)}`}>detail</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
