import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getWebOverview } from "../lib/api.js";

function formatTimestamp(input: string): string {
  return new Date(input).toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

function mailboxDetailPath(mailbox: string | null | undefined): string {
  return mailbox ? `/mailboxes/${encodeURIComponent(mailbox)}` : "/mailboxes";
}

function threadDetailPath(threadId: string | null | undefined): string {
  return threadId ? `/threads/${encodeURIComponent(threadId)}` : "/threads";
}

function mailDetailPath(emailId: string | null | undefined): string {
  return emailId ? `/mails/${encodeURIComponent(emailId)}` : "/mails";
}

function hostDetailPath(hostId: string | null | undefined): string {
  return hostId ? `/hosts/${encodeURIComponent(hostId)}` : "/hosts";
}

export function OverviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["web-overview"],
    queryFn: getWebOverview
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Overview</h2>
        <p className="panel-copy">Loading overview...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Overview</h2>
        <p className="panel-copy">Failed to load overview.</p>
      </section>
    );
  }

  return (
    <>
      <section className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Unread Deliveries</p>
          <p className="stat-value">{data.counters.unread_deliveries}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Waiting Human</p>
          <p className="stat-value">{data.counters.waiting_human_threads}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Blocked Tasks</p>
          <p className="stat-value">{data.counters.blocked_tasks}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Online Hosts</p>
          <p className="stat-value">{data.counters.online_hosts}</p>
        </article>
      </section>

      <section className="grid-2">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Oldest Unread Queue</h2>
            </div>
            <Link className="button subtle" to="/mailboxes">
              Open Mailboxes
            </Link>
          </div>
          <div className="list">
            {data.oldest_unread.length === 0 ? (
              <div className="list-row">
                <span className="list-row-key">No unread deliveries</span>
              </div>
            ) : (
              data.oldest_unread.map((item) => (
                <div className="list-row" key={item.delivery.delivery_id}>
                  <Link
                    className="list-row-key"
                    to={mailboxDetailPath(item.delivery.recipient_mailbox)}
                  >
                    {item.delivery.recipient_mailbox ?? item.delivery.recipient_address}
                  </Link>
                  <p className="list-row-copy">
                    {formatTimestamp(item.delivery.created_at)} · {item.email.email_kind} · {item.email.subject}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Host Health</h2>
            </div>
            <Link className="button subtle" to="/hosts">
              Open Hosts
            </Link>
          </div>
          <div className="list">
            {data.host_health.map((item) => (
              <div className="list-row" key={item.host.host_id}>
                <Link className="list-row-key" to={hostDetailPath(item.host.host_id)}>
                  {item.host.host_id}
                </Link>
                <p className="list-row-copy">
                  {item.host.host_status} · heartbeat {item.host.last_heartbeat_at ? formatTimestamp(item.host.last_heartbeat_at) : "n/a"} · manages {item.managed_mailboxes} mailboxes
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Waiting Human / Blocked Threads</h2>
          </div>
          <Link className="button subtle" to="/threads">
            Open Threads
          </Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Thread</th>
              <th>Status</th>
              <th>Participants</th>
              <th>Latest</th>
              <th>Next View</th>
            </tr>
          </thead>
          <tbody>
            {data.attention_threads.length === 0 ? (
              <tr>
                <td colSpan={5}>No attention threads.</td>
              </tr>
            ) : (
              data.attention_threads.map((item) => (
                <tr key={item.thread.thread_id}>
                  <td>
                    <Link to={threadDetailPath(item.thread.thread_id)}>{item.thread.thread_id}</Link>
                  </td>
                  <td>
                    <span className={`chip ${item.thread.thread_status === "blocked" ? "danger" : "warning"}`}>
                      {item.thread.thread_status}
                    </span>
                  </td>
                  <td>{item.participants.join(", ")}</td>
                  <td>{item.latest_email?.subject ?? item.thread.root_subject}</td>
                  <td>
                    <Link to={mailDetailPath(item.latest_email?.email_id ?? item.thread.latest_email_id)}>
                      latest mail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="grid-2">
        <article className="panel">
          <h2 className="panel-title">Recent Activity</h2>
          <div className="timeline">
            {data.recent_activity.length === 0 ? (
              <div className="timeline-item">
                <h4>No recent activity</h4>
              </div>
            ) : (
              data.recent_activity.map((item, index) => (
                <div className="timeline-item" key={`${item.type}-${item.at}-${index}`}>
                  <h4>
                    {item.email_id ? (
                      <Link to={mailDetailPath(item.email_id)}>
                        {formatTimestamp(item.at)} {item.title}
                      </Link>
                    ) : item.thread_id ? (
                      <Link to={threadDetailPath(item.thread_id)}>
                        {formatTimestamp(item.at)} {item.title}
                      </Link>
                    ) : item.host_id ? (
                      <Link to={hostDetailPath(item.host_id)}>
                        {formatTimestamp(item.at)} {item.title}
                      </Link>
                    ) : (
                      `${formatTimestamp(item.at)} ${item.title}`
                    )}
                  </h4>
                  <p>{item.subtitle}</p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}
