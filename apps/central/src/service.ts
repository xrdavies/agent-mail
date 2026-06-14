import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql
} from "drizzle-orm";

import type {
  AddressObject,
  AgentProfile,
  Artifact,
  ArtifactInput,
  CreateTaskRequest,
  Delivery,
  Email,
  Host,
  HostAuthExchangeRequest,
  HostHeartbeatRequest,
  HostRegisterRequest,
  LinkedResource,
  MailboxBinding,
  RegisterAgentRequest,
  SendEmailRequest,
  Task,
  Thread,
  UpdateTaskStatusRequest
} from "@agent-mail/contracts";

import {
  agentProfiles,
  artifacts,
  deliveries,
  emails,
  hosts,
  hostTokens,
  idempotencyKeys,
  linkedResources,
  mailboxBindings,
  mailboxRuntimes,
  tasks,
  threads,
  updateNow
} from "./db/schema.js";
import type { CentralDatabase } from "./db/client.js";
import { HttpError } from "./lib/errors.js";
import { createMessageId, createPrefixedId, hashToken, issueOpaqueToken } from "./lib/ids.js";
import { now, toIso } from "./lib/time.js";

type Transaction = Parameters<Parameters<CentralDatabase["transaction"]>[0]>[0];

export interface AuthenticatedHost {
  hostId: string;
  tokenId: string;
}

type HostRow = typeof hosts.$inferSelect;
type AgentProfileRow = typeof agentProfiles.$inferSelect;
type MailboxBindingRow = typeof mailboxBindings.$inferSelect;
type MailboxRuntimeRow = typeof mailboxRuntimes.$inferSelect;
type ThreadRow = typeof threads.$inferSelect;
type EmailRow = typeof emails.$inferSelect;
type DeliveryRow = typeof deliveries.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type LinkedResourceRow = typeof linkedResources.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

const HOST_HEALTH_WINDOW_MS = 30_000;

export class CentralService {
  constructor(
    private readonly db: CentralDatabase,
    private readonly bootstrapKeys: Set<string>
  ) {}

  async authenticate(token: string): Promise<AuthenticatedHost> {
    const tokenHash = hashToken(token);
    const [record] = await this.db
      .select({
        tokenId: hostTokens.tokenId,
        hostId: hostTokens.hostId,
        tokenStatus: hostTokens.tokenStatus
      })
      .from(hostTokens)
      .where(and(eq(hostTokens.tokenHash, tokenHash), eq(hostTokens.tokenStatus, "active")))
      .limit(1);

    if (!record) {
      throw new HttpError(401, "Invalid host token");
    }

    return {
      hostId: record.hostId,
      tokenId: record.tokenId
    };
  }

  async exchangeHostToken(request: HostAuthExchangeRequest): Promise<{
    host: Host;
    host_token: string;
    token_type: "Bearer";
  }> {
    if (!this.bootstrapKeys.has(request.bootstrap_key)) {
      throw new HttpError(401, "Invalid bootstrap key");
    }

    const token = issueOpaqueToken();
    const tokenHash = hashToken(token);
    const issuedAt = now();

    const host = await this.db.transaction(async (tx) => {
      await this.upsertHost(tx, {
        hostId: request.host_id,
        label: request.label,
        hostVersion: request.host_version ?? null,
        hostStatus: "online",
        lastAuthenticatedAt: issuedAt
      });

      await tx
        .update(hostTokens)
        .set({
          tokenStatus: "revoked",
          revokedAt: issuedAt,
          updatedAt: issuedAt
        })
        .where(and(eq(hostTokens.hostId, request.host_id), eq(hostTokens.tokenStatus, "active")));

      await tx.insert(hostTokens).values({
        tokenId: createPrefixedId("htok"),
        hostId: request.host_id,
        tokenHash,
        tokenStatus: "active",
        issuedAt,
        createdAt: issuedAt,
        updatedAt: issuedAt
      });

      const [hostRow] = await tx.select().from(hosts).where(eq(hosts.hostId, request.host_id)).limit(1);
      if (!hostRow) {
        throw new HttpError(500, "Failed to create host");
      }
      return mapHost(hostRow);
    });

    return {
      host,
      host_token: token,
      token_type: "Bearer"
    };
  }

  async registerHost(auth: AuthenticatedHost, request: HostRegisterRequest): Promise<Host> {
    if (auth.hostId !== request.host_id) {
      throw new HttpError(403, "Host identity mismatch");
    }

    const saved = await this.db.transaction(async (tx) => {
      await this.upsertHost(tx, {
        hostId: request.host_id,
        label: request.label,
        hostVersion: request.host_version ?? null,
        hostStatus: "online",
        lastAuthenticatedAt: now()
      });
      const [hostRow] = await tx.select().from(hosts).where(eq(hosts.hostId, request.host_id)).limit(1);
      if (!hostRow) {
        throw new HttpError(500, "Failed to register host");
      }
      return hostRow;
    });

    return mapHost(saved);
  }

