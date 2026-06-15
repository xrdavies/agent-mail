import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getMailDetail } from "../lib/api.js";

function formatTimestamp(input: string | null): string {
  if (!input) {
    return "n/a";
  }
  return new Date(input).toLocaleTimeString("zh-CN", { hour12: false });
}

function mailChipClass(kind: string): string {
  if (kind === "human_inbound") return "warning";
  if (kind === "agent_reply") return "success";
  if (kind === "agent_delegation") return "info";
  return "info";
}

export function MailDetailPage() {
  const { emailId = "" } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mail-detail", emailId],
    queryFn: () => getMailDetail(emailId),
    enabled: emailId.length > 0
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Mail Detail</h2>
        <p className="panel-copy">Loading mail detail...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Mail Detail</h2>
        <p className="panel-copy">Failed to load mail detail.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{data.subject}</h2>
            <p className="panel-copy">
              {data.email_kind} · {data.send_state} · created {formatTimestamp(data.created_at)} · thread{" "}
              {data.thread_id} · message-id {data.message_id}
            </p>
          </div>
          <div className="chip-row">
            <span className={`chip ${mailChipClass(data.email_kind)}`}>{data.email_kind}</span>
            <span className="chip success">{data.send_state}</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <p className="eyebrow">Envelope</p>
          <div className="definition-list">
            <div>
              <dt>From</dt>
              <dd>{data.from.display_name} &lt;{data.from.address}&gt;</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>
                {data.to.map((item) => `${item.display_name} <${item.address}>`).join(", ") || "-"}
              </dd>
            </div>
            <div>
              <dt>Cc</dt>
              <dd>
                {data.cc.length > 0
                  ? data.cc.map((item) => `${item.display_name} <${item.address}>`).join(", ")
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>In-Reply-To</dt>
              <dd>{data.in_reply_to ?? "-"}</dd>
            </div>
            <div>
              <dt>References</dt>
              <dd>
                {data.references.length === 0 ? (
                  "-"
                ) : (
                  <details className="inline-details">
                    <summary>{data.references.length} linked messages</summary>
                    <div className="inline-details-content">
                      {data.references.map((reference) => (
                        <div className="mono" key={reference}>
                          {reference}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </dd>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="definition-list">
            <div>
              <dt>Thread</dt>
              <dd>
                <Link to={`/threads/${encodeURIComponent(data.thread_id)}`}>{data.thread_id}</Link>
              </dd>
            </div>
            <div>
              <dt>Created By Mailbox</dt>
              <dd>{data.created_by_mailbox ?? "-"}</dd>
            </div>
            <div>
              <dt>Created By Host</dt>
              <dd>{data.created_by_host_id ?? "-"}</dd>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <p className="eyebrow">Body</p>
        <div className="body-box">
          {data.body_text.split("\n").map((line, index) => (
            <p key={`${index}-${line}`}>{line || "\u00a0"}</p>
          ))}
        </div>
      </section>
    </>
  );
}
