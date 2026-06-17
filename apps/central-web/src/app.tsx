import type { ReactNode } from "react";
import { Bug, CheckSquare2, FileText, Home, Inbox, Layers, PenSquare, Server } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { ComposePage } from "./routes/compose-page.js";
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
  { to: "/debug", label: "Debug", icon: Bug },
  { to: "/compose", label: "Compose", icon: PenSquare }
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
            <PageShell breadcrumbCurrent="Mailboxes">
              <MailboxesPage />
            </PageShell>
          }
        />
        <Route
          path="/mailboxes/:mailbox"
          element={
            <PageShell breadcrumbCurrent="Mailbox Detail">
              <MailboxDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/threads"
          element={
            <PageShell breadcrumbCurrent="Threads">
              <ThreadsPage />
            </PageShell>
          }
        />
        <Route
          path="/threads/:threadId"
          element={
            <PageShell breadcrumbCurrent="Thread Detail">
              <ThreadDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/mails"
          element={
            <PageShell breadcrumbCurrent="Mails">
              <MailsPage />
            </PageShell>
          }
        />
        <Route
          path="/mails/:emailId"
          element={
            <PageShell breadcrumbCurrent="Mail Detail">
              <MailDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/hosts"
          element={
            <PageShell breadcrumbCurrent="Hosts">
              <HostsPage />
            </PageShell>
          }
        />
        <Route
          path="/hosts/:hostId"
          element={
            <PageShell breadcrumbCurrent="Host Detail">
              <HostDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/tasks"
          element={
            <PageShell breadcrumbCurrent="Tasks">
              <TasksPage />
            </PageShell>
          }
        />
        <Route
          path="/tasks/:taskId"
          element={
            <PageShell breadcrumbCurrent="Task Detail">
              <TaskDetailPage />
            </PageShell>
          }
        />
        <Route
          path="/debug"
          element={<PageShell breadcrumbCurrent="Debug"><DebugPage /></PageShell>}
        />
        <Route
          path="/compose"
          element={
            <PageShell
              breadcrumbCurrent="Compose"
              toolbar={
                <>
                  <NavLink className="button subtle" to="/overview">
                    Back to Overview
                  </NavLink>
                </>
              }
            >
              <ComposePage />
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
