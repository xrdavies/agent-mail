import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getThreadDetail } from "../lib/api.js";

function formatTimestamp(input: string): string {
  return new Date(input).toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

function threadChipClass(status: string): string {
  if (status === "blocked") return "danger";
  if (status === "waiting_human") return "warning";
  if (status === "completed") return "success";
  return "info";
}

export function ThreadDetailPage() {
  const { threadId = "" } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["thread-detail", threadId],
    queryFn: () => getThreadDetail(threadId),
    enabled: threadId.length > 0
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Thread Detail</h2>
        <p className="panel-copy">Loading thread detail...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Thread Detail</h2>
        <p className="panel-copy">Failed to load thread detail.</p>
      </section>
    );
  }

  const participants = [
    ...new Set(
      data.emails.flatMap((email) => [
        email.from.address,
        ...email.to.map((item) => item.address),
        ...email.cc.map((item) => item.address)
      ])
    )
  ];

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{data.thread.root_subject}</h2>
            <p className="panel-copy">
              {data.thread.thread_status} · root {data.thread.root_email_id} · latest{" "}
              {data.thread.latest_email_id ?? "-"} · participants: {participants.join(" / ")}
            </p>
          </div>
          <div className="chip-row">
            <span className={`chip ${threadChipClass(data.thread.thread_status)}`}>
              {data.thread.thread_status}
            </span>
            <span className="chip">{data.emails.length} mails</span>
            <span className="chip">{data.tasks.length} tasks</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Email Timeline</h2>
            </div>
            <Link className="button subtle" to="/mails">
              Open Mails
            </Link>
          </div>

          <div className="timeline">
            {data.emails.map((email) => (
              <div className="timeline-item" key={email.email_id}>
                <h4>
                  <Link to={`/mails/${encodeURIComponent(email.email_id)}`}>
                    {email.email_id} · {formatTimestamp(email.created_at)} · {email.from.display_name}
                  </Link>
                </h4>
                <p>{email.subject}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2 className="panel-title">Tasks / Artifacts / Participants</h2>
          <div className="definition-list">
            <div>
              <dt>Tasks</dt>
              <dd>{data.tasks.length > 0 ? data.tasks.map((task) => `${task.task_id} ${task.status}`).join(" · ") : "-"}</dd>
            </div>
            <div>
              <dt>Artifacts</dt>
              <dd>-</dd>
            </div>
            <div>
              <dt>Participants</dt>
              <dd>{participants.join(" · ")}</dd>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Rendered / Raw / References / Delivery Map</h2>
          </div>
        </div>
        <div className="chip-row">
          <span className="chip active">Rendered</span>
          <span className="chip">Raw Headers</span>
          <span className="chip">References</span>
          <span className="chip">Delivery Map</span>
          <span className="chip">Debug Audit</span>
        </div>
      </section>
    </>
  );
}
