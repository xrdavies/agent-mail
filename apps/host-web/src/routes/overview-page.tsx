import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { MailboxActions } from "../components/mailbox-actions.js";
import { getHostWebOverview, reauthenticateHost } from "../lib/api.js";
import { formatShortTimestamp, mailboxDetailPath, statusChipClass, summarizeMailboxCopy } from "../lib/view.js";

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function OverviewPage() {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["host-web", "overview"],
    queryFn: getHostWebOverview
  });

  const reauth = useMutation({
    mutationFn: reauthenticateHost,
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  if (isLoading) {
    return (
      <section className="panel">
        <h2 className="panel-title">Overview</h2>
        <p className="panel-copy">Loading host overview...</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="panel">
        <h2 className="panel-title">Overview</h2>
        <p className="panel-copy">Failed to load Host Web overview.</p>
      </section>
    );
  }

  return (
    <>
      <section className="stats-grid overview-stats-grid">
        <article className="stat-card overview-stat-card">
          <p className="stat-label">Managed</p>
          <p className="stat-value">{data.counters.managed_mailboxes}</p>
        </article>
        <article className="stat-card overview-stat-card">
          <p className="stat-label">Enabled</p>
          <p className="stat-value">{data.counters.enabled_mailboxes}</p>
        </article>
        <article className="stat-card overview-stat-card">
          <p className="stat-label">Failed</p>
          <p className="stat-value">{data.counters.failed_mailboxes}</p>
        </article>
        <article className="stat-card overview-stat-card">
          <p className="stat-label">Stuck Unread</p>
          <p className="stat-value">{data.counters.stuck_unread_mailboxes}</p>
        </article>
      </section>

      <section className="grid-2 overview-primary-grid">
        <article className="panel overview-compact-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Host Summary</p>
              <h2 className="panel-title">{data.host.host_id}</h2>
              <p className="panel-copy">
                {data.host.host_status} · v{data.host.host_version} · started {formatShortTimestamp(data.host.started_at)} · local runtime console
              </p>
            </div>
            <div className="chip-row">
              <span className={`chip ${statusChipClass(data.host.host_status)}`}>{data.host.host_status}</span>
              <span className="chip">node 24</span>
              <span className="chip">mcp enabled</span>
            </div>
          </div>
          <div className="definition-list">
            <div>
              <dt>Central</dt>
              <dd>{data.auth.central_base_url}</dd>
            </div>
            <div>
              <dt>Authenticated</dt>
              <dd>
                {data.auth.authenticated ? "yes" : "no"} · last auth {formatShortTimestamp(data.auth.last_authenticated_at)} · last auth error {data.auth.last_auth_error ?? "-"}
              </dd>
            </div>
            <div>
              <dt>Heartbeat</dt>
              <dd>{formatShortTimestamp(data.auth.last_heartbeat_at)} · interval 5s</dd>
            </div>
          </div>
          <div className="button-row">
            <button className="button" disabled={reauth.isPending} type="button" onClick={() => reauth.mutate()}>
              re-auth
            </button>
          </div>
          {errorMessage ? <p className="meta error-text">{errorMessage}</p> : null}
        </article>

        <article className="panel overview-compact-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">MCP Access</p>
              <h2 className="panel-title">Connection Handoff</h2>
              <p className="panel-copy">Expose the local Host MCP endpoint without leaking Central token details.</p>
            </div>
          </div>
          <div className="body-box host-code-block overview-code-block">
            <p className="body-copy mono">command</p>
            <p className="body-copy">{data.mcp.command}</p>
            <p className="body-copy mono">toml</p>
            <p className="body-copy">{data.mcp.toml}</p>
          </div>
          <div className="button-row">
            <button className="button subtle" type="button" onClick={() => void copyToClipboard(data.mcp.command)}>
              copy command
            </button>
            <button
              className="button subtle"
              type="button"
              onClick={() => void copyToClipboard(JSON.stringify(data.mcp.json, null, 2))}
            >
              copy json
            </button>
            <button className="button subtle" type="button" onClick={() => void copyToClipboard(data.mcp.toml)}>
              copy toml
            </button>
          </div>
        </article>
      </section>

      <section className="panel overview-attention-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Mailboxes That Need Human Attention</h2>
          </div>
          <Link className="button subtle" to="/mailboxes">
            Open full roster
          </Link>
        </div>
        <div className="list overview-attention-list">
          {data.attention_mailboxes.length === 0 ? (
            <div className="list-row">
              <span className="list-row-key">No attention mailboxes</span>
            </div>
          ) : (
            data.attention_mailboxes.map((mailbox) => (
              <div className="list-row overview-attention-row" key={mailbox.mailbox}>
                <div className="row-between">
                  <div>
                    <Link className="list-row-key" to={mailboxDetailPath(mailbox.mailbox)}>
                      {mailbox.mailbox}
                    </Link>
                    <p className="list-row-copy">{summarizeMailboxCopy(mailbox)}</p>
                  </div>
                  <span className={`chip ${statusChipClass(mailbox.runtime_status)}`}>{mailbox.management_status === "disabled" ? "disabled" : mailbox.runtime_status}</span>
                </div>
                <div className="overview-row-actions">
                  <Link className="button subtle" to={mailboxDetailPath(mailbox.mailbox)}>
                    detail
                  </Link>
                  <MailboxActions mailbox={mailbox.mailbox} actions={mailbox.available_actions} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel note-panel overview-note-panel">
        <h2 className="panel-title">Bootstrap stays in the agent session.</h2>
        <p className="panel-copy">
          If a mailbox failed during bootstrap, Host Web only shows the error state. Return to the agent workspace or session and retry bootstrap there.
        </p>
      </section>
    </>
  );
}
