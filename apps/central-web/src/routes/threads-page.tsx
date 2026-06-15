import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getThreads } from "../lib/api.js";

function threadChipClass(status: string): string {
  if (status === "blocked") return "danger";
  if (status === "waiting_human") return "warning";
  if (status === "completed") return "success";
  return "info";
}

export function ThreadsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["threads"],
    queryFn: getThreads
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Context List</p>
          <h2 className="panel-title">Threads</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="panel-copy">Loading threads...</p>
      ) : isError || !data ? (
        <p className="panel-copy">Failed to load threads.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Thread</th>
              <th>Title</th>
              <th>Status</th>
              <th>Participants</th>
              <th>Latest Mail</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.threads.map((item) => (
              <tr key={item.thread.thread_id}>
                <td>
                  <Link to={`/threads/${encodeURIComponent(item.thread.thread_id)}`}>
                    {item.thread.thread_id}
                  </Link>
                </td>
                <td>{item.thread.root_subject}</td>
                <td>
                  <span className={`chip ${threadChipClass(item.thread.thread_status)}`}>
                    {item.thread.thread_status}
                  </span>
                </td>
                <td>{item.participants.join(", ")}</td>
                <td>
                  {item.latest_email ? (
                    <Link to={`/mails/${encodeURIComponent(item.latest_email.email_id)}`}>
                      {item.latest_email.subject}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  <Link to={`/threads/${encodeURIComponent(item.thread.thread_id)}`}>detail</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
