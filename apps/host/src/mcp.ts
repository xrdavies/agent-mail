import {
  appendMessageRequestSchema,
  bootstrapSessionToolInputSchema,
  createChildTaskToolInputSchema,
  getFullThreadToolInputSchema,
  getRuntimeContextToolInputSchema,
  getTaskWorkPackageToolInputSchema,
  getThreadDeltaToolInputSchema,
  listAgentsToolInputSchema,
  listMailboxTasksToolInputSchema,
  replyThreadToolInputSchema,
  updateTaskStatusToolInputSchema
} from "@agent-mail/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

import { CentralApiError } from "./client.js";
import { finalizeArtifactsForTask } from "./artifact-reporting.js";
import type { HostService } from "./service.js";
import { WorkspaceGitInspector } from "./workspace-git.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

class McpToolError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const textResult = (
  text: string,
  structuredContent?: Record<string, unknown>,
  isError = false
): CallToolResult => ({
  content: [
    {
      type: "text",
      text
    }
  ],
  structuredContent,
  isError
});

const normalizeToolError = (error: unknown): CallToolResult => {
  if (error instanceof McpToolError) {
    return textResult(error.message, undefined, true);
  }

  if (error instanceof CentralApiError) {
    return textResult(
      `${error.code}: ${error.message}`,
      error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : undefined,
      true
    );
  }

  if (error instanceof Error) {
    return textResult(error.message, undefined, true);
  }

  return textResult(String(error), undefined, true);
};

const logToolInvocation = (
  tool: string,
  mailbox: string,
  extra: ToolExtra,
  details: Record<string, unknown> = {}
) => {
  console.log(
    JSON.stringify({
      action: "mcp_tool",
      tool,
      declared_mailbox: mailbox,
      caller_session_id: extra.sessionId ?? null,
      request_id: String(extra.requestId),
      timestamp: new Date().toISOString(),
      ...details
    })
  );
};

const requireMailbox = (service: HostService, mailbox: string) => {
  return service.getRuntimeContext(mailbox);
};

const toReplyPayload = (mailbox: string, body: string, toMailbox?: string) =>
  appendMessageRequestSchema.parse({
    from_type: "agent",
    from_id: mailbox,
    to_type: toMailbox ? (toMailbox === "human-user" ? "human" : "agent") : null,
    to_id: toMailbox ?? null,
    message_kind: "agent_reply",
    body
  });

