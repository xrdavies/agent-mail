import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedHost,
  CentralService
} from "../src/service.js";
import * as schema from "../src/db/schema.js";
import { CentralService as CentralServiceImpl } from "../src/service.js";

const pools: Array<{ close(): Promise<void> | void }> = [];
const testDir = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(testDir, "../drizzle");

afterEach(async () => {
  while (pools.length > 0) {
    const pool = pools.pop();
    await pool?.close();
  }
});

describe("CentralService", () => {
  it("supports host bootstrap, agent registration, and delivery flow", async () => {
    const { service } = await createTestService();
    const { auth } = await bootstrapHost(service);

    await registerAgent(service, auth, {
      mailbox: "pm.aster@agents.local",
      name: "Aster",
      role: "pm",
      responsibilities: "PM agent."
    });
    await registerAgent(service, auth, {
      mailbox: "backend.coda@agents.local",
      name: "Coda",
      role: "backend",
      responsibilities: "Backend agent."
    });

    const sendKey = await service.issueIdempotencyKey(auth, "pm.aster@agents.local", "send_email");
    const sent = await service.sendEmail(auth, {
      idempotency_key: sendKey.idempotency_key,
      mailbox: "pm.aster@agents.local",
      from: {
        display_name: "Aster",
        address: "pm.aster@agents.local"
      },
      to: [
        {
          display_name: "Coda",
          address: "backend.coda@agents.local"
        }
      ],
      cc: [],
      subject: "Review backend requirements",
      body_text: "Please review backend requirements.",
      raw_body: "Please review backend requirements.",
      raw_headers: {
        from: "Aster <pm.aster@agents.local>",
        to: "Coda <backend.coda@agents.local>",
        cc: "",
        subject: "Review backend requirements"
      },
      references: [],
      email_kind: "agent_delegation",
      linked_resources: []
    });

    expect(sent.thread.thread_id).toMatch(/^thr_/);
    expect(sent.deliveries).toHaveLength(1);
    expect(sent.deliveries[0]?.recipient_mailbox).toBe("backend.coda@agents.local");

    const oldest = await service.getOldestUnreadDelivery("backend.coda@agents.local");
    expect(oldest?.delivery_id).toBe(sent.deliveries[0]?.delivery_id);

    const marked = await service.markDeliveryRead(
      "backend.coda@agents.local",
      sent.deliveries[0]!.delivery_id
    );
    expect(marked.read_status).toBe("read");

    const thread = await service.getThread(sent.thread.thread_id);
    expect(thread.emails).toHaveLength(1);
    expect(thread.thread.root_email_id).toBe(sent.email.email_id);
  });

  it("rejects delivery to unregistered agent mailboxes", async () => {
    const { service } = await createTestService();
    const { auth } = await bootstrapHost(service);

    await registerAgent(service, auth, {
      mailbox: "pm.aster@agents.local",
      name: "Aster",
      role: "pm",
      responsibilities: "PM agent."
    });

    const sendKey = await service.issueIdempotencyKey(auth, "pm.aster@agents.local", "send_email");

    await expect(
      service.sendEmail(auth, {
        idempotency_key: sendKey.idempotency_key,
        mailbox: "pm.aster@agents.local",
        from: {
          display_name: "Aster",
          address: "pm.aster@agents.local"
        },
        to: [
          {
            display_name: "Coda",
            address: "backend.coda@agents.local"
          }
        ],
        cc: [],
        subject: "Review backend requirements",
        body_text: "Please review backend requirements.",
        raw_body: "Please review backend requirements.",
        raw_headers: {
          from: "Aster <pm.aster@agents.local>",
          to: "Coda <backend.coda@agents.local>",
          cc: "",
          subject: "Review backend requirements"
        },
        references: [],
        email_kind: "agent_delegation",
        linked_resources: []
      })
    ).rejects.toThrow(/not registered/);
  });

  it("enforces task completion email and artifact rules", async () => {
    const { service } = await createTestService();
    const { auth } = await bootstrapHost(service);

    await registerAgent(service, auth, {
      mailbox: "pm.aster@agents.local",
      name: "Aster",
      role: "pm",
      responsibilities: "PM agent."
    });
    await registerAgent(service, auth, {
      mailbox: "backend.coda@agents.local",
      name: "Coda",
      role: "backend",
      responsibilities: "Backend agent."
    });

    const delegationKey = await service.issueIdempotencyKey(auth, "pm.aster@agents.local", "send_email");
    const delegation = await service.sendEmail(auth, {
      idempotency_key: delegationKey.idempotency_key,
      mailbox: "pm.aster@agents.local",
      from: {
        display_name: "Aster",
        address: "pm.aster@agents.local"
      },
      to: [
        {
          display_name: "Coda",
          address: "backend.coda@agents.local"
        }
      ],
      cc: [],
      subject: "Implement backend change",
      body_text: "Please implement the backend change and reply in-thread.",
      raw_body: "Please implement the backend change and reply in-thread.",
      raw_headers: {
        from: "Aster <pm.aster@agents.local>",
        to: "Coda <backend.coda@agents.local>",
        cc: "",
        subject: "Implement backend change"
      },
      references: [],
      email_kind: "agent_delegation",
      linked_resources: []
    });

    const taskKey = await service.issueIdempotencyKey(auth, "pm.aster@agents.local", "create_task");
    const task = await service.createTask(auth, {
      idempotency_key: taskKey.idempotency_key,
      mailbox: "pm.aster@agents.local",
      thread_id: delegation.thread.thread_id,
      trigger_email_id: delegation.email.email_id,
      assignee_mailbox: "backend.coda@agents.local",
      title: "Implement backend change",
      instructions: "Make the requested repository change and report the file path.",
      parent_task_id: null,
      requires_artifact: true
    });

    await sleep(5);

    const completionKey = await service.issueIdempotencyKey(auth, "backend.coda@agents.local", "send_email");
    const completion = await service.sendEmail(auth, {
      idempotency_key: completionKey.idempotency_key,
      mailbox: "backend.coda@agents.local",
      from: {
        display_name: "Coda",
        address: "backend.coda@agents.local"
      },
      to: [
        {
          display_name: "Aster",
          address: "pm.aster@agents.local"
        }
      ],
      cc: [],
      subject: "Re: Implement backend change",
      body_text: "Implemented the change in docs/backend-runbook.md.",
      raw_body: "Implemented the change in docs/backend-runbook.md.",
      raw_headers: {
        from: "Coda <backend.coda@agents.local>",
        to: "Aster <pm.aster@agents.local>",
        cc: "",
        subject: "Re: Implement backend change"
      },
      in_reply_to: delegation.email.message_id,
      references: [delegation.email.message_id],
      email_kind: "agent_reply",
      linked_resources: []
    });

    await expect(
      service.updateTaskStatus(task.task_id, {
        mailbox: "backend.coda@agents.local",
        status: "done",
        completed_by_email_id: completion.email.email_id,
        artifacts: []
      })
    ).rejects.toThrow(/Artifacts are required/);

    const updated = await service.updateTaskStatus(task.task_id, {
      mailbox: "backend.coda@agents.local",
      status: "done",
      completed_by_email_id: completion.email.email_id,
      artifacts: [
        {
          repository: "xrdavies/agent-mail",
          path: "docs/backend-runbook.md",
          branch: "agent-mail/backend.coda/task_001",
          commit_sha: "abc123",
          pr_link: "https://github.com/xrdavies/agent-mail/pull/10"
        }
      ]
    });

    expect(updated.status).toBe("done");
    expect(updated.completed_by_email_id).toBe(completion.email.email_id);
  });
});

