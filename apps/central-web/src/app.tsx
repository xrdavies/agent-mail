import { Activity, Bug, FileText, Home, Inbox, Layers, Server } from "lucide-react";
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="border-r border-[var(--line)] bg-[var(--panel)]/80 px-6 py-8 backdrop-blur">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.18em] text-[var(--muted)]">Central</p>
            <h1 className="mt-3 text-5xl leading-none tracking-tight text-[var(--display)]">
              Agent Mail
            </h1>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition",
                    isActive
                      ? "border-[var(--line)] bg-[var(--card)] shadow-[0_0_0_1px_rgba(17,24,39,0.04)]"
                      : "border-transparent text-[var(--muted)] hover:border-[var(--line-soft)] hover:bg-white/60"
                  ].join(" ")
                }
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <Routes>
            <Route path="/" element={<Navigate to="/debug" replace />} />
            <Route
              path="/overview"
              element={
                <PlaceholderPage
                  title="Overview"
                  summary="Overview UI will use /api/v1/web/overview."
                />
              }
            />
            <Route
              path="/mailboxes"
              element={
                <PlaceholderPage
                  title="Mailboxes"
                  summary="Mailbox pages will use /api/v1/web/mailboxes and /api/v1/web/mailboxes/:mailbox."
                />
              }
            />
            <Route
              path="/threads"
              element={
                <PlaceholderPage
                  title="Threads"
                  summary="Thread list/detail will use /api/v1/web/threads and /api/v1/web/threads/:thread_id."
                />
              }
            />
            <Route
              path="/mails"
              element={
                <PlaceholderPage
                  title="Mails"
                  summary="Mail list/detail will use /api/v1/web/emails and /api/v1/web/emails/:email_id."
                />
              }
            />
            <Route
              path="/hosts"
              element={
                <PlaceholderPage
                  title="Hosts"
                  summary="Host pages will use /api/v1/hosts and /api/v1/hosts/:host_id."
                />
              }
            />
            <Route path="/debug" element={<DebugPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
