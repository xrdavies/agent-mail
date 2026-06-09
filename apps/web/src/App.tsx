import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, MessageSquareReply, PanelsTopLeft, Route, Workflow } from "lucide-react";
import type { Machine, Mailbox, Session, Task, ThreadDetail, ThreadSummary } from "@agent-mail/shared";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import { Textarea } from "./components/ui/textarea";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBase}${path}`, init);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

const formatTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        hour12: false,
        dateStyle: "short",
        timeStyle: "short"
      }).format(new Date(value))
    : "N/A";

const statusTone = (status: string) => {
  if (status === "online" || status === "idle" || status === "running" || status === "done") {
    return "online";
  }

  if (status === "degraded" || status === "waiting_human" || status === "waiting_child" || status === "paused" || status === "blocked") {
    return "degraded";
  }

  return "offline";
};

const actorName = (mailboxById: Record<string, Mailbox>, actorId: string) =>
  mailboxById[actorId]?.name ?? actorId;

export const App = () => {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState("Product scope clarification");
  const [composeBody, setComposeBody] = useState(
    "Please clarify the smallest shippable flow and delegate implementation follow-up if needed."
  );
  const [composeMailbox, setComposeMailbox] = useState("pm.aster@agents.local");
  const [replyBody, setReplyBody] = useState("Could you summarize the current status and next step?");
  const [copiedWorkspace, setCopiedWorkspace] = useState<string | null>(null);

  const machinesQuery = useQuery({
    queryKey: ["machines"],
    queryFn: () => fetchJson<Machine[]>("/machines"),
    refetchInterval: 5000
  });

  const mailboxesQuery = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => fetchJson<Mailbox[]>("/mailboxes")
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => fetchJson<Session[]>("/sessions"),
    refetchInterval: 5000
  });

  const threadsQuery = useQuery({
    queryKey: ["threads"],
    queryFn: () => fetchJson<ThreadSummary[]>("/threads"),
    refetchInterval: 5000
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => fetchJson<Task[]>("/tasks"),
    refetchInterval: 5000
  });

  const selectedSessionQuery = useQuery({
    queryKey: ["session", selectedSessionId],
    queryFn: () => fetchJson<Session>(`/sessions/${selectedSessionId}`),
    enabled: Boolean(selectedSessionId),
    refetchInterval: 5000
  });

  const selectedThreadQuery = useQuery({
    queryKey: ["thread", selectedThreadId],
    queryFn: () => fetchJson<ThreadDetail>(`/threads/${selectedThreadId}`),
    enabled: Boolean(selectedThreadId),
    refetchInterval: 5000
  });

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.length) {
      setSelectedSessionId(sessionsQuery.data[0].session_id);
    }
  }, [selectedSessionId, sessionsQuery.data]);

  useEffect(() => {
    if (!selectedThreadId && threadsQuery.data?.length) {
      setSelectedThreadId(threadsQuery.data[0].thread_id);
    }
  }, [selectedThreadId, threadsQuery.data]);

  const invalidateOperationalQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
      queryClient.invalidateQueries({ queryKey: ["thread", selectedThreadId] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["session", selectedSessionId] })
    ]);
  };

  const composeThreadMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{ thread: ThreadSummary; primary_task: Task }>(`/threads`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          subject: composeSubject,
          body: composeBody,
          assigned_mailbox: composeMailbox
        })
      }),
    onSuccess: async (result) => {
      setSelectedThreadId(result.thread.thread_id);
      await invalidateOperationalQueries();
    }
  });

  const replyThreadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedThreadId) {
        throw new Error("No thread selected.");
      }

      return fetchJson(`/threads/${selectedThreadId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from_type: "human",
          from_id: "human-user",
          to_type: "agent",
          to_id:
            selectedThreadQuery.data?.thread.assigned_mailbox ??
            selectedThreadQuery.data?.primary_task?.assignee_mailbox ??
            composeMailbox,
          message_kind: "human_mail",
          body: replyBody
        })
      });
    },
    onSuccess: async () => {
      await invalidateOperationalQueries();
      setReplyBody("");
    }
  });

  const clearSessionMutation = useMutation({
    mutationFn: async (session: Session) =>
      fetchJson<{ ok: boolean }>(`/sessions/${session.session_id}/clear`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          mailbox: session.mailbox,
          requested_by: "human-user",
          force: false
        })
      }),
    onSuccess: async () => {
      await invalidateOperationalQueries();
    }
  });

  const machines = machinesQuery.data ?? [];
  const mailboxes = mailboxesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const threads = threadsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const selectedSession =
    selectedSessionQuery.data ??
    sessions.find((session) => session.session_id === selectedSessionId) ??
    null;
  const selectedThread = selectedThreadQuery.data ?? null;

  const mailboxById = Object.fromEntries(mailboxes.map((mailbox) => [mailbox.mailbox, mailbox]));
  const machineById = Object.fromEntries(machines.map((machine) => [machine.machine_id, machine]));

  const activeTaskCountByMailbox = tasks.reduce<Record<string, number>>((acc, task) => {
    if (!task.assignee_mailbox || task.status === "done") {
      return acc;
    }

    acc[task.assignee_mailbox] = (acc[task.assignee_mailbox] ?? 0) + 1;
    return acc;
  }, {});

  const threadTasks = selectedThread
    ? tasks.filter((task) => task.thread_id === selectedThread.thread.thread_id)
    : [];

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 xl:px-10">
      <div className="mx-auto flex max-w-[1520px] flex-col gap-6">
        <Card className="overflow-hidden">
          <CardContent className="grid gap-6 px-6 py-7 lg:grid-cols-[1.7fr_1fr]">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#8b5b46]">
                  Agent Mail Control Room
                </p>
                <h1 className='font-["IBM_Plex_Serif",Georgia,serif] text-3xl text-[#201913] sm:text-4xl'>
                  Human mail, live threads, host sessions, and operator controls in one surface.
                </h1>
              </div>
              <p className="max-w-3xl text-sm leading-7 text-[#6e6255] sm:text-base">
                Compose a new mailbox thread, inspect task flow, reply as the human in an existing
                conversation, and observe which host and session are currently carrying the work.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Card className="rounded-[20px] bg-[rgba(255,255,255,0.64)]">
                <CardContent className="px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8b5b46]">Hosts</p>
                  <div className="mt-2 text-3xl font-semibold text-[#201913]">{machines.length}</div>
                </CardContent>
              </Card>
              <Card className="rounded-[20px] bg-[rgba(255,255,255,0.64)]">
                <CardContent className="px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8b5b46]">Live Sessions</p>
                  <div className="mt-2 text-3xl font-semibold text-[#201913]">
                    {sessions.filter((session) => session.session_status !== "cleared").length}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-[20px] bg-[rgba(255,255,255,0.64)]">
                <CardContent className="px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8b5b46]">Open Tasks</p>
                  <div className="mt-2 text-3xl font-semibold text-[#201913]">
                    {tasks.filter((task) => task.status !== "done").length}
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.15fr_0.95fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <MailPlus className="h-5 w-5 text-[#9d3526]" />
                  <div>
                    <CardTitle>Compose Mail</CardTitle>
                    <CardDescription>Create a new human-to-agent thread and primary task.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="compose-mailbox">Assigned Mailbox</Label>
                  <select
                    className="h-11 w-full rounded-2xl border border-[#d6c6b1] bg-white/80 px-4 text-sm text-[#201b18]"
                    id="compose-mailbox"
                    onChange={(event) => setComposeMailbox(event.target.value)}
                    value={composeMailbox}
                  >
                    {mailboxes.map((mailbox) => (
                      <option key={mailbox.mailbox} value={mailbox.mailbox}>
                        {mailbox.name} · {mailbox.role} · {mailbox.mailbox}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compose-subject">Subject</Label>
                  <Input id="compose-subject" onChange={(event) => setComposeSubject(event.target.value)} value={composeSubject} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compose-body">Body</Label>
                  <Textarea id="compose-body" onChange={(event) => setComposeBody(event.target.value)} value={composeBody} />
                </div>
                <Button
                  className="w-full"
                  disabled={composeThreadMutation.isPending || !composeSubject.trim() || !composeBody.trim()}
                  onClick={() => composeThreadMutation.mutate()}
                  type="button"
                >
                  {composeThreadMutation.isPending ? "Creating…" : "Create Thread"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <PanelsTopLeft className="h-5 w-5 text-[#9d3526]" />
                  <div>
                    <CardTitle>Threads</CardTitle>
                    <CardDescription>Inspect latest human and agent mail traffic.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {threads.map((thread) => (
                  <button
                    className={`w-full rounded-[20px] border px-4 py-4 text-left transition ${
                      selectedThreadId === thread.thread_id
                        ? "border-[#9d3526] bg-[#fff6ec]"
                        : "border-transparent bg-[rgba(255,255,255,0.6)] hover:border-[#d4b79b]"
                    }`}
                    key={thread.thread_id}
                    onClick={() => setSelectedThreadId(thread.thread_id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className='font-["IBM_Plex_Serif",Georgia,serif] text-lg text-[#1f1a16]'>
                          {thread.subject}
                        </h3>
                        <p className="mt-1 text-sm text-[#6e6255]">
                          {mailboxById[thread.assigned_mailbox]?.name ?? thread.assigned_mailbox}
                        </p>
                      </div>
                      <Badge tone={statusTone(thread.thread_status)}>{thread.thread_status}</Badge>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#53473b]">
                      {thread.latest_message_preview ?? "No messages yet."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#7b6f62]">
                      <span>{thread.open_task_count} open tasks</span>
                      <span>{formatTime(thread.latest_message_at)}</span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="min-h-[420px]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <MessageSquareReply className="h-5 w-5 text-[#9d3526]" />
                  <div>
                    <CardTitle>Thread Detail</CardTitle>
                    <CardDescription>Read the full conversation and reply as the human operator.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedThread ? (
                  <>
                    <div className="space-y-2">
                      <h3 className='font-["IBM_Plex_Serif",Georgia,serif] text-2xl text-[#1f1a16]'>
                        {selectedThread.thread.subject}
                      </h3>
                      <div className="flex flex-wrap gap-3 text-xs text-[#7b6f62]">
                        <span>Thread {selectedThread.thread.thread_id}</span>
                        <span>Assigned to {mailboxById[selectedThread.thread.assigned_mailbox]?.name ?? selectedThread.thread.assigned_mailbox}</span>
                        <span>{formatTime(selectedThread.thread.updated_at)}</span>
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-3">
                      {selectedThread.messages.map((message) => (
                        <div
                          className={`rounded-[20px] px-4 py-4 ${
                            message.from_type === "human"
                              ? "bg-[#fff7ef]"
                              : "bg-[rgba(255,255,255,0.72)]"
                          }`}
                          key={message.message_id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-[#2b221d]">
                                {message.from_type === "human"
                                  ? "Human Operator"
                                  : actorName(mailboxById, message.from_id)}
                              </p>
                              <p className="text-xs uppercase tracking-[0.16em] text-[#8b5b46]">
                                {message.message_kind}
                              </p>
                            </div>
                            <span className="text-xs text-[#7b6f62]">{formatTime(message.created_at)}</span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#43382f]">
                            {message.body}
                          </p>
                        </div>
                      ))}
                    </div>
                    <Separator />
                    <div className="space-y-3">
                      <Label htmlFor="reply-body">Reply as Human</Label>
                      <Textarea
                        id="reply-body"
                        onChange={(event) => setReplyBody(event.target.value)}
                        placeholder="Ask for status, clarify scope, or nudge an agent forward."
                        value={replyBody}
                      />
                      <Button
                        disabled={replyThreadMutation.isPending || !replyBody.trim() || !selectedThreadId}
                        onClick={() => replyThreadMutation.mutate()}
                        type="button"
                      >
                        {replyThreadMutation.isPending ? "Sending…" : "Reply to Thread"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="grid min-h-[280px] place-items-center text-center text-sm text-[#6e6255]">
                    Select a thread to inspect its messages and reply in-context.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Workflow className="h-5 w-5 text-[#9d3526]" />
                  <div>
                    <CardTitle>Tasks in Selected Thread</CardTitle>
                    <CardDescription>Inspect parent/child task status without leaving the conversation.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {threadTasks.length > 0 ? (
                  threadTasks.map((task) => (
                    <div
                      className="rounded-[20px] bg-[rgba(255,255,255,0.64)] px-4 py-4"
                      key={task.task_id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[#201913]">{task.title}</p>
                          <p className="mt-1 text-sm text-[#6e6255]">
                            {task.assignee_mailbox
                              ? actorName(mailboxById, task.assignee_mailbox)
                              : "Unassigned"}
                          </p>
                        </div>
                        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#7b6f62]">
                        <span>{task.task_id}</span>
                        <span>{task.requires_artifact ? "requires artifact" : "message-only"}</span>
                        <span>{task.parent_task_id ? `child of ${task.parent_task_id}` : "parent task"}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#6e6255]">No tasks loaded for the selected thread.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Route className="h-5 w-5 text-[#9d3526]" />
                  <div>
                    <CardTitle>Hosts</CardTitle>
                    <CardDescription>Machine ownership and runtime health for local mailboxes.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {machines.map((machine) => {
                  const machineMailboxes = mailboxes.filter((mailbox) => mailbox.machine_id === machine.machine_id);
                  const machineSessions = sessions.filter((session) => session.machine_id === machine.machine_id && session.session_status !== "cleared");

                  return (
                    <Card className="rounded-[20px] bg-[rgba(255,255,255,0.62)]" key={machine.machine_id}>
                      <CardContent className="space-y-3 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className='font-["IBM_Plex_Serif",Georgia,serif] text-lg text-[#1f1a16]'>
                              {machine.label}
                            </p>
                            <p className="text-sm text-[#6e6255]">{machine.machine_id}</p>
                          </div>
                          <Badge tone={statusTone(machine.host_status)}>{machine.host_status}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-[#7b6f62]">
                          <span>{machineMailboxes.length} mailboxes</span>
                          <span>{machineSessions.length} live sessions</span>
                          <span>heartbeat {formatTime(machine.last_heartbeat_at)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
                <CardDescription>Inspect current mailbox session bindings and operator controls.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sessions.map((session) => (
                  <button
                    className={`w-full rounded-[20px] border px-4 py-4 text-left transition ${
                      selectedSessionId === session.session_id
                        ? "border-[#9d3526] bg-[#fff6ec]"
                        : "border-transparent bg-[rgba(255,255,255,0.64)] hover:border-[#d4b79b]"
                    }`}
                    key={session.session_id}
                    onClick={() => setSelectedSessionId(session.session_id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[#201913]">
                          {mailboxById[session.mailbox]?.name ?? session.mailbox}
                        </p>
                        <p className="mt-1 text-sm text-[#6e6255]">{session.mailbox}</p>
                      </div>
                      <Badge tone={statusTone(session.session_status)}>{session.session_status}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#7b6f62]">
                      <span>{machineById[session.machine_id]?.label ?? session.machine_id}</span>
                      <span>{activeTaskCountByMailbox[session.mailbox] ?? 0} active tasks</span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle>Session Detail</CardTitle>
                <CardDescription>View session metadata, copy workspace, and clear a stuck binding.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedSession ? (
                  <>
                    <div className="grid gap-3 text-sm text-[#43382f]">
                      <div>
                        <Label>Mailbox</Label>
                        <p className="mt-1">{selectedSession.mailbox}</p>
                      </div>
                      <div>
                        <Label>Session id</Label>
                        <p className="mt-1 break-all">{selectedSession.session_id}</p>
                      </div>
                      <div>
                        <Label>Workspace</Label>
                        <p className="mt-1 break-all">{selectedSession.workspace_path}</p>
                      </div>
                      <div>
                        <Label>Latest Summary</Label>
                        <p className="mt-1 whitespace-pre-wrap text-[#5f5347]">
                          {selectedSession.latest_summary ?? "No summary captured yet."}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={async () => {
                          await navigator.clipboard.writeText(selectedSession.workspace_path);
                          setCopiedWorkspace(selectedSession.session_id);
                          setTimeout(() => setCopiedWorkspace(null), 1500);
                        }}
                        type="button"
                        variant="outline"
                      >
                        {copiedWorkspace === selectedSession.session_id
                          ? "Workspace Copied"
                          : "Copy Workspace Path"}
                      </Button>
                      <Button
                        disabled={clearSessionMutation.isPending || selectedSession.session_status === "cleared"}
                        onClick={() => clearSessionMutation.mutate(selectedSession)}
                        type="button"
                      >
                        {clearSessionMutation.isPending ? "Clearing…" : "Clear Session"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[#6e6255]">
                    Select a session to inspect its machine, workspace path, and summary.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

