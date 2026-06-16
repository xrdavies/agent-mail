import type { ReactNode } from "react";
import { Bug, CheckSquare2, FileText, Home, Inbox, Layers, Server } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { DebugPage } from "./routes/debug-page.js";
import { HostDetailPage } from "./routes/host-detail-page.js";
import { HostsPage } from "./routes/hosts-page.js";
import { MailDetailPage } from "./routes/mail-detail-page.js";
import { MailboxDetailPage } from "./routes/mailbox-detail-page.js";
import { MailboxesPage } from "./routes/mailboxes-page.js";
import { MailsPage } from "./routes/mails-page.js";
import { OverviewPage } from "./routes/overview-page.js";
import { TaskDetailPage } from "./routes/task-detail-page.js";
import { TasksPage } from "./routes/tasks-page.js";
import { ThreadDetailPage } from "./routes/thread-detail-page.js";
import { ThreadsPage } from "./routes/threads-page.js";

const navItems = [
  { to: "/overview", label: "Overview", icon: Home },
  { to: "/mailboxes", label: "Mailboxes", icon: Inbox },
  { to: "/threads", label: "Threads", icon: Layers },
  { to: "/mails", label: "Mails", icon: FileText },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/tasks", label: "Tasks", icon: CheckSquare2 },
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
                  <NavLink className="button subtle" to="/debug">
                    Debug
                  </NavLink>
                  <span className="button subtle">Last Sync 12:04:21</span>
                </>
              }
            >
              <OverviewPage />
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
              <MailboxesPage />
            </PageShell>
          }
        />
        <Route
          path="/mailboxes/:mailbox"
          element={
            <PageShell
              breadcrumbCurrent="Mailbox Detail"
              toolbar={
                <>
                  <span className="button subtle">Detail</span>
                </>
              }
            >
              <MailboxDetailPage />
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
              <ThreadsPage />
            </PageShell>
          }
        />
        <Route
          path="/threads/:threadId"
          element={
            <PageShell
              breadcrumbCurrent="Thread Detail"
              toolbar={
                <>
                  <span className="button subtle">Detail</span>
                </>
              }
            >
              <ThreadDetailPage />
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
              <MailsPage />
            </PageShell>
          }
        />
        <Route
          path="/mails/:emailId"
          element={
            <PageShell
              breadcrumbCurrent="Mail Detail"
              toolbar={
                <>
                  <span className="button subtle">Detail</span>
                </>
              }
            >
              <MailDetailPage />
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
              <HostsPage />
            </PageShell>
          }
        />
        <Route
          path="/hosts/:hostId"
          element={
            <PageShell
              breadcrumbCurrent="Host Detail"
              toolbar={
                <>
                  <span className="button subtle">Detail</span>
                </>
              }
            >
              <HostDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/tasks"
          element={
            <PageShell
              breadcrumbCurrent="Tasks"
              toolbar={
                <>
                  <span className="button subtle">Status: All</span>
                  <span className="button subtle">Assignee: All</span>
                  <span className="button subtle">Search</span>
                </>
              }
            >
              <TasksPage />
            </PageShell>
          }
        />
        <Route
          path="/tasks/:taskId"
          element={
            <PageShell
              breadcrumbCurrent="Task Detail"
              toolbar={
                <>
                  <span className="button subtle">Detail</span>
                </>
              }
            >
              <TaskDetailPage />
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