export const createHostMcpServer = (service: HostService) => {
  const client = service.getClient();
  const workspaceInspector = new WorkspaceGitInspector();
  const server = new McpServer({
    name: "agent-mail-host",
    version: "0.1.0"
  });

  server.registerTool(
    "bootstrap_session",
    {
      title: "Bootstrap Session",
      description: "Bind the current Codex session to a local mailbox and workspace.",
      inputSchema: bootstrapSessionToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("bootstrap_session", args.mailbox, extra, {
        workspace_path: args.workspacePath
      });

      try {
        const context = await service.bootstrapSession(args);
        return textResult(
          `Session bootstrapped for ${args.mailbox} with session ${context.session_id}.`,
          { runtimeContext: context }
        );
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "get_runtime_context",
    {
      title: "Get Runtime Context",
      description: "Return the local runtime context for a mailbox.",
      inputSchema: getRuntimeContextToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("get_runtime_context", args.mailbox, extra);

      try {
        const context = service.getRuntimeContext(args.mailbox);
        return textResult(`Runtime context for ${args.mailbox}.`, {
          runtimeContext: context
        });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "list_mailbox_tasks",
    {
      title: "List Mailbox Tasks",
      description: "List tasks assigned to a mailbox.",
      inputSchema: listMailboxTasksToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("list_mailbox_tasks", args.mailbox, extra);

      try {
        requireMailbox(service, args.mailbox);
        const tasks = await client.listMailboxTasks(args.mailbox);
        return textResult(
          tasks.length > 0
            ? `Found ${tasks.length} tasks for ${args.mailbox}.`
            : `No tasks found for ${args.mailbox}.`,
          { tasks }
        );
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "get_task_work_package",
    {
      title: "Get Task Work Package",
      description: "Get the structured work package for a task.",
      inputSchema: getTaskWorkPackageToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("get_task_work_package", args.mailbox, extra, {
        task_id: args.taskId
      });

      try {
        requireMailbox(service, args.mailbox);
        const workPackage = await client.getTaskWorkPackage(args.taskId);
        return textResult(`Work package loaded for task ${args.taskId}.`, {
          workPackage
        });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "get_thread_delta",
    {
      title: "Get Thread Delta",
      description: "Get new messages after a known thread message.",
      inputSchema: getThreadDeltaToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("get_thread_delta", args.mailbox, extra, {
        thread_id: args.threadId,
        after_message_id: args.afterMessageId ?? null
      });

      try {
        requireMailbox(service, args.mailbox);
        const delta = await client.getThreadDelta(args.threadId, args.afterMessageId);
        return textResult(
          `Loaded ${delta.messages.length} delta messages for thread ${args.threadId}.`,
          { delta }
        );
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "get_full_thread",
    {
      title: "Get Full Thread",
      description: "Get full thread detail when a delta is insufficient.",
      inputSchema: getFullThreadToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("get_full_thread", args.mailbox, extra, {
        thread_id: args.threadId
      });

      try {
        requireMailbox(service, args.mailbox);
        const thread = await client.getFullThread(args.threadId);
        return textResult(`Loaded full thread ${args.threadId}.`, { thread });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "reply_thread",
    {
      title: "Reply Thread",
      description: "Append an agent reply to a thread.",
      inputSchema: replyThreadToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("reply_thread", args.mailbox, extra, {
        thread_id: args.threadId,
        to_mailbox: args.toMailbox ?? null
      });

      try {
        requireMailbox(service, args.mailbox);
        const message = await client.replyThread(
          args.threadId,
          toReplyPayload(args.mailbox, args.body, args.toMailbox)
        );
        return textResult(`Reply posted to thread ${args.threadId}.`, { message });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "create_child_task",
    {
      title: "Create Child Task",
      description: "Create a child task within the same thread for another mailbox.",
      inputSchema: createChildTaskToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("create_child_task", args.mailbox, extra, {
        thread_id: args.threadId,
        to_mailbox: args.toMailbox
      });

      try {
        requireMailbox(service, args.mailbox);

        const thread = await client.getFullThread(args.threadId);
        const parentTask =
          thread.related_tasks.find(
            (task) =>
              task.assignee_mailbox === args.mailbox &&
              (task.status === "new" || task.status === "in_progress" || task.status === "paused")
          ) ?? thread.primary_task;

        if (!parentTask) {
          throw new McpToolError(
            `No parent task found in thread ${args.threadId} for mailbox ${args.mailbox}.`
          );
        }

        const task = await client.createTask({
          title: args.title,
          thread_id: args.threadId,
          parent_task_id: parentTask.task_id,
          created_by_type: "agent",
          created_by_id: args.mailbox,
          assignee_type: "agent",
          assignee_mailbox: args.toMailbox,
          requires_artifact: args.requiresArtifact,
          status: "new",
          body: args.body
        });

        return textResult(`Child task ${task.task_id} created for ${args.toMailbox}.`, {
          task
        });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "update_task_status",
    {
      title: "Update Task Status",
      description: "Update task status for the declared mailbox.",
      inputSchema: updateTaskStatusToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("update_task_status", args.mailbox, extra, {
        task_id: args.taskId,
        status: args.status
      });

      try {
        requireMailbox(service, args.mailbox);
        const workPackage = await client.getTaskWorkPackage(args.taskId);
        const mailboxConfig = service.getMailboxConfig(args.mailbox);

        if (args.status === "done" && workPackage.task.requires_artifact) {
          const latestReply =
            [...workPackage.new_messages]
              .reverse()
              .find((message) => message.from_id === args.mailbox)?.body ?? "";

          const artifactError = await finalizeArtifactsForTask({
            mailbox: mailboxConfig,
            task: workPackage.task,
            client,
            workspaceInspector,
            artifactSourceText: latestReply
          });

          if (artifactError) {
            return textResult(artifactError, undefined, true);
          }
        }

        const task = await client.updateTaskStatus(args.taskId, {
          status: args.status
        });
        return textResult(`Task ${args.taskId} updated to ${args.status}.`, {
          task
        });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  server.registerTool(
    "list_agents",
    {
      title: "List Agents",
      description: "List known agent mailboxes for delegation.",
      inputSchema: listAgentsToolInputSchema
    },
    async (args, extra) => {
      logToolInvocation("list_agents", args.mailbox, extra);

      try {
        requireMailbox(service, args.mailbox);
        const agents = await client.listAgents();
        return textResult(`Loaded ${agents.length} agents.`, { agents });
      } catch (error) {
        return normalizeToolError(error);
      }
    }
  );

  return server;
};