  async heartbeat(auth: AuthenticatedHost, hostId: string, request: HostHeartbeatRequest): Promise<{
    ok: true;
    last_heartbeat_at: string;
  }> {
    if (auth.hostId !== hostId) {
      throw new HttpError(403, "Host identity mismatch");
    }

    const timestamp = now();

    await this.db.transaction(async (tx) => {
      await tx
        .update(hosts)
        .set({
          hostStatus: request.host_status,
          lastHeartbeatAt: timestamp,
          updatedAt: timestamp
        })
        .where(eq(hosts.hostId, hostId));

      for (const mailbox of request.managed_mailboxes) {
        await tx
          .update(mailboxBindings)
          .set({
            bindingStatus: mailbox.binding_status,
            updatedAt: timestamp
          })
          .where(
            and(
              eq(mailboxBindings.hostId, hostId),
              eq(mailboxBindings.mailbox, mailbox.mailbox),
              eq(mailboxBindings.bindingStatus, "active")
            )
          );

        const [activeBinding] = await tx
          .select()
          .from(mailboxBindings)
          .where(
            and(
              eq(mailboxBindings.hostId, hostId),
              eq(mailboxBindings.mailbox, mailbox.mailbox),
              eq(mailboxBindings.bindingStatus, "active")
            )
          )
          .orderBy(desc(mailboxBindings.createdAt))
          .limit(1);

        const workspacePath = mailbox.workspace_path ?? activeBinding?.workspacePath;
        if (!workspacePath) {
          continue;
        }

        const runtimeValues = {
          mailbox: mailbox.mailbox,
          hostId,
          workspacePath,
          currentSessionId: mailbox.current_session_id ?? null,
          mailboxRuntimeStatus: mailbox.mailbox_runtime_status,
          activeTaskId: mailbox.active_task_id ?? null,
          lastProcessedDeliveryId: mailbox.last_processed_delivery_id ?? null,
          latestSummary: mailbox.latest_summary ?? null,
          lastHeartbeatAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        };

        await tx
          .insert(mailboxRuntimes)
          .values(runtimeValues)
          .onConflictDoUpdate({
            target: mailboxRuntimes.mailbox,
            set: {
              hostId,
              workspacePath,
              currentSessionId: runtimeValues.currentSessionId,
              mailboxRuntimeStatus: runtimeValues.mailboxRuntimeStatus,
              activeTaskId: runtimeValues.activeTaskId,
              lastProcessedDeliveryId: runtimeValues.lastProcessedDeliveryId,
              latestSummary: runtimeValues.latestSummary,
              lastHeartbeatAt: timestamp,
              updatedAt: timestamp
            }
          });
      }
    });

    return {
      ok: true,
      last_heartbeat_at: timestamp.toISOString()
    };
  }

  async issueIdempotencyKey(auth: AuthenticatedHost, mailbox: string, action: "send_email" | "create_task"): Promise<{
    idempotency_key: string;
  }> {
    const timestamp = now();
    const idempotencyKey = `idem_${action}_${createPrefixedId("key")}`;

    await this.ensureMailboxOwnedByHost(mailbox, auth.hostId);

    await this.db.insert(idempotencyKeys).values({
      idempotencyKey,
      hostId: auth.hostId,
      mailbox,
      action,
      createdAt: timestamp
    });

    return { idempotency_key: idempotencyKey };
  }

