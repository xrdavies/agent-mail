import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { getTaskDetail } from "../lib/api.js";

function taskChipClass(status: string): string {
  if (status === "blocked") return "danger";
  if (status === "done") return "success";
  if (status === "paused") return "warning";
  return "info";
}

function formatTimestamp(input: string): string {
  return new Date(input).toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

export function TaskDetailPage() {
  const { taskId = "" } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["task-detail", taskId],
    queryFn: () => getTaskDetail(taskId),
    enabled: taskId.length > 0
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Task Detail</h2>
        <p className="panel-copy">Loading task detail...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Task Detail</h2>
        <p className="panel-copy">Failed to load task detail.</p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{data.task.title}</h2>
            <p className="panel-copy">
              {data.task.status} · assignee {data.task.assignee_mailbox} · created by{" "}
              {data.task.created_by_mailbox} · created {formatTimestamp(data.task.created_at)} · updated{" "}
              {formatTimestamp(data.task.updated_at)}
            </p>
          </div>
          <div className="chip-row">
            <span className={`chip ${taskChipClass(data.task.status)}`}>{data.task.status}</span>
            <span className="chip">{data.task.requires_artifact ? "artifact required" : "no artifact"}</span>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel">
          <h2 className="panel-title">Task Links</h2>
          <div className="definition-list">
            <div>
              <dt>Thread</dt>
              <dd>
                <Link to={`/threads/${encodeURIComponent(data.thread.thread_id)}`}>
                  {data.thread.thread_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Trigger Email</dt>
              <dd>
                <Link to={`/mails/${encodeURIComponent(data.trigger_email.email_id)}`}>
                  {data.trigger_email.email_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Completed Email</dt>
              <dd>
                {data.completed_by_email ? (
                  <Link to={`/mails/${encodeURIComponent(data.completed_by_email.email_id)}`}>
                    {data.completed_by_email.email_id}
                  </Link>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>Parent Task</dt>
              <dd>
                {data.task.parent_task_id ? (
                  <Link to={`/tasks/${encodeURIComponent(data.task.parent_task_id)}`}>
                    {data.task.parent_task_id}
                  </Link>
                ) : (
                  "-"
                )}
              </dd>
            </div>
          </div>
        </article>

        <article className="panel">
          <h2 className="panel-title">Instructions</h2>
          <div className="body-box body-copy">
            {(data.task.instructions ?? "-").split("\n").map((line, index) => (
              <p key={`${index}-${line}`}>{line || "\u00a0"}</p>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Artifacts</h2>
          </div>
        </div>

        {data.artifacts.length === 0 ? (
          <p className="panel-copy">No artifacts attached yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Path</th>
                <th>Branch</th>
                <th>PR Link</th>
                <th>Produced By</th>
              </tr>
            </thead>
            <tbody>
              {data.artifacts.map((artifact) => (
                <tr key={artifact.artifact_id}>
                  <td>{artifact.repository ?? "-"}</td>
                  <td>{artifact.path}</td>
                  <td>{artifact.branch ?? "-"}</td>
                  <td>
                    {artifact.pr_link ? (
                      <a href={artifact.pr_link} target="_blank" rel="noreferrer">
                        {artifact.pr_link}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{artifact.produced_by_mailbox}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
