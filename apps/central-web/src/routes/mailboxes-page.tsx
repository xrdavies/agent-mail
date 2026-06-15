import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getMailboxes } from "../lib/api.js";

function runtimeChipClass(status: string | null | undefined): string {
  if (status === "running") return "success";
  if (status === "failed") return "danger";
  return "info";
}

export function MailboxesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: getMailboxes
  });

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Roster</p>
            <h2 className="panel-title">Mailbox List</h2>
          </div>
        </div>

        {isLoading ? (
          <p className="panel-copy">Loading mailboxes...</p>
        ) : isError || !data ? (
          <p className="panel-copy">Failed to load mailboxes.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Runtime</th>
                <th>Unread</th>
                <th>Active Task</th>
                <th>Host</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {data.mailboxes.map((item) => (
                <tr key={item.profile.mailbox}>
                  <td>
                    <Link to={`/mailboxes/${encodeURIComponent(item.profile.mailbox)}`}>
                      {item.profile.mailbox}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`chip ${runtimeChipClass(item.runtime?.mailbox_runtime_status)}`}
                    >
                      {item.runtime?.mailbox_runtime_status ?? item.binding?.binding_status ?? "unknown"}
                    </span>
                  </td>
                  <td>{item.unread_deliveries}</td>
                  <td>{item.runtime?.active_task_id ?? "-"}</td>
                  <td>
                    {item.host ? (
                      <Link to={`/hosts/${encodeURIComponent(item.host.host_id)}`}>{item.host.host_id}</Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    <Link to={`/mailboxes/${encodeURIComponent(item.profile.mailbox)}`}>detail</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
