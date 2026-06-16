import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";

import { getHostWebOverview } from "./lib/api.js";
import { formatShortTimestamp } from "./lib/view.js";
import { MailboxDetailPage } from "./routes/mailbox-detail-page.js";
import { MailboxesPage } from "./routes/mailboxes-page.js";
import { OverviewPage } from "./routes/overview-page.js";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate replace to="/overview" />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/mailboxes" element={<MailboxesPage />} />
        <Route path="/mailboxes/:mailbox" element={<MailboxDetailPage />} />
      </Route>
    </Routes>
  );
}

function Shell() {
  const { mailbox } = useParams();
  const location = useLocation();
  const { data } = useQuery({
    queryKey: ["host-web", "overview"],
    queryFn: getHostWebOverview
  });

  const breadcrumbs = location.pathname.startsWith("/mailboxes/")
    ? [
        { label: "Overview", to: "/overview" },
        { label: "Mailboxes", to: "/mailboxes" },
        { label: mailbox ?? "Mailbox Detail" }
      ]
    : location.pathname === "/mailboxes"
      ? [{ label: "Overview", to: "/overview" }, { label: "Mailboxes" }]
      : [{ label: "Overview" }];

  return (
    <div className="prototype-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Host Web</span>
          <h1 className="brand-title">Agent Mail</h1>
        </div>

        <div className="nav-group">
          <p className="nav-title">Local Runtime</p>
          <ul className="nav-list">
            <li>
              <NavLink className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")} to="/overview">
                Overview
              </NavLink>
            </li>
            <li>
              <NavLink className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")} to="/mailboxes">
                Mailboxes
              </NavLink>
            </li>
          </ul>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                {item.to ? <Link to={item.to}>{item.label}</Link> : <span className="current">{item.label}</span>}
                {index < breadcrumbs.length - 1 ? <span className="breadcrumb-sep">/</span> : null}
              </span>
            ))}
          </div>

          <div className="toolbar">
            <span className="button subtle">{data?.host.host_id ?? "host"}</span>
            <span className="button subtle">{data?.host.host_status ?? "loading"}</span>
            <span className="button subtle">last heartbeat {formatShortTimestamp(data?.auth.last_heartbeat_at ?? null)}</span>
          </div>
        </header>

        <main className="content stack"><Outlet /></main>
      </div>
    </div>
  );
}
