import type { ReactNode } from "react";
import { Bug, FileText, Home, Inbox, Layers, Server } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { DebugPage } from "./routes/debug-page.js";
import { PlaceholderPage } from "./routes/placeholder-page.js";

const navItems = [
  { to: "/overview", label: "Overview", icon: Home },
  { to: "/mailboxes", label: "Mailboxes", icon: Inbox },
  { to: "/threads", label: "Threads", icon: Layers },
  { to: "/mails", label: "Mails", icon: FileText },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/debug", label: "Debug", icon: Bug }
] as const;

export function App() {
  return (
    <div className="prototype-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1 className="brand-title">Agent Mail</h1>
        </div>

        <div className="nav-group">
          <ul className="nav-list">
            {navItems.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
                >
                  <span className="nav-link-content">
                    <Icon className="nav-link-icon" />
                    <span>{label}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <Routes>
        <Route path="/" element={<Navigate to="/debug" replace />} />
        <Route
          path="/overview"
          element={
            <PageShell
              breadcrumbCurrent="Overview"
              toolbar={
                <>
                  <span className="button subtle">Debug</span>
                  <span className="button subtle">Last Sync 12:04:21</span>
                </>
              }
            >
              <PlaceholderPage
                title="Overview"
                summary="Overview UI will use /api/v1/web/overview."
              />
            </PageShell>
          }
        />
        <Route
          path="/mailboxes"
          element={
            <PageShell
              breadcrumbCurrent="Mailboxes"
              toolbar={
                <>
                  <span className="button subtle">Status: All</span>
                  <span className="button subtle">Host: All</span>
                  <span className="button subtle">Search</span>
                </>
              }
            >
              <PlaceholderPage
                title="Mailboxes"
                summary="Mailbox pages will use /api/v1/web/mailboxes and /api/v1/web/mailboxes/:mailbox."
              />
            </PageShell>
          }
        />
        <Route
          path="/threads"
          element={
            <PageShell
              breadcrumbCurrent="Threads"
              toolbar={
                <>
                  <span className="button subtle">Status: All</span>
                  <span className="button subtle">Mailbox: All</span>
                  <span className="button subtle">Sort: Latest</span>
                </>
              }
            >
              <PlaceholderPage
                title="Threads"
                summary="Thread list/detail will use /api/v1/web/threads and /api/v1/web/threads/:thread_id."
              />
            </PageShell>
          }
        />
        <Route
          path="/mails"
          element={
            <PageShell
              breadcrumbCurrent="Mails"
              toolbar={
                <>
                  <span className="button subtle">Kind: All</span>
                  <span className="button subtle">Mailbox: All</span>
                  <span className="button subtle">Search Headers</span>
                </>
              }
            >
              <PlaceholderPage
                title="Mails"
                summary="Mail list/detail will use /api/v1/web/emails and /api/v1/web/emails/:email_id."
              />
            </PageShell>
          }
        />
        <Route
          path="/hosts"
          element={
            <PageShell
              breadcrumbCurrent="Hosts"
              toolbar={
                <>
                  <span className="button subtle">Status: All</span>
                  <span className="button subtle">Health Window 30s</span>
                  <span className="button subtle">Refresh</span>
                </>
              }
            >
              <PlaceholderPage
                title="Hosts"
                summary="Host pages will use /api/v1/hosts and /api/v1/hosts/:host_id."
              />
            </PageShell>
          }
        />
        <Route
          path="/debug"
          element={
            <PageShell
              breadcrumbCurrent="Debug"
              toolbar={
                <>
                  <span className="button subtle">Central</span>
                  <span className="button subtle">Last Read</span>
                  <span className="button subtle">Tail 120</span>
                </>
              }
            >
              <DebugPage />
            </PageShell>
          }
        />
      </Routes>
    </div>
  );
}

function PageShell(props: {
  breadcrumbCurrent: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumbs">
          <span>Home</span>
          <span>/</span>
          <span className="current">{props.breadcrumbCurrent}</span>
        </div>
        {props.toolbar ? <div className="toolbar">{props.toolbar}</div> : null}
      </header>

      <main className="content stack">{props.children}</main>
    </div>
  );
}
