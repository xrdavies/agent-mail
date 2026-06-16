import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { CentralConfig } from "../src/config.js";
import { CentralLogger } from "../src/lib/logger.js";
import type { AuthenticatedHost, CentralService } from "../src/service.js";
import * as schema from "../src/db/schema.js";
import { CentralService as CentralServiceImpl } from "../src/service.js";

const pools: Array<{ close(): Promise<void> | void }> = [];
const testDir = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(testDir, "../drizzle");

const testConfig: CentralConfig = {
  port: 3000,
  host: "127.0.0.1",
  databaseUrl: "postgres://ignored",
  bootstrapKeys: ["test-bootstrap-key"]
};

afterEach(async () => {
  while (pools.length > 0) {
    const pool = pools.pop();
    await pool?.close();
  }
});

describe("Central web read-model routes", () => {
  it("serves hosts, mailbox summaries, overview, and web task routes without host auth", async () => {
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

    await service.heartbeat(auth, "mac-local", {
      host_status: "online",
      managed_mailboxes: [
        {
          mailbox: "pm.aster@agents.local",
          binding_status: "active",
          mailbox_runtime_status: "idle",
          workspace_path: "/tmp/pm.aster@agents.local"
        },
        {
          mailbox: "backend.coda@agents.local",
          binding_status: "active",
          mailbox_runtime_status: "running",
          workspace_path: "/tmp/backend.coda@agents.local",
          active_task_id: null
        }
      ]
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
      subject: "Need API follow-up",
      body_text: "Please review backend requirements.",
      raw_body: "Please review backend requirements.",
      raw_headers: {
        from: "Aster <pm.aster@agents.local>",
        to: "Coda <backend.coda@agents.local>",
        cc: "",
        subject: "Need API follow-up"
      },
      references: [],
      email_kind: "agent_delegation",
      linked_resources: []
    });

    const taskKey = await service.issueIdempotencyKey(auth, "pm.aster@agents.local", "create_task");
    const task = await service.createTask(auth, {
      idempotency_key: taskKey.idempotency_key,
      mailbox: "pm.aster@agents.local",
      thread_id: sent.thread.thread_id,
      trigger_email_id: sent.email.email_id,
      assignee_mailbox: "backend.coda@agents.local",
      title: "Review backend requirements",
      instructions: "Summarize backend constraints and reply in-thread.",
      parent_task_id: null,
      requires_artifact: false
    });

    const logger = new CentralLogger(50);
    const { app } = createApp(testConfig, { service, logger, pool: null });

    const hostsResponse = await app.request("http://localhost/api/v1/hosts");
    expect(hostsResponse.status).toBe(200);
    const hostsPayload = await hostsResponse.json();
    expect(hostsPayload.hosts).toHaveLength(1);
    expect(hostsPayload.hosts[0]?.managed_mailboxes).toBe(2);

    const mailboxesResponse = await app.request("http://localhost/api/v1/web/mailboxes");
    expect(mailboxesResponse.status).toBe(200);
    const mailboxesPayload = await mailboxesResponse.json();
    expect(mailboxesPayload.mailboxes).toHaveLength(2);
    expect(
      mailboxesPayload.mailboxes.find(
        (item: { profile: { mailbox: string }; unread_deliveries: number }) =>
          item.profile.mailbox === "backend.coda@agents.local"
      )?.unread_deliveries
    ).toBe(1);

    const overviewResponse = await app.request("http://localhost/api/v1/web/overview");
    expect(overviewResponse.status).toBe(200);
    const overviewPayload = await overviewResponse.json();
    expect(overviewPayload.counters.unread_deliveries).toBe(1);
    expect(overviewPayload.oldest_unread).toHaveLength(1);
    expect(overviewPayload.host_health).toHaveLength(1);

    const webThreadsResponse = await app.request("http://localhost/api/v1/web/threads?limit=10");
    expect(webThreadsResponse.status).toBe(200);
    const webThreadsPayload = await webThreadsResponse.json();
    expect(webThreadsPayload.threads).toHaveLength(1);
    expect(webThreadsPayload.threads[0]?.thread.thread_id).toBe(sent.thread.thread_id);
    expect(webThreadsPayload.threads[0]?.latest_email.email_id).toBe(sent.email.email_id);
    expect(webThreadsPayload.threads[0]?.open_task_count).toBe(1);

    const webEmailsResponse = await app.request(
      "http://localhost/api/v1/web/emails?mailbox=pm.aster@agents.local&limit=10"
    );
    expect(webEmailsResponse.status).toBe(200);
    const webEmailsPayload = await webEmailsResponse.json();
    expect(webEmailsPayload.emails).toHaveLength(1);
    expect(webEmailsPayload.emails[0]?.email.email_id).toBe(sent.email.email_id);
    expect(webEmailsPayload.emails[0]?.direction).toBe("sent");
    expect(webEmailsPayload.emails[0]?.counterparty).toBe("backend.coda@agents.local");

    const webThreadResponse = await app.request(
      `http://localhost/api/v1/web/threads/${sent.thread.thread_id}`
    );
    expect(webThreadResponse.status).toBe(200);
    const webThreadPayload = await webThreadResponse.json();
    expect(webThreadPayload.thread.thread_id).toBe(sent.thread.thread_id);
    expect(webThreadPayload.emails).toHaveLength(1);

    const webEmailResponse = await app.request(
      `http://localhost/api/v1/web/emails/${sent.email.email_id}`
    );
    expect(webEmailResponse.status).toBe(200);
    const webEmailPayload = await webEmailResponse.json();
    expect(webEmailPayload.email_id).toBe(sent.email.email_id);

    const webTasksResponse = await app.request(
      "http://localhost/api/v1/web/tasks?status=new&limit=10"
    );
    expect(webTasksResponse.status).toBe(200);
    const webTasksPayload = await webTasksResponse.json();
    expect(webTasksPayload.tasks).toHaveLength(1);
    expect(webTasksPayload.tasks[0]?.task.task_id).toBe(task.task_id);
    expect(webTasksPayload.tasks[0]?.thread.thread_id).toBe(sent.thread.thread_id);
    expect(webTasksPayload.tasks[0]?.trigger_email.email_id).toBe(sent.email.email_id);
    expect(webTasksPayload.tasks[0]?.artifact_count).toBe(0);

    const webTaskResponse = await app.request(
      `http://localhost/api/v1/web/tasks/${task.task_id}`
    );
    expect(webTaskResponse.status).toBe(200);
    const webTaskPayload = await webTaskResponse.json();
    expect(webTaskPayload.task.task_id).toBe(task.task_id);
    expect(webTaskPayload.thread.thread_id).toBe(sent.thread.thread_id);
    expect(webTaskPayload.trigger_email.email_id).toBe(sent.email.email_id);
    expect(webTaskPayload.artifacts).toHaveLength(0);
  });

  it("accepts operator compose writes via human-send without host auth", async () => {
    const { service } = await createTestService();
    const { auth } = await bootstrapHost(service);

    await registerAgent(service, auth, {
      mailbox: "pm.aster@agents.local",
      name: "Aster",
      role: "pm",
      responsibilities: "PM agent."
    });

    const logger = new CentralLogger(50);
    const { app } = createApp(testConfig, { service, logger, pool: null });

    const response = await app.request("http://localhost/api/v1/web/emails/human-send", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: {
          display_name: "Human Operator",
          address: "human.operator@example.com"
        },
        to: [
          {
            display_name: "Aster",
            address: "pm.aster@agents.local"
          }
        ],
        cc: [],
        subject: "Need API follow-up",
        body_text: "Please review the backend constraints."
      })
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.email.email_kind).toBe("human_inbound");
    expect(payload.email.created_by_host_id).toBeNull();
    expect(payload.email.created_by_mailbox).toBeNull();
    expect(payload.email.raw_body).toBe("Please review the backend constraints.");
    expect(payload.email.raw_headers.from).toBe("Human Operator <human.operator@example.com>");
    expect(payload.email.raw_headers.to).toBe("Aster <pm.aster@agents.local>");
    expect(payload.deliveries).toHaveLength(1);
    expect(payload.thread.root_subject).toBe("Need API follow-up");
  });

  it("releases the current host mailbox binding via authenticated host route", async () => {
    const { service } = await createTestService();
    const { auth, hostToken } = await bootstrapHost(service);

    await registerAgent(service, auth, {
      mailbox: "backend.coda@agents.local",
      name: "Coda",
      role: "backend",
      responsibilities: "Backend agent."
    });

    await service.heartbeat(auth, "mac-local", {
      host_status: "online",
      managed_mailboxes: [
        {
          mailbox: "backend.coda@agents.local",
          binding_status: "active",
          mailbox_runtime_status: "idle",
          workspace_path: "/tmp/backend.coda@agents.local"
        }
      ]
    });

    const logger = new CentralLogger(50);
    const { app } = createApp(testConfig, { service, logger, pool: null });

    const response = await app.request(
      "http://localhost/api/v1/hosts/mac-local/mailboxes/backend.coda%40agents.local/binding",
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${hostToken}`
        }
      }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.binding_status).toBe("inactive");

    const snapshot = await service.getRuntimeSnapshot("mac-local");
    expect(
      snapshot.bindings.find((binding) => binding.mailbox === "backend.coda@agents.local")?.binding_status
    ).toBe("inactive");
    expect(snapshot.runtimes).toHaveLength(0);
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
  hostToken: string;
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
  return {
    auth,
    hostToken: exchange.host_token
  };
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
