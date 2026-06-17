import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getTasks } from "../lib/api.js";

function taskChipClass(status: string): string {
  if (status === "blocked") return "danger";
  if (status === "done") return "success";
  if (status === "paused") return "warning";
  return "info";
}

export function TasksPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tasks"],
    queryFn: getTasks
  });

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Tasks</h2>
        </div>
      </div>

      {isLoading ? (
        <p className="panel-copy">Loading tasks...</p>
      ) : isError || !data ? (
        <p className="panel-copy">Failed to load tasks.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Title</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Created By</th>
              <th>Thread</th>
              <th>Trigger Email</th>
              <th>Artifact</th>
              <th>Updated</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((item) => (
              <tr key={item.task.task_id}>
                <td>
                  <Link to={`/tasks/${encodeURIComponent(item.task.task_id)}`}>
                    {item.task.task_id}
                  </Link>
                </td>
                <td>{item.task.title}</td>
                <td>
                  <span className={`chip ${taskChipClass(item.task.status)}`}>{item.task.status}</span>
                </td>
                <td>{item.task.assignee_mailbox}</td>
                <td>{item.task.created_by_mailbox}</td>
                <td>
                  <Link to={`/threads/${encodeURIComponent(item.thread.thread_id)}`}>
                    {item.thread.thread_id}
                  </Link>
                </td>
                <td>
                  <Link to={`/mails/${encodeURIComponent(item.trigger_email.email_id)}`}>
                    {item.trigger_email.email_id}
                  </Link>
                </td>
                <td>{item.artifact_count > 0 ? `${item.artifact_count} attached` : "none"}</td>
                <td>{new Date(item.task.updated_at).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                <td>
                  <Link to={`/tasks/${encodeURIComponent(item.task.task_id)}`}>detail</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
