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
  LinkedResourceInput,
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

  async listHosts(): Promise<{
    hosts: Array<{
      host: Host;
      managed_mailboxes: number;
      running_mailboxes: number;
      failed_mailboxes: number;
      unread_deliveries: number;
    }>;
  }> {
    const [hostRows, bindingRows, runtimeRows, unreadRows] = await Promise.all([
      this.db.select().from(hosts).orderBy(asc(hosts.label)),
      this.db.select().from(mailboxBindings).orderBy(desc(mailboxBindings.createdAt)),
      this.db.select().from(mailboxRuntimes),
      this.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.readStatus, "unread"))
    ]);

    const latestBindings = latestByMailbox(bindingRows);
    const runtimeByMailbox = new Map(runtimeRows.map((row) => [row.mailbox, row]));
    const unreadCountByMailbox = countUnreadByMailbox(unreadRows);

    return {
      hosts: hostRows.map((row) => {
        const activeBindings = [...latestBindings.values()].filter(
          (binding) => binding.hostId === row.hostId && binding.bindingStatus === "active"
        );
        const mailboxes = activeBindings.map((binding) => binding.mailbox);
        const hostRuntimes = mailboxes
          .map((mailbox) => runtimeByMailbox.get(mailbox))
          .filter((item): item is MailboxRuntimeRow => Boolean(item));

        return {
          host: mapHost(row),
          managed_mailboxes: mailboxes.length,
          running_mailboxes: hostRuntimes.filter((item) => item.mailboxRuntimeStatus === "running")
            .length,
          failed_mailboxes: hostRuntimes.filter((item) => item.mailboxRuntimeStatus === "failed")
            .length,
          unread_deliveries: mailboxes.reduce(
            (sum, mailbox) => sum + (unreadCountByMailbox.get(mailbox) ?? 0),
            0
          )
        };
      })
    };
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

  async ingestHumanEmail(input: {
    from: AddressObject;
    to: AddressObject[];
    cc?: AddressObject[];
    subject: string;
    body_text: string;
    raw_body: string;
    raw_headers?: Record<string, string> | null;
    in_reply_to?: string | null;
    references?: string[];
    linked_resources?: LinkedResourceInput[];
  }): Promise<{
    email: Email;
    deliveries: Delivery[];
    thread: Thread;
  }> {
    if (input.to.length !== 1) {
      throw new HttpError(400, "POC requires exactly one primary recipient");
    }

    const cc = input.cc ?? [];
    await this.ensureRecipientMailboxesRegistered([
      ...input.to.map((item) => item.address),
      ...cc.map((item) => item.address)
    ]);

    return this.db.transaction(async (tx) => {
      const timestamp = now();
      const threadInfo = await this.resolveThread(tx, {
        in_reply_to: input.in_reply_to ?? null,
        references: input.references ?? [],
        subject: input.subject
      });
      const emailId = createPrefixedId("eml");
      const messageId = createMessageId();

      if (!threadInfo.thread) {
        const threadId = createPrefixedId("thr");
        await tx.insert(threads).values({
          threadId,
          rootEmailId: null,
          rootMessageId: messageId,
          rootSubject: input.subject,
          latestEmailId: null,
          threadStatus: "open",
          createdAt: timestamp,
          updatedAt: timestamp
        });
        threadInfo.thread = {
          threadId,
          rootEmailId: null,
          rootMessageId: messageId,
          rootSubject: input.subject,
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
        fromJson: input.from,
        toJson: input.to,
        ccJson: cc,
        subject: input.subject,
        bodyText: input.body_text,
        rawBody: input.raw_body,
        rawHeadersJson: input.raw_headers ?? null,
        inReplyTo: input.in_reply_to ?? null,
        referencesJson: input.references ?? [],
        emailKind: "human_inbound",
        sendState: "sent",
        createdByHostId: null,
        createdByMailbox: null,
        sentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      if (!threadInfo.thread.rootEmailId) {
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
      for (const recipient of input.to) {
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

      for (const recipient of cc) {
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

      for (const resource of input.linked_resources ?? []) {
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

  async listWebThreads(options: {
    status?: Thread["thread_status"];
    mailbox?: string;
    limit?: number;
  }): Promise<{
    threads: Array<{
      thread: Thread;
      participants: string[];
      latest_email: Email | null;
      open_task_count: number;
    }>;
  }> {
    const threadRows = await this.db
      .select()
      .from(threads)
      .where(options.status ? eq(threads.threadStatus, options.status) : undefined)
      .orderBy(desc(threads.updatedAt));

    const threadIds = threadRows.map((row) => row.threadId);
    if (threadIds.length === 0) {
      return { threads: [] };
    }

    const [emailRows, taskRows] = await Promise.all([
      this.db
        .select()
        .from(emails)
        .where(inArray(emails.threadId, threadIds))
        .orderBy(asc(emails.createdAt)),
      this.db
        .select()
        .from(tasks)
        .where(inArray(tasks.threadId, threadIds))
        .orderBy(desc(tasks.updatedAt))
    ]);

    const emailsByThread = groupBy(emailRows, (row) => row.threadId);
    const tasksByThread = groupBy(taskRows, (row) => row.threadId);

    const summaries = threadRows
      .map((row) => {
        const emailsForThread = emailsByThread.get(row.threadId) ?? [];
        const tasksForThread = tasksByThread.get(row.threadId) ?? [];
        const participants = collectParticipants(emailsForThread);
        const latestEmail = emailsForThread.at(-1) ?? null;

        return {
          thread: mapThread(row),
          participants,
          latest_email: latestEmail ? mapEmail(latestEmail) : null,
          open_task_count: tasksForThread.filter((item) => item.status !== "done").length,
          _matchesMailbox:
            !options.mailbox ||
            participants.includes(options.mailbox) ||
            tasksForThread.some(
              (item) =>
                item.assigneeMailbox === options.mailbox || item.createdByMailbox === options.mailbox
            )
        };
      })
      .filter((item) => item._matchesMailbox)
      .map(({ _matchesMailbox: _unused, ...item }) => item);

    return {
      threads: options.limit ? summaries.slice(0, options.limit) : summaries
    };
  }

  async listWebEmails(options: {
    mailbox?: string;
    threadId?: string;
    kind?: Email["email_kind"];
    direction?: "sent" | "received";
    limit?: number;
  }): Promise<{
    emails: Array<{
      email: Email;
      direction: "sent" | "received" | null;
      counterparty: string | null;
    }>;
  }> {
    const conditions = [];
    if (options.threadId) {
      conditions.push(eq(emails.threadId, options.threadId));
    }
    if (options.kind) {
      conditions.push(eq(emails.emailKind, options.kind));
    }

    const emailRows = await this.db
      .select()
      .from(emails)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(emails.createdAt));

    const emailIds = emailRows.map((row) => row.emailId);
    const deliveryRows = emailIds.length
      ? await this.db
          .select()
          .from(deliveries)
          .where(inArray(deliveries.emailId, emailIds))
      : [];
    const deliveriesByEmail = groupBy(deliveryRows, (row) => row.emailId);

    const summaries = emailRows
      .map((row) => {
        const deliveriesForEmail = deliveriesByEmail.get(row.emailId) ?? [];
        let direction: "sent" | "received" | null = null;
        let counterparty: string | null = null;

        if (options.mailbox) {
          if (row.createdByMailbox === options.mailbox || row.fromJson.address === options.mailbox) {
            direction = "sent";
            counterparty = firstCounterparty(row, options.mailbox);
          } else if (
            deliveriesForEmail.some((delivery) => delivery.recipientMailbox === options.mailbox)
          ) {
            direction = "received";
            counterparty = row.fromJson.address;
          }
        } else {
          direction = row.createdByMailbox ? "sent" : deliveriesForEmail.length > 0 ? "received" : null;
          counterparty = direction === "sent" ? firstCounterparty(row, row.fromJson.address) : row.fromJson.address;
        }

        return {
          email: mapEmail(row),
          direction,
          counterparty
        };
      })
      .filter((item) => {
        if (options.mailbox && item.direction === null) {
          return false;
        }
        if (options.direction && item.direction !== options.direction) {
          return false;
        }
        return true;
      });

    return {
      emails: options.limit ? summaries.slice(0, options.limit) : summaries
    };
  }

  async listWebMailboxes(options: {
    hostId?: string;
    runtimeStatus?: "bootstrapping" | "idle" | "running" | "failed" | "cleared";
    bindingStatus?: "active" | "inactive" | "failed";
    hasUnread?: boolean;
  }): Promise<{
    mailboxes: Array<{
      profile: AgentProfile;
      binding: MailboxBinding | null;
      runtime: ReturnType<typeof mapMailboxRuntime> | null;
      host: Host | null;
      unread_deliveries: number;
      open_task_count: number;
    }>;
  }> {
    const [profileRows, bindingRows, runtimeRows, hostRows, unreadRows, taskRows] = await Promise.all([
      this.db
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.profileStatus, "active"))
        .orderBy(asc(agentProfiles.mailbox)),
      this.db.select().from(mailboxBindings).orderBy(desc(mailboxBindings.createdAt)),
      this.db.select().from(mailboxRuntimes),
      this.db.select().from(hosts),
      this.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.readStatus, "unread")),
      this.db
        .select()
        .from(tasks)
        .where(ne(tasks.status, "done"))
    ]);

    const latestBindings = latestByMailbox(bindingRows);
    const runtimeByMailbox = new Map(runtimeRows.map((row) => [row.mailbox, row]));
    const hostById = new Map(hostRows.map((row) => [row.hostId, row]));
    const unreadCountByMailbox = countUnreadByMailbox(unreadRows);
    const openTaskCountByMailbox = countOpenTasksByMailbox(taskRows);

    const mailboxes = profileRows
      .map((row) => {
        const bindingRow = latestBindings.get(row.mailbox) ?? null;
        const runtimeRow = runtimeByMailbox.get(row.mailbox) ?? null;
        const hostRow = hostById.get(runtimeRow?.hostId ?? bindingRow?.hostId ?? "") ?? null;
        const unreadCount = unreadCountByMailbox.get(row.mailbox) ?? 0;

        return {
          profile: mapAgentProfile(row),
          binding: bindingRow ? mapMailboxBinding(bindingRow) : null,
          runtime: runtimeRow ? mapMailboxRuntime(runtimeRow) : null,
          host: hostRow ? mapHost(hostRow) : null,
          unread_deliveries: unreadCount,
          open_task_count: openTaskCountByMailbox.get(row.mailbox) ?? 0
        };
      })
      .filter((item) => {
        if (options.hostId) {
          const currentHostId = item.runtime?.host_id ?? item.binding?.host_id ?? null;
          if (currentHostId !== options.hostId) {
            return false;
          }
        }
        if (options.runtimeStatus && item.runtime?.mailbox_runtime_status !== options.runtimeStatus) {
          return false;
        }
        if (options.bindingStatus && item.binding?.binding_status !== options.bindingStatus) {
          return false;
        }
        if (options.hasUnread !== undefined) {
          if (options.hasUnread && item.unread_deliveries === 0) {
            return false;
          }
          if (!options.hasUnread && item.unread_deliveries > 0) {
            return false;
          }
        }
        return true;
      });

    return { mailboxes };
  }

  async getWebMailboxDetail(
    mailbox: string,
    options: {
      activityLimit?: number;
    } = {}
  ): Promise<{
    profile: AgentProfile;
    binding: MailboxBinding | null;
    runtime: ReturnType<typeof mapMailboxRuntime> | null;
    host: Host | null;
    activity: Array<{
      direction: "sent" | "received";
      email: Email;
      delivery: Delivery | null;
    }>;
    threads: Thread[];
    tasks: Task[];
  }> {
    const activityLimit = options.activityLimit ?? 50;
    const profile = await this.getAgentByMailbox(mailbox);

    const [bindingRow, runtimeRow, sentEmailRows, receivedDeliveryRows, taskRows] = await Promise.all([
      this.db
        .select()
        .from(mailboxBindings)
        .where(eq(mailboxBindings.mailbox, mailbox))
        .orderBy(desc(mailboxBindings.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select()
        .from(mailboxRuntimes)
        .where(eq(mailboxRuntimes.mailbox, mailbox))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select()
        .from(emails)
        .where(eq(emails.createdByMailbox, mailbox))
        .orderBy(desc(emails.createdAt))
        .limit(activityLimit),
      this.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.recipientMailbox, mailbox))
        .orderBy(desc(deliveries.createdAt))
        .limit(activityLimit),
      this.db
        .select()
        .from(tasks)
        .where(or(eq(tasks.assigneeMailbox, mailbox), eq(tasks.createdByMailbox, mailbox)))
        .orderBy(desc(tasks.updatedAt))
    ]);

    const hostRow =
      runtimeRow || bindingRow
        ? (
            await this.db
              .select()
              .from(hosts)
              .where(eq(hosts.hostId, runtimeRow?.hostId ?? bindingRow!.hostId))
              .limit(1)
          )[0] ?? null
        : null;

    const activityEmailIds = [
      ...sentEmailRows.map((row) => row.emailId),
      ...receivedDeliveryRows.map((row) => row.emailId)
    ];
    const uniqueEmailIds = [...new Set(activityEmailIds)];
    const activityEmailRows = uniqueEmailIds.length
      ? await this.db.select().from(emails).where(inArray(emails.emailId, uniqueEmailIds))
      : [];
    const emailById = new Map(activityEmailRows.map((row) => [row.emailId, row]));

    const activity = [
      ...sentEmailRows.map((row) => ({
        sortAt: row.createdAt.getTime(),
        direction: "sent" as const,
        email: mapEmail(row),
        delivery: null
      })),
      ...receivedDeliveryRows
        .map((row) => {
          const emailRow = emailById.get(row.emailId);
          if (!emailRow) {
            return null;
          }
          return {
            sortAt: row.createdAt.getTime(),
            direction: "received" as const,
            email: mapEmail(emailRow),
            delivery: mapDelivery(row)
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    ]
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(0, activityLimit)
      .map(({ sortAt: _sortAt, ...item }) => item);

    const threadIds = [
      ...new Set([
        ...activity.map((item) => item.email.thread_id),
        ...taskRows.map((row) => row.threadId)
      ])
    ];
    const threadRows = threadIds.length
      ? await this.db
          .select()
          .from(threads)
          .where(inArray(threads.threadId, threadIds))
          .orderBy(desc(threads.updatedAt))
      : [];

    return {
      profile,
      binding: bindingRow ? mapMailboxBinding(bindingRow) : null,
      runtime: runtimeRow ? mapMailboxRuntime(runtimeRow) : null,
      host: hostRow ? mapHost(hostRow) : null,
      activity,
      threads: threadRows.map(mapThread),
      tasks: taskRows.map(mapTask)
    };
  }

  async getWebOverview(): Promise<{
    counters: {
      unread_deliveries: number;
      waiting_human_threads: number;
      blocked_tasks: number;
      online_hosts: number;
    };
    oldest_unread: Array<{
      delivery: Delivery;
      email: Email;
    }>;
    host_health: Array<{
      host: Host;
      managed_mailboxes: number;
      running_mailboxes: number;
      failed_mailboxes: number;
      unread_deliveries: number;
    }>;
    attention_threads: Array<{
      thread: Thread;
      participants: string[];
      latest_email: Email | null;
      open_task_count: number;
    }>;
    recent_activity: Array<{
      type: "email" | "task" | "host";
      title: string;
      subtitle: string;
      at: string;
      thread_id: string | null;
      email_id: string | null;
      host_id: string | null;
      mailbox: string | null;
    }>;
  }> {
    const [hostHealth, unreadRows, threadRows, taskRows, recentEmailRows] = await Promise.all([
      this.listHosts(),
      this.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.readStatus, "unread"))
        .orderBy(asc(deliveries.createdAt)),
      this.db.select().from(threads),
      this.db.select().from(tasks),
      this.db.select().from(emails).orderBy(desc(emails.createdAt)).limit(10)
    ]);

    const oldestUnreadRows = unreadRows.slice(0, 10);
    const oldestUnreadEmailIds = oldestUnreadRows.map((row) => row.emailId);
    const oldestUnreadEmailRows = oldestUnreadEmailIds.length
      ? await this.db.select().from(emails).where(inArray(emails.emailId, oldestUnreadEmailIds))
      : [];
    const emailById = new Map(oldestUnreadEmailRows.map((row) => [row.emailId, row]));

    const attentionThreadIds = threadRows
      .filter((row) => row.threadStatus === "waiting_human" || row.threadStatus === "blocked")
      .map((row) => row.threadId);

    const attentionThreadResponse = attentionThreadIds.length
      ? await this.listWebThreads({ limit: 20 })
      : { threads: [] };

    return {
      counters: {
        unread_deliveries: unreadRows.length,
        waiting_human_threads: threadRows.filter((row) => row.threadStatus === "waiting_human").length,
        blocked_tasks: taskRows.filter((row) => row.status === "blocked").length,
        online_hosts: hostHealth.hosts.filter((item) => item.host.host_status === "online").length
      },
      oldest_unread: oldestUnreadRows
        .map((row) => {
          const emailRow = emailById.get(row.emailId);
          if (!emailRow) {
            return null;
          }
          return {
            delivery: mapDelivery(row),
            email: mapEmail(emailRow)
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      host_health: hostHealth.hosts,
      attention_threads: attentionThreadResponse.threads
        .filter(
          (item) =>
            item.thread.thread_status === "waiting_human" || item.thread.thread_status === "blocked"
        )
        .slice(0, 10),
      recent_activity: recentEmailRows.map((row) => ({
        type: "email" as const,
        title: `${row.fromJson.display_name} · ${row.subject}`,
        subtitle: row.emailKind,
        at: row.createdAt.toISOString(),
        thread_id: row.threadId,
        email_id: row.emailId,
        host_id: row.createdByHostId ?? null,
        mailbox: row.createdByMailbox ?? row.fromJson.address
      }))
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

function latestByMailbox<T extends { mailbox: string; createdAt: Date }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.mailbox)) {
      map.set(row.mailbox, row);
    }
  }
  return map;
}

function groupBy<T>(rows: T[], getKey: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = getKey(row);
    const group = map.get(key);
    if (group) {
      group.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

function collectParticipants(rows: EmailRow[]): string[] {
  const participants = new Set<string>();
  for (const row of rows) {
    participants.add(row.fromJson.address);
    for (const item of row.toJson) {
      participants.add(item.address);
    }
    for (const item of row.ccJson) {
      participants.add(item.address);
    }
  }
  return [...participants];
}

function countUnreadByMailbox(rows: DeliveryRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.recipientMailbox) {
      continue;
    }
    counts.set(row.recipientMailbox, (counts.get(row.recipientMailbox) ?? 0) + 1);
  }
  return counts;
}

function countOpenTasksByMailbox(rows: TaskRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.assigneeMailbox, (counts.get(row.assigneeMailbox) ?? 0) + 1);
  }
  return counts;
}

function firstCounterparty(row: EmailRow, mailbox: string): string | null {
  const recipients = [...row.toJson, ...row.ccJson]
    .map((item) => item.address)
    .filter((address) => address !== mailbox);
  return recipients[0] ?? null;
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
