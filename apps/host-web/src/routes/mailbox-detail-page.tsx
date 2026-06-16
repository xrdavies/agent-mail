import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { MailboxActions } from "../components/mailbox-actions.js";
import { getHostWebMailboxDetail, removeMailboxBinding } from "../lib/api.js";
import { detailSummary, formatTimestamp, mailboxDetailPath, statusChipClass } from "../lib/view.js";

export function MailboxDetailPage() {
  const { mailbox = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["host-web", "mailbox", mailbox],
    queryFn: () => getHostWebMailboxDetail(mailbox),
    enabled: mailbox.length > 0
  });

  const removeBinding = useMutation({
    mutationFn: () => removeMailboxBinding(mailbox),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
      navigate("/mailboxes");
    }
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

  const canConfirmRemove = confirmValue.trim() === data.profile.mailbox;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{data.profile.mailbox}</h2>
            <p className="panel-copy">{data.profile.name ?? "-"} / {data.profile.role ?? "-"}</p>
            <p className="panel-copy">{detailSummary(data)}</p>
          </div>
          <div className="chip-row">
            <span className={`chip ${statusChipClass(data.binding.binding_status)}`}>binding {data.binding.binding_status}</span>
            <span className={`chip ${statusChipClass(data.runtime.management_status)}`}>management {data.runtime.management_status}</span>
            <span className={`chip ${statusChipClass(data.runtime.runtime_status)}`}>runtime {data.runtime.runtime_status}</span>
          </div>
        </div>
      </section>

      <section className="grid-2 mailbox-detail-primary-grid">
        <article className="panel mailbox-detail-compact-panel">
          <h2 className="panel-title">Runtime &amp; Recovery</h2>
          <div className="definition-list">
            <div>
              <dt>Management</dt>
              <dd>{data.runtime.management_status}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>{data.runtime.runtime_status}</dd>
            </div>
            <div>
              <dt>Current Session</dt>
              <dd>{data.runtime.current_session_id ?? "-"}</dd>
            </div>
            <div>
              <dt>Active Task</dt>
              <dd>{data.runtime.active_task_id ?? "-"}</dd>
            </div>
            <div>
              <dt>Unread</dt>
              <dd>{data.runtime.pending_unread_count}</dd>
            </div>
            <div>
              <dt>Last Processed</dt>
              <dd>{data.runtime.last_processed_delivery_id ?? "-"}</dd>
            </div>
            <div>
              <dt>Last Error</dt>
              <dd>{data.runtime.last_error ?? "-"}</dd>
            </div>
            <div>
              <dt>Next Resume After</dt>
              <dd>{formatTimestamp(data.runtime.next_resume_after)}</dd>
            </div>
            <div>
              <dt>Suggested Action</dt>
              <dd>{data.recovery.suggested_action}</dd>
            </div>
          </div>
          <MailboxActions mailbox={data.profile.mailbox} actions={data.available_actions} showClearFailure />
        </article>

        <article className="panel mailbox-detail-compact-panel">
          <h2 className="panel-title">Identity &amp; Context</h2>
          <div className="definition-list">
            <div>
              <dt>Mailbox</dt>
              <dd>{data.profile.mailbox}</dd>
            </div>
            <div>
              <dt>Name / Role</dt>
              <dd>{data.profile.name ?? "-"} · {data.profile.role ?? "-"} · {data.profile.responsibilities ?? "-"}</dd>
            </div>
            <div>
              <dt>Binding</dt>
              <dd>{data.binding.binding_status}</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd>{data.binding.host_id}</dd>
            </div>
            <div>
              <dt>Bound At</dt>
              <dd>{formatTimestamp(data.binding.bound_at)}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{data.workspace.workspace_path}</dd>
            </div>
            <div>
              <dt>Git Identity</dt>
              <dd>{data.workspace.git_user_name} · {data.workspace.git_user_email}</dd>
            </div>
            <div>
              <dt>Bootstrap</dt>
              <dd>{data.bootstrap.bootstrap_status}</dd>
            </div>
            <div>
              <dt>Last Bootstrap</dt>
              <dd>{formatTimestamp(data.bootstrap.last_bootstrap_at)}</dd>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <h2 className="panel-title">Recent Host Events</h2>
        <div className="timeline host-action-state-row">
          {data.recent_events.length === 0 ? (
            <div className="timeline-item">
              <h4>No recent events</h4>
            </div>
          ) : (
            data.recent_events.map((event, index) => (
              <div className="timeline-item" key={`${event.title}-${event.at}-${index}`}>
                <h4>{formatTimestamp(event.at)} {event.title}</h4>
                <p>{event.message ?? "-"}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel danger-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Danger Zone</h2>
            <p className="panel-copy">Remove this mailbox from current Host management.</p>
            <p className="panel-copy">This should be blocked while runtime is running.</p>
          </div>
          <button
            className={`button is-danger${data.available_actions.can_remove_local_binding ? "" : " is-disabled"}`}
            disabled={!data.available_actions.can_remove_local_binding}
            type="button"
            onClick={() => {
              setConfirmValue("");
              setConfirmOpen(true);
            }}
          >
            remove local binding
          </button>
        </div>
      </section>

      {confirmOpen ? (
        <div
          className="modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmOpen(false);
            }
          }}
        >
          <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="unbind-modal-title">
            <div className="modal-header">
              <div>
                <h2 className="panel-title" id="unbind-modal-title">Remove Local Binding</h2>
                <p className="panel-copy">Confirm before removing `{data.profile.mailbox}` from this Host.</p>
              </div>
              <button className="button subtle" type="button" onClick={() => setConfirmOpen(false)}>
                close
              </button>
            </div>

            <div className="body-box modal-body">
              <p className="body-copy">mailbox: {data.profile.mailbox}</p>
              <p className="body-copy">host: {data.binding.host_id}</p>
              <p className="body-copy">This will stop Host management and release the current Host binding if Central still points here.</p>
              <p className="body-copy">This will not re-bootstrap the agent and will not delete workspace files.</p>
              <label className="confirm-field">
                <span className="meta">Type mailbox to confirm</span>
                <input
                  className="toolbar-input"
                  placeholder={data.profile.mailbox}
                  type="text"
                  value={confirmValue}
                  onChange={(event) => setConfirmValue(event.target.value)}
                />
              </label>
            </div>

            <div className="button-row modal-actions">
              <button className="button subtle" type="button" onClick={() => setConfirmOpen(false)}>
                cancel
              </button>
              <button
                className={`button is-danger${canConfirmRemove ? "" : " is-disabled"}`}
                disabled={!canConfirmRemove || removeBinding.isPending}
                type="button"
                onClick={() => removeBinding.mutate()}
              >
                remove local binding
              </button>
            </div>

            {removeBinding.isError ? (
              <p className="meta error-text">
                {removeBinding.error instanceof Error ? removeBinding.error.message : String(removeBinding.error)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
