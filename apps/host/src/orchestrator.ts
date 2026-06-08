import type { Task } from "@agent-mail/shared";
import { join } from "node:path";

import type { HostMailboxConfig } from "./config.js";
import { buildBootstrapExecPrompt, buildResumePrompt } from "./prompts.js";
import type { CodexTurnResult } from "./codex-runner.js";
import { CodexRunner } from "./codex-runner.js";
import type { HostService } from "./service.js";

type TimerHandle = ReturnType<typeof setInterval>;
type CodexTurnRunnerLike = Pick<CodexRunner, "runTurn">;

type OrchestratorOptions = {
  service: HostService;
  intervalMs: number;
  codexRunner?: CodexTurnRunnerLike;
  hostBaseUrl: string;
  stateDir: string;
  codexBin?: string;
};

type PendingTaskSummary = {
  task: Task;
  latestSummary: string | null;
  openChildTaskCount: number;
  recentMessageCount: number;
};

const priorityOrder: Record<Task["status"], number> = {
  new: 0,
  in_progress: 1,
  paused: 2,
  blocked: 3,
  done: 4
};

export class HostOrchestrator {
  private readonly codexRunner: CodexTurnRunnerLike;
  private readonly runningMailboxes = new Set<string>();
  private timer: TimerHandle | null = null;

  constructor(private readonly options: OrchestratorOptions) {
    this.codexRunner = options.codexRunner ?? new CodexRunner(undefined, options.codexBin ?? "codex");
  }

  start(): void {
    void this.processPendingWorkOnce();
    this.timer = setInterval(() => {
      void this.processPendingWorkOnce();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processPendingWorkOnce(): Promise<void> {
    const mailboxes = this.options.service.getStatusSnapshot().mailboxes;
    const turnPromises: Array<Promise<void>> = [];

    for (const mailbox of mailboxes) {
      if (this.runningMailboxes.has(mailbox.mailbox)) {
        continue;
      }

      const pending = await this.findNextPendingTask(mailbox);

      if (!pending) {
        continue;
      }

      turnPromises.push(this.runMailboxTurn(mailbox, pending));
    }

    if (turnPromises.length > 0) {
      await Promise.allSettled(turnPromises);
    }
  }

  private async findNextPendingTask(
    mailbox: HostMailboxConfig
  ): Promise<PendingTaskSummary | null> {
    const tasks = await this.options.service.getClient().listMailboxTasks(mailbox.mailbox);
    const candidates = tasks
      .filter((task) => task.status === "new" || task.status === "in_progress" || task.status === "paused")
      .sort((left, right) => {
        const statusDelta = priorityOrder[left.status] - priorityOrder[right.status];
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return right.updated_at.localeCompare(left.updated_at);
      });

    for (const task of candidates) {
      const workPackage = await this.options.service.getClient().getTaskWorkPackage(task.task_id);

      if (task.status === "paused" && workPackage.open_child_tasks.length > 0) {
        continue;
      }

      return {
        task,
        latestSummary: workPackage.latest_summary,
        openChildTaskCount: workPackage.open_child_tasks.length,
        recentMessageCount: workPackage.new_messages.length
      };
    }

    return null;
  }

  private async runMailboxTurn(
    mailbox: HostMailboxConfig,
    pending: PendingTaskSummary
  ): Promise<void> {
    this.runningMailboxes.add(mailbox.mailbox);

    try {
      const currentSession = this.options.service.getCurrentSession(mailbox.mailbox);

      if (currentSession) {
        await this.options.service.updateSession(mailbox.mailbox, {
          session_status: "running",
          active_task_id: pending.task.task_id
        });
        await this.options.service.sendSessionHeartbeats();
      }

      const promptTask = {
        taskId: pending.task.task_id,
        title: pending.task.title,
        status: pending.task.status,
        parentTaskId: pending.task.parent_task_id,
        requiresArtifact: pending.task.requires_artifact,
        latestSummary: pending.latestSummary,
        openChildTaskCount: pending.openChildTaskCount,
        recentMessageCount: pending.recentMessageCount
      };

      const prompt = currentSession
        ? buildResumePrompt(mailbox, promptTask)
        : buildBootstrapExecPrompt(mailbox, promptTask);

      const result = await this.codexRunner.runTurn({
        workspacePath: mailbox.workspace_path,
        prompt,
        outputFile: join(
          this.options.stateDir,
          `${mailbox.mailbox.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}.last-message.txt`
        ),
        mcpUrl: `${this.options.hostBaseUrl.replace(/\/$/, "")}/mcp`,
        sessionId: currentSession?.session_id ?? null
      });

      await this.finalizeSuccessfulTurn(mailbox, pending.task, result);
    } catch (error) {
      await this.handleTurnFailure(mailbox, pending.task.task_id, error);
    } finally {
      this.runningMailboxes.delete(mailbox.mailbox);
    }
  }

  private async finalizeSuccessfulTurn(
    mailbox: HostMailboxConfig,
    task: Task,
    result: CodexTurnResult
  ): Promise<void> {
    let currentSession = this.options.service.getCurrentSession(mailbox.mailbox);

    if (!currentSession) {
      await this.options.service.bindSession({
        mailbox: mailbox.mailbox,
        session_id: result.sessionId,
        session_status: "idle"
      });
      currentSession = this.options.service.getCurrentSession(mailbox.mailbox);
    }

    const thread = await this.options.service.getClient().getFullThread(task.thread_id);
    const refreshedTask =
      thread.related_tasks.find((candidate) => candidate.task_id === task.task_id) ?? task;

    let sessionStatus: "idle" | "waiting_human" | "waiting_child" = "idle";

    if (refreshedTask.status === "blocked") {
      sessionStatus = "waiting_human";
    } else if (
      refreshedTask.status === "paused" &&
      thread.related_tasks.some(
        (candidate) =>
          candidate.parent_task_id === refreshedTask.task_id && candidate.status !== "done"
      )
    ) {
      sessionStatus = "waiting_child";
    }

    await this.options.service.updateSession(mailbox.mailbox, {
      session_status: sessionStatus,
      active_task_id: refreshedTask.status === "done" ? null : refreshedTask.task_id,
      last_processed_message_id: thread.messages.at(-1)?.message_id ?? null,
      latest_summary: result.lastMessage
    });
    await this.options.service.sendSessionHeartbeats();
  }

  private async handleTurnFailure(
    mailbox: HostMailboxConfig,
    taskId: string,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        action: "codex_turn_failed",
        mailbox: mailbox.mailbox,
        task_id: taskId,
        workspace_path: mailbox.workspace_path,
        timestamp: new Date().toISOString(),
        error: message
      })
    );

    if (this.options.service.getCurrentSession(mailbox.mailbox)) {
      await this.options.service.updateSession(mailbox.mailbox, {
        session_status: "failed",
        latest_summary: message
      });
      await this.options.service.sendSessionHeartbeats();
    }
  }
}
