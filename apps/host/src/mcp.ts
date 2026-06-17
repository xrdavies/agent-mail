import {
  bootstrapAgentInputSchema,
  bootstrapAgentOutputSchema,
  createTaskInputSchema,
  createTaskOutputSchema,
  getDeliveryInputSchema,
  getDeliveryOutputSchema,
  getEmailInputSchema,
  getOldestUnreadDeliveryOutputSchema,
  getTaskInputSchema,
  getThreadInputSchema,
  hostMcpConfigResponseSchema,
  listAgentsInputSchema,
  listAgentsOutputSchema,
  listTasksInputSchema,
  mailboxToolInputSchema,
  markDeliveryReadInputSchema,
  markDeliveryReadOutputSchema,
  sendEmailInputSchema,
  sendEmailOutputSchema,
  threadToolOutputSchema,
  updateTaskStatusInputSchema
} from "@agent-mail/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { HostRuntime } from "./runtime.js";

export function createMcpServer(runtime: HostRuntime): McpServer {
  const server = new McpServer({
    name: "agent-mail-host",
    version: runtime.config.hostVersion
  });

  server.registerTool(
    "bootstrap_agent",
    {
      description: "Bootstrap a mailbox profile and register it with Agent Mail Central.",
      inputSchema: bootstrapAgentInputSchema,
      outputSchema: bootstrapAgentOutputSchema
    },
    async (args) => toolResult(await runtime.bootstrapAgent(args))
  );

  server.registerTool(
    "get_oldest_unread_delivery",
    {
      description: "Get the oldest unread delivery for the current mailbox.",
      inputSchema: mailboxToolInputSchema
    },
    async ({ mailbox }) => toolResult(await runtime.getOldestUnreadDelivery(mailbox))
  );

  server.registerTool(
    "get_delivery",
    {
      description: "Read one delivery detail without mutating unread state.",
      inputSchema: getDeliveryInputSchema,
      outputSchema: getDeliveryOutputSchema
    },
    async ({ mailbox, deliveryId }) => toolResult(await runtime.getDelivery(mailbox, deliveryId))
  );

  server.registerTool(
    "get_email",
    {
      description: "Get one email by id.",
      inputSchema: getEmailInputSchema
    },
    async ({ mailbox, emailId }) => toolResult(await runtime.getEmail(mailbox, emailId))
  );

  server.registerTool(
    "get_thread",
    {
      description: "Get the full thread, linked resources, and tasks for a delivery.",
      inputSchema: getThreadInputSchema,
      outputSchema: threadToolOutputSchema
    },
    async ({ mailbox, threadId }) => toolResult(await runtime.getThread(mailbox, threadId))
  );

  server.registerTool(
    "mark_delivery_read",
    {
      description: "Mark the active delivery as read.",
      inputSchema: markDeliveryReadInputSchema,
      outputSchema: markDeliveryReadOutputSchema
    },
    async ({ mailbox, deliveryId }) => toolResult(await runtime.markDeliveryRead(mailbox, deliveryId))
  );

  server.registerTool(
    "send_email",
    {
      description: "Send an email through Host and Central.",
      inputSchema: sendEmailInputSchema,
      outputSchema: sendEmailOutputSchema
    },
    async (args) =>
      toolResult(
        await runtime.sendEmail({
          mailbox: args.mailbox,
          to: args.to,
          cc: args.cc ?? [],
          subject: args.subject,
          bodyText: args.bodyText,
          rawBody: args.rawBody,
          ...(args.inReplyTo !== undefined ? { inReplyTo: args.inReplyTo } : {}),
          ...(args.references ? { references: args.references } : {}),
          ...(args.linkedResources
            ? {
                linkedResources: args.linkedResources.map((item) => ({
                  url: item.url,
                  ...(item.title !== undefined ? { title: item.title } : {}),
                  ...(item.mime_type !== undefined ? { mime_type: item.mime_type } : {}),
                  ...(item.size_bytes !== undefined ? { size_bytes: item.size_bytes } : {})
                }))
              }
            : {}),
          ...(args.emailKind &&
          ["agent_reply", "agent_delegation", "agent_receipt", "system_note"].includes(args.emailKind)
            ? { emailKind: args.emailKind as "agent_reply" | "agent_delegation" | "agent_receipt" | "system_note" }
            : {})
        })
      )
  );

  server.registerTool(
    "create_task",
    {
      description: "Create an execution task from email context.",
      inputSchema: createTaskInputSchema,
      outputSchema: createTaskOutputSchema
    },
    async ({ mailbox, threadId, triggerEmailId, assigneeMailbox, title, instructions, parentTaskId, requiresArtifact }) =>
      toolResult(
        await runtime.createTask({
          mailbox,
          threadId,
          triggerEmailId,
          assigneeMailbox,
          title,
          instructions: instructions ?? null,
          parentTaskId: parentTaskId ?? null,
          requiresArtifact
        })
      )
  );

  server.registerTool(
    "get_task",
    {
      description: "Get one visible task by id.",
      inputSchema: getTaskInputSchema
    },
    async ({ mailbox, taskId }) => toolResult(await runtime.getTask(mailbox, taskId))
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List visible tasks for this mailbox and optional filters.",
      inputSchema: listTasksInputSchema
    },
    async ({ mailbox, threadId, status, parentTaskId }) =>
      toolResult(
        await runtime.listTasks({
          mailbox,
          ...(threadId ? { threadId } : {}),
          ...(status ? { status } : {}),
          ...(parentTaskId ? { parentTaskId } : {})
        })
      )
  );

  server.registerTool(
    "update_task_status",
    {
      description: "Update task state and attach completion artifacts when needed.",
      inputSchema: updateTaskStatusInputSchema
    },
    async ({ mailbox, taskId, status, completedByEmailId, artifacts }) =>
      toolResult(
        await runtime.updateTaskStatus({
          mailbox,
          taskId,
          status,
          completedByEmailId: completedByEmailId ?? null,
          ...(artifacts
            ? {
                artifacts: artifacts.map((item) => ({
                  path: item.path,
                  ...(item.repository !== undefined ? { repository: item.repository } : {}),
                  ...(item.branch !== undefined ? { branch: item.branch } : {}),
                  ...(item.commit_sha !== undefined ? { commit_sha: item.commit_sha } : {}),
                  ...(item.pr_link !== undefined ? { pr_link: item.pr_link } : {})
                }))
              }
            : {})
        })
      )
  );

  server.registerTool(
    "list_agents",
    {
      description: "List active discoverable agents.",
      inputSchema: listAgentsInputSchema
    },
    async ({ mailbox }) => toolResult(await runtime.listAgents(mailbox))
  );

  return server;
}

function toolResult<T>(data: T) {
  const structuredContent =
    data !== null && !Array.isArray(data) && typeof data === "object"
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent
  };
}
