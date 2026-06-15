import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getMailboxDetail } from "../lib/api.js";

function formatTimestamp(input: string): string {
  return new Date(input).toLocaleTimeString("zh-CN", { hour12: false });
}

function runtimeChipClass(status: string | null | undefined): string {
  if (status === "running") return "success";
  if (status === "failed") return "danger";
  return "info";
}

export function MailboxDetailPage() {
  const { mailbox = "" } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mailbox-detail", mailbox],
    queryFn: () => getMailboxDetail(mailbox),
    enabled: mailbox.length > 0
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Mailbox Detail</h2>
        <p className="panel-copy">Loading mailbox detail...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Mailbox Detail</h2>
        <p className="panel-copy">Failed to load mailbox detail.</p>
      </section>
    );
  }

  const preview = data.activity[0] ?? null;
  const unreadCount = data.activity.filter(
    (item) => item.direction === "received" && item.delivery?.read_status === "unread"
  ).length;
  const sentCount = data.activity.filter((item) => item.direction === "sent").length;
  const receivedCount = data.activity.filter((item) => item.direction === "received").length;
  const openTasks = data.tasks.filter((task) => task.status !== "done");

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Mailbox Summary</p>
            <h2 className="panel-title">{data.profile.mailbox}</h2>
            <p className="panel-copy">
              {data.profile.name} / {data.profile.role} · {data.binding?.binding_status ?? "unbound"} · host{" "}
              {data.host?.host_id ?? "-"} · session {data.runtime?.current_session_id ?? "-"}
            </p>
            <p className="panel-copy">
              unread: {unreadCount} · sent today: {sentCount} · received today: {receivedCount} · open tasks:{" "}
              {openTasks.length}
            </p>
          </div>
          {data.host ? (
            <Link className="button" to={`/hosts/${encodeURIComponent(data.host.host_id)}`}>
              Host
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <p className="eyebrow">Runtime</p>
          <h2 className="panel-title">Mailbox Runtime</h2>
          <div className="definition-list">
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`chip ${runtimeChipClass(data.runtime?.mailbox_runtime_status)}`}>
                  {data.runtime?.mailbox_runtime_status ?? data.binding?.binding_status ?? "unknown"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Last processed delivery</dt>
              <dd>{data.runtime?.last_processed_delivery_id ?? "-"}</dd>
            </div>
            <div>
              <dt>Latest summary</dt>
              <dd>{data.runtime?.latest_summary ?? "-"}</dd>
            </div>
          </div>
        </article>

        <div className="stack">
          <article className="panel">
            <p className="eyebrow">Related Threads</p>
            <h2 className="panel-title">Active Threads</h2>
            <div className="list">
              {data.threads.map((thread) => (
                <div className="list-row" key={thread.thread_id}>
                  <Link className="list-row-key" to={`/threads/${encodeURIComponent(thread.thread_id)}`}>
                    {thread.thread_id}
                  </Link>
                  <p className="list-row-copy">
                    {thread.thread_status} · latest {thread.latest_email_id ?? "-"} · {thread.root_subject}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Open Tasks</p>
            <h2 className="panel-title">Tasks</h2>
            <div className="list">
              {openTasks.length === 0 ? (
                <div className="list-row">
                  <span className="list-row-key">No open tasks</span>
                </div>
              ) : (
                openTasks.map((task) => (
                  <div className="list-row" key={task.task_id}>
                    <span className="list-row-key">
                      {task.task_id} {task.status}
                    </span>
                    <p className="list-row-copy">{task.assignee_mailbox}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">完整收发活动</h2>
          </div>
        </div>
        <div className="mailbox-activity-filters">
          <div className="chip-row">
            <span className="chip active">All Mail</span>
            <span className="chip">Inbox</span>
            <span className="chip">Sent</span>
            <span className="chip">Unread</span>
            <span className="chip">Thread</span>
            <span className="chip">Kind</span>
            <span className="chip">Date Range</span>
          </div>
          <div className="button-row">
            <span className="button subtle">Search</span>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Direction</th>
              <th>Counterparty</th>
              <th>Subject</th>
              <th>Thread</th>
              <th>Mail</th>
            </tr>
          </thead>
          <tbody>
            {data.activity.map((item) => (
              <tr key={`${item.direction}-${item.email.email_id}`}>
                <td>{formatTimestamp(item.email.created_at)}</td>
                <td>
                  <span className={`chip ${item.direction === "sent" ? "info" : "warning"}`}>
                    {item.direction}
                  </span>
                </td>
                <td>
                  {item.direction === "sent"
                    ? item.email.to[0]?.address ?? item.email.cc[0]?.address ?? "-"
                    : item.email.from.address}
                </td>
                <td>{item.email.subject}</td>
                <td>
                  <Link to={`/threads/${encodeURIComponent(item.email.thread_id)}`}>
                    {item.email.thread_id}
                  </Link>
                </td>
                <td>
                  <Link to={`/mails/${encodeURIComponent(item.email.email_id)}`}>{item.email.email_id}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <p className="eyebrow">Selected Activity Preview</p>
        <h2 className="panel-title">Preview</h2>
        <div className="body-box">
          {preview ? (
            <>
              <p className="body-copy">
                From: {preview.email.from.display_name} &lt;{preview.email.from.address}&gt;
                <br />
                To:{" "}
                {preview.email.to.map((item) => `${item.display_name} <${item.address}>`).join(", ") || "-"}
                <br />
                Subject: {preview.email.subject}
              </p>
              <p>{preview.email.body_text}</p>
            </>
          ) : (
            <p>No preview available.</p>
          )}
        </div>
        {preview ? (
          <div className="button-row">
            <Link className="button subtle" to={`/mails/${encodeURIComponent(preview.email.email_id)}`}>
              Open Mail Detail
            </Link>
            <Link className="button subtle" to={`/threads/${encodeURIComponent(preview.email.thread_id)}`}>
              Open Thread
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}