  async registerAgent(auth: AuthenticatedHost, request: RegisterAgentRequest): Promise<{
    profile: AgentProfile;
    binding: MailboxBinding;
  }> {
    if (auth.hostId !== request.host_id) {
      throw new HttpError(403, "Host identity mismatch");
    }

    const timestamp = now();

    return this.db.transaction(async (tx) => {
      const conflictingBinding = await this.findConflictingBinding(
        tx,
        request.mailbox,
        auth.hostId
      );
      if (conflictingBinding) {
        throw new HttpError(409, "Mailbox is actively bound to another healthy host");
      }

      const [activeProfile] = await tx
        .select()
        .from(agentProfiles)
        .where(
          and(eq(agentProfiles.mailbox, request.mailbox), eq(agentProfiles.profileStatus, "active"))
        )
        .limit(1);

      let profileRow = activeProfile;
      if (
        activeProfile &&
        (activeProfile.name !== request.name ||
          activeProfile.role !== request.role ||
          activeProfile.responsibilities !== request.responsibilities)
      ) {
        await tx
          .update(agentProfiles)
          .set({
            profileStatus: "retired",
            retiredAt: timestamp,
            updatedAt: timestamp
          })
          .where(eq(agentProfiles.agentId, activeProfile.agentId));
        profileRow = undefined;
      }

      if (!profileRow) {
        const profileId = createPrefixedId("agt");
        await tx.insert(agentProfiles).values({
          agentId: profileId,
          mailbox: request.mailbox,
          name: request.name,
          role: request.role,
          responsibilities: request.responsibilities,
          profileStatus: "active",
          registeredByHostId: auth.hostId,
          createdAt: timestamp,
          updatedAt: timestamp
        });

        const [createdProfile] = await tx
          .select()
          .from(agentProfiles)
          .where(eq(agentProfiles.agentId, profileId))
          .limit(1);
        if (!createdProfile) {
          throw new HttpError(500, "Failed to create agent profile");
        }
        profileRow = createdProfile;
      }

      await tx
        .update(mailboxBindings)
        .set({
          bindingStatus: "inactive",
          unboundAt: timestamp,
          updatedAt: timestamp
        })
        .where(
          and(eq(mailboxBindings.mailbox, request.mailbox), eq(mailboxBindings.bindingStatus, "active"))
        );

      const bindingId = createPrefixedId("bind");
      await tx.insert(mailboxBindings).values({
        bindingId,
        agentId: profileRow.agentId,
        mailbox: request.mailbox,
        hostId: auth.hostId,
        workspacePath: request.workspace_path,
        gitUserName: request.git_user_name,
        gitUserEmail: request.git_user_email,
        bindingStatus: "active",
        boundAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      await tx
        .insert(mailboxRuntimes)
        .values({
          mailbox: request.mailbox,
          hostId: auth.hostId,
          workspacePath: request.workspace_path,
          currentSessionId: null,
          mailboxRuntimeStatus: "idle",
          activeTaskId: null,
          lastProcessedDeliveryId: null,
          latestSummary: null,
          lastHeartbeatAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: mailboxRuntimes.mailbox,
          set: {
            hostId: auth.hostId,
            workspacePath: request.workspace_path,
            mailboxRuntimeStatus: "idle",
            updatedAt: timestamp
          }
        });

      const [bindingRow] = await tx
        .select()
        .from(mailboxBindings)
        .where(eq(mailboxBindings.bindingId, bindingId))
        .limit(1);
      if (!bindingRow) {
        throw new HttpError(500, "Failed to create mailbox binding");
      }

      return {
        profile: mapAgentProfile(profileRow),
        binding: mapMailboxBinding(bindingRow)
      };
    });
  }

  async listAgents(includeRetired = false): Promise<AgentProfile[]> {
    const rows = await this.db
      .select()
      .from(agentProfiles)
      .where(includeRetired ? undefined : eq(agentProfiles.profileStatus, "active"))
      .orderBy(asc(agentProfiles.mailbox));
    return rows.map(mapAgentProfile);
  }

  async getAgentByMailbox(mailbox: string): Promise<AgentProfile> {
    const [row] = await this.db
      .select()
      .from(agentProfiles)
      .where(and(eq(agentProfiles.mailbox, mailbox), eq(agentProfiles.profileStatus, "active")))
      .limit(1);

    if (!row) {
      throw new HttpError(404, "Agent profile not found");
    }
    return mapAgentProfile(row);
  }

  async sendEmail(auth: AuthenticatedHost, request: SendEmailRequest): Promise<{
    email: Email;
    deliveries: Delivery[];
    thread: Thread;
  }> {
    if (request.mailbox !== request.from.address) {
      throw new HttpError(400, "Sender mailbox mismatch");
    }

    await this.ensureMailboxOwnedByHost(request.mailbox, auth.hostId);
    await this.ensureMailboxCanSend(request.mailbox);
    await this.ensureRecipientMailboxesRegistered([
      ...request.to.map((item) => item.address),
      ...request.cc.map((item) => item.address)
    ]);

    return this.db.transaction(async (tx) => {
      const idempotency = await this.consumeIdempotencyIntent(
        tx,
        request.idempotency_key,
        auth.hostId,
        request.mailbox,
        "send_email"
      );

      if (idempotency?.resourceId) {
        return this.loadEmailSendResponse(tx, idempotency.resourceId);
      }

      const timestamp = now();
      const threadInfo = await this.resolveThread(tx, request);
      const emailId = createPrefixedId("eml");
      const messageId = createMessageId();

      if (!threadInfo.thread) {
        const threadId = createPrefixedId("thr");
        await tx.insert(threads).values({
          threadId,
          rootEmailId: null,
          rootMessageId: messageId,
          rootSubject: request.subject,
          latestEmailId: null,
          threadStatus: "open",
          createdAt: timestamp,
          updatedAt: timestamp
        });
        threadInfo.thread = {
          threadId,
          rootEmailId: null,
          rootMessageId: messageId,
          rootSubject: request.subject,
          latestEmailId: null,
          threadStatus: "open",
          createdAt: timestamp,
          updatedAt: timestamp
        };
      }

      await tx.insert(emails).values({
        emailId,
        messageId,
        threadId: threadInfo.thread.threadId,
        fromJson: request.from,
        toJson: request.to,
        ccJson: request.cc,
        subject: request.subject,
        bodyText: request.body_text,
        rawBody: request.raw_body,
        rawHeadersJson: request.raw_headers ?? null,
        inReplyTo: request.in_reply_to ?? null,
        referencesJson: request.references,
        emailKind: request.email_kind,
        sendState: "sent",
        createdByHostId: auth.hostId,
        createdByMailbox: request.mailbox,
        sentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      if (threadInfo.isNewThread) {
        await tx
          .update(threads)
          .set({
            rootEmailId: emailId,
            latestEmailId: emailId,
            updatedAt: timestamp
          })
          .where(eq(threads.threadId, threadInfo.thread.threadId));
      } else {
        await tx
          .update(threads)
          .set({
            latestEmailId: emailId,
            updatedAt: timestamp
          })
          .where(eq(threads.threadId, threadInfo.thread.threadId));
      }

      const createdDeliveries: Delivery[] = [];
      for (const recipient of request.to) {
        const deliveryId = createPrefixedId("del");
        await tx.insert(deliveries).values({
          deliveryId,
          emailId,
          threadId: threadInfo.thread.threadId,
          recipientAddress: recipient.address,
          recipientMailbox: recipient.address,
          deliveryKind: "to",
          readStatus: "unread",
          createdAt: timestamp,
          updatedAt: timestamp
        });
        createdDeliveries.push(
          mapDelivery({
            deliveryId,
            emailId,
            threadId: threadInfo.thread.threadId,
            recipientAddress: recipient.address,
            recipientMailbox: recipient.address,
            deliveryKind: "to",
            readStatus: "unread",
            readAt: null,
            createdAt: timestamp,
            updatedAt: timestamp
          })
        );
      }

      for (const recipient of request.cc) {
        const deliveryId = createPrefixedId("del");
        await tx.insert(deliveries).values({
          deliveryId,
          emailId,
          threadId: threadInfo.thread.threadId,
          recipientAddress: recipient.address,
          recipientMailbox: recipient.address,
          deliveryKind: "cc",
          readStatus: "unread",
          createdAt: timestamp,
          updatedAt: timestamp
        });
        createdDeliveries.push(
          mapDelivery({
            deliveryId,
            emailId,
            threadId: threadInfo.thread.threadId,
            recipientAddress: recipient.address,
            recipientMailbox: recipient.address,
            deliveryKind: "cc",
            readStatus: "unread",
            readAt: null,
            createdAt: timestamp,
            updatedAt: timestamp
          })
        );
      }

      for (const resource of request.linked_resources) {
        await tx.insert(linkedResources).values({
          linkedResourceId: createPrefixedId("lnk"),
          emailId,
          url: resource.url,
          title: resource.title ?? null,
          mimeType: resource.mime_type ?? null,
          sizeBytes: resource.size_bytes ?? null,
          createdAt: timestamp
        });
      }

      await tx
        .update(idempotencyKeys)
        .set({
          consumedAt: timestamp,
          resourceType: "email",
          resourceId: emailId
        })
        .where(eq(idempotencyKeys.idempotencyKey, request.idempotency_key));

      const response = await this.loadEmailSendResponse(tx, emailId);
      return {
        ...response,
        deliveries: createdDeliveries
      };
    });
  }

  async listDeliveries(mailbox: string, options: {
    readStatus?: "unread" | "read";
    limit?: number;
    order?: "oldest_first" | "newest_first";
  }): Promise<Delivery[]> {
    const conditions = [eq(deliveries.recipientMailbox, mailbox)];
    if (options.readStatus) {
      conditions.push(eq(deliveries.readStatus, options.readStatus));
    }

    const orderBy = options.order === "newest_first" ? desc(deliveries.createdAt) : asc(deliveries.createdAt);
    const baseQuery = this.db
      .select()
      .from(deliveries)
      .where(and(...conditions))
      .orderBy(orderBy);

    const rows = options.limit
      ? await baseQuery.limit(options.limit)
      : await baseQuery;
    return rows.map(mapDelivery);
  }

  async getOldestUnreadDelivery(mailbox: string): Promise<Delivery | null> {
    const [row] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.recipientMailbox, mailbox), eq(deliveries.readStatus, "unread")))
      .orderBy(asc(deliveries.createdAt))
      .limit(1);

    return row ? mapDelivery(row) : null;
  }

  async markDeliveryRead(mailbox: string, deliveryId: string): Promise<{
    ok: true;
    delivery_id: string;
    read_status: "read";
    read_at: string;
  }> {
    const [delivery] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.deliveryId, deliveryId), eq(deliveries.recipientMailbox, mailbox)))
      .limit(1);

    if (!delivery) {
      throw new HttpError(404, "Delivery not found");
    }

    const timestamp = delivery.readAt ?? now();
    if (delivery.readStatus !== "read") {
      await this.db
        .update(deliveries)
        .set({
          readStatus: "read",
          readAt: timestamp,
          updatedAt: timestamp
        })
        .where(eq(deliveries.deliveryId, deliveryId));
    }

    return {
      ok: true,
      delivery_id: deliveryId,
      read_status: "read",
      read_at: timestamp.toISOString()
    };
  }

  async getEmail(emailId: string): Promise<Email> {
    const [row] = await this.db.select().from(emails).where(eq(emails.emailId, emailId)).limit(1);
    if (!row) {
      throw new HttpError(404, "Email not found");
    }
    return mapEmail(row);
  }

  async getThread(threadId: string): Promise<{
    thread: Thread;
    emails: Email[];
    linked_resources: LinkedResource[];
    tasks: Task[];
  }> {
    const [threadRow] = await this.db
      .select()
      .from(threads)
      .where(eq(threads.threadId, threadId))
      .limit(1);
    if (!threadRow) {
      throw new HttpError(404, "Thread not found");
    }

    const emailRows = await this.db
      .select()
      .from(emails)
      .where(eq(emails.threadId, threadId))
      .orderBy(asc(emails.createdAt));

    const emailIds = emailRows.map((row) => row.emailId);
    const linkedRows = emailIds.length
      ? await this.db
          .select()
          .from(linkedResources)
          .where(inArray(linkedResources.emailId, emailIds))
          .orderBy(asc(linkedResources.createdAt))
      : [];
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.threadId, threadId))
      .orderBy(asc(tasks.createdAt));

    return {
      thread: mapThread(threadRow),
      emails: emailRows.map(mapEmail),
      linked_resources: linkedRows.map(mapLinkedResource),
      tasks: taskRows.map(mapTask)
    };
  }

  async createTask(auth: AuthenticatedHost, request: CreateTaskRequest): Promise<Task> {
    await this.ensureMailboxOwnedByHost(request.mailbox, auth.hostId);
    await this.ensureMailboxCanSend(request.mailbox);
    await this.ensureRecipientMailboxesRegistered([request.assignee_mailbox]);

    return this.db.transaction(async (tx) => {
      const idempotency = await this.consumeIdempotencyIntent(
        tx,
        request.idempotency_key,
        auth.hostId,
        request.mailbox,
        "create_task"
      );
      if (idempotency?.resourceId) {
        const [existing] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.taskId, idempotency.resourceId))
          .limit(1);
        if (!existing) {
          throw new HttpError(409, "Idempotent task reference is missing");
        }
        return mapTask(existing);
      }

      const [triggerEmail] = await tx
        .select()
        .from(emails)
        .where(eq(emails.emailId, request.trigger_email_id))
        .limit(1);
      if (!triggerEmail) {
        throw new HttpError(404, "Trigger email not found");
      }
      if (triggerEmail.threadId !== request.thread_id) {
        throw new HttpError(400, "Trigger email must belong to the same thread");
      }

      if (request.parent_task_id) {
        const [parentTask] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.taskId, request.parent_task_id))
          .limit(1);
        if (!parentTask) {
          throw new HttpError(404, "Parent task not found");
        }
      }

      const timestamp = now();
      const taskId = createPrefixedId("tsk");
      await tx.insert(tasks).values({
        taskId,
        threadId: request.thread_id,
        triggerEmailId: request.trigger_email_id,
        parentTaskId: request.parent_task_id ?? null,
        createdByEmailId: request.trigger_email_id,
        createdByMailbox: request.mailbox,
        assigneeMailbox: request.assignee_mailbox,
        title: request.title,
        instructions: request.instructions ?? null,
        requiresArtifact: request.requires_artifact,
        status: "new",
        completedByEmailId: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      await tx
        .update(idempotencyKeys)
        .set({
          consumedAt: timestamp,
          resourceType: "task",
          resourceId: taskId
        })
        .where(eq(idempotencyKeys.idempotencyKey, request.idempotency_key));

      const [taskRow] = await tx.select().from(tasks).where(eq(tasks.taskId, taskId)).limit(1);
      if (!taskRow) {
        throw new HttpError(500, "Failed to create task");
      }
      return mapTask(taskRow);
    });
  }

  async listTasks(options: {
    assigneeMailbox?: string;
    status?: Task["status"];
    threadId?: string;
    triggerEmailId?: string;
    parentTaskId?: string;
  }): Promise<Task[]> {
    const conditions = [];
    if (options.assigneeMailbox) {
      conditions.push(eq(tasks.assigneeMailbox, options.assigneeMailbox));
    }
    if (options.status) {
      conditions.push(eq(tasks.status, options.status));
    }
    if (options.threadId) {
      conditions.push(eq(tasks.threadId, options.threadId));
    }
    if (options.triggerEmailId) {
      conditions.push(eq(tasks.triggerEmailId, options.triggerEmailId));
    }
    if (options.parentTaskId) {
      conditions.push(eq(tasks.parentTaskId, options.parentTaskId));
    }

    const rows = await this.db
      .select()
      .from(tasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tasks.updatedAt));
    return rows.map(mapTask);
  }

  async getTask(taskId: string): Promise<Task> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.taskId, taskId)).limit(1);
    if (!row) {
      throw new HttpError(404, "Task not found");
    }
    return mapTask(row);
  }

  async updateTaskStatus(taskId: string, request: UpdateTaskStatusRequest): Promise<Task> {
    return this.db.transaction(async (tx) => {
      const [taskRow] = await tx.select().from(tasks).where(eq(tasks.taskId, taskId)).limit(1);
      if (!taskRow) {
        throw new HttpError(404, "Task not found");
      }

      if (taskRow.assigneeMailbox !== request.mailbox) {
        throw new HttpError(403, "Only the assignee mailbox can update the task");
      }

      let completedByEmailId: string | null = null;
      if (request.status === "done") {
        completedByEmailId = request.completed_by_email_id ?? null;
        if (!completedByEmailId) {
          throw new HttpError(400, "completed_by_email_id is required when status=done");
        }

        const [completionEmail] = await tx
          .select()
          .from(emails)
          .where(eq(emails.emailId, completedByEmailId))
          .limit(1);
        if (!completionEmail) {
          throw new HttpError(404, "Completion email not found");
        }
        if (completionEmail.threadId !== taskRow.threadId) {
          throw new HttpError(400, "Completion email must be in the same thread");
        }
        if (completionEmail.fromJson.address !== taskRow.assigneeMailbox) {
          throw new HttpError(400, "Completion email sender must match task assignee");
        }
        if (completionEmail.createdAt <= taskRow.createdAt) {
          throw new HttpError(400, "Completion email must be newer than the task");
        }

        if (taskRow.requiresArtifact && (!request.artifacts || request.artifacts.length === 0)) {
          throw new HttpError(400, "Artifacts are required for this task");
        }
      }

      const timestamp = now();
      await tx
        .update(tasks)
        .set({
          status: request.status,
          completedByEmailId,
          updatedAt: timestamp
        })
        .where(eq(tasks.taskId, taskId));

      if (request.status === "done") {
        await tx.delete(artifacts).where(eq(artifacts.taskId, taskId));
        for (const artifact of request.artifacts ?? []) {
          await tx.insert(artifacts).values({
            artifactId: createPrefixedId("art"),
            taskId,
            producedByMailbox: request.mailbox,
            repository: artifact.repository ?? null,
            path: artifact.path,
            branch: artifact.branch ?? null,
            commitSha: artifact.commit_sha ?? null,
            prLink: artifact.pr_link ?? null,
            createdAt: timestamp
          });
        }
      }

      const [updated] = await tx.select().from(tasks).where(eq(tasks.taskId, taskId)).limit(1);
      if (!updated) {
        throw new HttpError(500, "Task status update failed");
      }
      return mapTask(updated);
    });
  }

  async getRuntimeSnapshot(hostId: string): Promise<{
    host: Host;
    bindings: MailboxBinding[];
    runtimes: ReturnType<typeof mapMailboxRuntime>[];
  }> {
    const [hostRow] = await this.db.select().from(hosts).where(eq(hosts.hostId, hostId)).limit(1);
    if (!hostRow) {
      throw new HttpError(404, "Host not found");
    }
    const bindingRows = await this.db
      .select()
      .from(mailboxBindings)
      .where(eq(mailboxBindings.hostId, hostId))
      .orderBy(asc(mailboxBindings.mailbox), desc(mailboxBindings.createdAt));
    const runtimeRows = await this.db
      .select()
      .from(mailboxRuntimes)
      .where(eq(mailboxRuntimes.hostId, hostId))
      .orderBy(asc(mailboxRuntimes.mailbox));
    return {
      host: mapHost(hostRow),
      bindings: bindingRows.map(mapMailboxBinding),
      runtimes: runtimeRows.map(mapMailboxRuntime)
    };
  }

  private async upsertHost(
    tx: Transaction,
    input: {
      hostId: string;
      label: string;
      hostVersion: string | null;
      hostStatus: string;
      lastAuthenticatedAt?: Date;
    }
  ): Promise<void> {
    const timestamp = now();
    await tx
      .insert(hosts)
      .values({
        hostId: input.hostId,
        label: input.label,
        hostVersion: input.hostVersion,
        hostStatus: input.hostStatus,
        lastAuthenticatedAt: input.lastAuthenticatedAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: hosts.hostId,
        set: {
          label: input.label,
          hostVersion: input.hostVersion,
          hostStatus: input.hostStatus,
          lastAuthenticatedAt: input.lastAuthenticatedAt ?? undefined,
          updatedAt: timestamp
        }
      });
  }

  private async findConflictingBinding(
    tx: Transaction,
    mailbox: string,
    currentHostId: string
  ): Promise<MailboxBindingRow | null> {
    const rows = await tx
      .select({
        binding: mailboxBindings,
        host: hosts
      })
      .from(mailboxBindings)
      .innerJoin(hosts, eq(mailboxBindings.hostId, hosts.hostId))
      .where(
        and(
          eq(mailboxBindings.mailbox, mailbox),
          eq(mailboxBindings.bindingStatus, "active"),
          ne(mailboxBindings.hostId, currentHostId)
        )
      )
      .limit(5);

    const conflict = rows.find(({ host }) => isHostHealthy(host));
    return conflict?.binding ?? null;
  }

  private async ensureMailboxOwnedByHost(mailbox: string, hostId: string): Promise<void> {
    const [binding] = await this.db
      .select()
      .from(mailboxBindings)
      .where(
        and(
          eq(mailboxBindings.mailbox, mailbox),
          eq(mailboxBindings.hostId, hostId),
          eq(mailboxBindings.bindingStatus, "active")
        )
      )
      .orderBy(desc(mailboxBindings.createdAt))
      .limit(1);

    if (!binding) {
      throw new HttpError(403, "Mailbox is not actively bound to this host");
    }
  }

  private async ensureMailboxCanSend(mailbox: string): Promise<void> {
    const [profile] = await this.db
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.mailbox, mailbox))
      .orderBy(desc(agentProfiles.createdAt))
      .limit(1);

    if (!profile) {
      throw new HttpError(404, "Mailbox profile not found");
    }
    if (profile.profileStatus === "retired") {
      throw new HttpError(409, "Retired mailbox cannot send new email");
    }
  }

  private async ensureRecipientMailboxesRegistered(mailboxes: string[]): Promise<void> {
    const agentMailboxes = [...new Set(mailboxes.filter((mailbox) => mailbox.endsWith("@agents.local")))];
    if (agentMailboxes.length === 0) {
      return;
    }

    const rows = await this.db
      .select({
        mailbox: agentProfiles.mailbox
      })
      .from(agentProfiles)
      .where(
        and(
          inArray(agentProfiles.mailbox, agentMailboxes),
          eq(agentProfiles.profileStatus, "active")
        )
      );

    const activeMailboxes = new Set(rows.map((row) => row.mailbox));
    const missing = agentMailboxes.filter((mailbox) => !activeMailboxes.has(mailbox));
    if (missing.length > 0) {
      throw new HttpError(409, `Recipient mailboxes are not registered: ${missing.join(", ")}`);
    }
  }

  private async consumeIdempotencyIntent(
    tx: Transaction,
    idempotencyKey: string,
    hostId: string,
    mailbox: string,
    action: "send_email" | "create_task"
  ): Promise<{ resourceId: string | null } | null> {
    const [record] = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
          eq(idempotencyKeys.hostId, hostId),
          eq(idempotencyKeys.mailbox, mailbox),
          eq(idempotencyKeys.action, action)
        )
      )
      .limit(1);

    if (!record) {
      throw new HttpError(400, "Unknown idempotency key");
    }

    return {
      resourceId: record.resourceId ?? null
    };
  }

  private async resolveThread(
    tx: Transaction,
    request: Pick<SendEmailRequest, "in_reply_to" | "references" | "subject">
  ): Promise<{ thread: ThreadRow | null; isNewThread: boolean }> {
    const candidateIds = [
      request.in_reply_to,
      ...[...request.references].reverse()
    ].filter((value): value is string => Boolean(value));

    if (candidateIds.length === 0) {
      return { thread: null, isNewThread: true };
    }

    const matchedEmails = await tx
      .select()
      .from(emails)
      .where(inArray(emails.messageId, candidateIds));

    if (matchedEmails.length === 0) {
      return { thread: null, isNewThread: true };
    }

    const selected = candidateIds
      .map((messageId) => matchedEmails.find((row) => row.messageId === messageId))
      .find(Boolean);
    if (!selected) {
      return { thread: null, isNewThread: true };
    }

    const [threadRow] = await tx
      .select()
      .from(threads)
      .where(eq(threads.threadId, selected.threadId))
      .limit(1);
    if (!threadRow) {
      return { thread: null, isNewThread: true };
    }

    return { thread: threadRow, isNewThread: false };
  }

  private async loadEmailSendResponse(
    tx: Transaction,
    emailId: string
  ): Promise<{
    email: Email;
    deliveries: Delivery[];
    thread: Thread;
  }> {
    const [emailRow] = await tx.select().from(emails).where(eq(emails.emailId, emailId)).limit(1);
    if (!emailRow) {
      throw new HttpError(404, "Email not found");
    }
    const [threadRow] = await tx
      .select()
      .from(threads)
      .where(eq(threads.threadId, emailRow.threadId))
      .limit(1);
    if (!threadRow) {
      throw new HttpError(500, "Thread missing for email");
    }
    const deliveryRows = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.emailId, emailId))
      .orderBy(asc(deliveries.createdAt));

    return {
      email: mapEmail(emailRow),
      deliveries: deliveryRows.map(mapDelivery),
      thread: mapThread(threadRow)
    };
  }
}

