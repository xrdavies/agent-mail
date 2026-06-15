import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getMails } from "../lib/api.js";

function mailChipClass(kind: string): string {
  if (kind === "human_inbound") return "warning";
  if (kind === "agent_reply") return "success";
  if (kind === "agent_delegation") return "info";
  return "info";
}

export function MailsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["mails"],
    queryFn: getMails
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Mails</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="panel-copy">Loading mails...</p>
      ) : isError || !data ? (
        <p className="panel-copy">Failed to load mails.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Mail</th>
              <th>Kind</th>
              <th>From</th>
              <th>Subject</th>
              <th>Thread</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.emails.map((item) => (
              <tr key={item.email.email_id}>
                <td>
                  <Link to={`/mails/${encodeURIComponent(item.email.email_id)}`}>
                    {item.email.email_id}
                  </Link>
                </td>
                <td>
                  <span className={`chip ${mailChipClass(item.email.email_kind)}`}>
                    {item.email.email_kind}
                  </span>
                </td>
                <td>{item.email.from.address}</td>
                <td>{item.email.subject}</td>
                <td>
                  <Link to={`/threads/${encodeURIComponent(item.email.thread_id)}`}>
                    {item.email.thread_id}
                  </Link>
                </td>
                <td>
                  <Link to={`/mails/${encodeURIComponent(item.email.email_id)}`}>detail</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