async function createTestService(): Promise<{
  service: CentralService;
}> {
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new PGlite();
  pools.push(client);
  for (const file of sqlFiles) {
    await client.exec(fs.readFileSync(path.join(drizzleDir, file), "utf8"));
  }

  const db = drizzle(client, { schema });
  const service = new CentralServiceImpl(db, new Set(["test-bootstrap-key"]));
  return { service };
}

async function bootstrapHost(service: CentralService): Promise<{
  auth: AuthenticatedHost;
}> {
  const exchange = await service.exchangeHostToken({
    host_id: "mac-local",
    label: "Mac Local",
    bootstrap_key: "test-bootstrap-key",
    host_version: "0.1.0"
  });
  const auth = await service.authenticate(exchange.host_token);
  await service.registerHost(auth, {
    host_id: "mac-local",
    label: "Mac Local",
    host_version: "0.1.0"
  });
  return { auth };
}

async function registerAgent(
  service: CentralService,
  auth: AuthenticatedHost,
  input: {
    mailbox: string;
    name: string;
    role: string;
    responsibilities: string;
  }
): Promise<void> {
  await service.registerAgent(auth, {
    host_id: "mac-local",
    mailbox: input.mailbox,
    name: input.name,
    role: input.role,
    responsibilities: input.responsibilities,
    workspace_path: `/tmp/${input.mailbox}`,
    git_user_name: input.name,
    git_user_email: input.mailbox
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