function mapHost(row: HostRow): Host {
  return {
    host_id: row.hostId,
    label: row.label,
    host_version: row.hostVersion,
    host_status: row.hostStatus as Host["host_status"],
    last_heartbeat_at: toIso(row.lastHeartbeatAt),
    last_authenticated_at: toIso(row.lastAuthenticatedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapAgentProfile(row: AgentProfileRow): AgentProfile {
  return {
    agent_id: row.agentId,
    mailbox: row.mailbox,
    name: row.name,
    role: row.role,
    responsibilities: row.responsibilities,
    profile_status: row.profileStatus as AgentProfile["profile_status"],
    registered_by_host_id: row.registeredByHostId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    retired_at: toIso(row.retiredAt)
  };
}

function mapMailboxBinding(row: MailboxBindingRow): MailboxBinding {
  return {
    binding_id: row.bindingId,
    agent_id: row.agentId,
    mailbox: row.mailbox,
    host_id: row.hostId,
    workspace_path: row.workspacePath,
    git_user_name: row.gitUserName,
    git_user_email: row.gitUserEmail,
    binding_status: row.bindingStatus as MailboxBinding["binding_status"],
    bound_at: row.boundAt.toISOString(),
    unbound_at: toIso(row.unboundAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapMailboxRuntime(row: MailboxRuntimeRow) {
  return {
    mailbox: row.mailbox,
    host_id: row.hostId,
    workspace_path: row.workspacePath,
    current_session_id: row.currentSessionId,
    mailbox_runtime_status:
      row.mailboxRuntimeStatus as "bootstrapping" | "idle" | "running" | "failed" | "cleared",
    active_task_id: row.activeTaskId,
    last_processed_delivery_id: row.lastProcessedDeliveryId,
    latest_summary: row.latestSummary,
    last_heartbeat_at: toIso(row.lastHeartbeatAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapThread(row: ThreadRow): Thread {
  return {
    thread_id: row.threadId,
    root_email_id: row.rootEmailId ?? "",
    root_message_id: row.rootMessageId,
    root_subject: row.rootSubject,
    latest_email_id: row.latestEmailId,
    thread_status: row.threadStatus as Thread["thread_status"],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapEmail(row: EmailRow): Email {
  return {
    email_id: row.emailId,
    message_id: row.messageId,
    thread_id: row.threadId,
    from: row.fromJson,
    to: row.toJson,
    cc: row.ccJson,
    subject: row.subject,
    body_text: row.bodyText,
    raw_body: row.rawBody,
    raw_headers: row.rawHeadersJson ?? null,
    in_reply_to: row.inReplyTo ?? null,
    references: row.referencesJson,
    email_kind: row.emailKind as Email["email_kind"],
    send_state: row.sendState as Email["send_state"],
    created_by_host_id: row.createdByHostId ?? null,
    created_by_mailbox: row.createdByMailbox ?? null,
    sent_at: toIso(row.sentAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapDelivery(row: DeliveryRow): Delivery {
  return {
    delivery_id: row.deliveryId,
    email_id: row.emailId,
    thread_id: row.threadId,
    recipient_address: row.recipientAddress,
    recipient_mailbox: row.recipientMailbox ?? null,
    delivery_kind: row.deliveryKind as Delivery["delivery_kind"],
    read_status: row.readStatus as Delivery["read_status"],
    read_at: toIso(row.readAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapTask(row: TaskRow): Task {
  return {
    task_id: row.taskId,
    thread_id: row.threadId,
    trigger_email_id: row.triggerEmailId,
    parent_task_id: row.parentTaskId ?? null,
    created_by_email_id: row.createdByEmailId ?? null,
    created_by_mailbox: row.createdByMailbox,
    assignee_mailbox: row.assigneeMailbox,
    title: row.title,
    instructions: row.instructions ?? null,
    requires_artifact: row.requiresArtifact,
    status: row.status as Task["status"],
    completed_by_email_id: row.completedByEmailId ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function mapLinkedResource(row: LinkedResourceRow): LinkedResource {
  return {
    linked_resource_id: row.linkedResourceId,
    email_id: row.emailId,
    url: row.url,
    title: row.title ?? null,
    mime_type: row.mimeType ?? null,
    size_bytes: row.sizeBytes ?? null,
    created_at: row.createdAt.toISOString()
  };
}

function isHostHealthy(host: HostRow): boolean {
  if (host.hostStatus === "offline" || host.hostStatus === "auth_failed") {
    return false;
  }
  const anchor = host.lastHeartbeatAt ?? host.lastAuthenticatedAt;
  if (!anchor) {
    return false;
  }
  return Date.now() - anchor.getTime() <= HOST_HEALTH_WINDOW_MS;
}
