import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { MailboxActions } from "../components/mailbox-actions.js";
import { getHostWebMailboxes } from "../lib/api.js";
import { formatShortTimestamp, mailboxDetailPath, statusChipClass } from "../lib/view.js";

export function MailboxesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["host-web", "mailboxes", deferredSearch],
    queryFn: () => {
      const query = deferredSearch.trim();
      return getHostWebMailboxes(query.length > 0 ? { q: query } : undefined);
    }
  });

  return (
    <>
      <section className="stats-grid mailbox-stats-grid">
        <article className="stat-card">
          <p className="stat-label">Total</p>
          <p className="stat-value">{data?.counters.total ?? "-"}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Enabled</p>
          <p className="stat-value">{data?.counters.enabled ?? "-"}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Disabled</p>
          <p className="stat-value">{data?.counters.disabled ?? "-"}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">With Unread</p>
          <p className="stat-value">{data?.counters.with_unread ?? "-"}</p>
        </article>
      </section>

      <section className="panel mailbox-list-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Mailboxes</h2>
          </div>
          <div className="panel-header-tools">
            <label className="toolbar-search header-search">
              <input
                className="toolbar-input"
                aria-label="Search mailboxes"
                placeholder="search mailbox / name"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
        </div>

        {isLoading ? <p className="panel-copy">Loading mailboxes...</p> : null}
        {isError ? <p className="panel-copy">Failed to load mailboxes.</p> : null}

        {!isLoading && !isError && data ? (
          <table className="table host-mailbox-table">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Name</th>
                <th>Role</th>
                <th>Binding</th>
                <th>Mgmt</th>
                <th>Runtime</th>
                <th>Unread</th>
                <th>Session</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.mailboxes.length === 0 ? (
                <tr>
                  <td colSpan={10}>No mailboxes matched this search.</td>
                </tr>
              ) : (
                data.mailboxes.map((mailbox) => (
                  <tr key={mailbox.mailbox}>
                    <td>
                      <Link to={mailboxDetailPath(mailbox.mailbox)}>{mailbox.mailbox}</Link>
                    </td>
                    <td>{mailbox.name ?? "-"}</td>
                    <td>{mailbox.role ?? "-"}</td>
                    <td>
                      <span className={`chip ${statusChipClass(mailbox.binding_status)}`}>{mailbox.binding_status}</span>
                    </td>
                    <td>
                      <span className={`chip ${statusChipClass(mailbox.management_status)}`}>{mailbox.management_status}</span>
                    </td>
                    <td>
                      <span className={`chip ${statusChipClass(mailbox.runtime_status)}`}>{mailbox.runtime_status}</span>
                    </td>
                    <td>{mailbox.pending_unread_count}</td>
                    <td>{mailbox.current_session_id ?? "-"}</td>
                    <td>{formatShortTimestamp(mailbox.updated_at)}</td>
                    <td>
                      <MailboxActions mailbox={mailbox.mailbox} actions={mailbox.available_actions} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  );
}
