import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import { createDatabase, createPool } from "../apps/central/src/db/client.js";
import { CentralService } from "../apps/central/src/service.js";
import {
  readManifest,
  sleep,
  tailFile,
  waitForHttpOk
} from "./lib/local-stack.js";

async function main(): Promise<void> {
  const manifest = await readManifest();
  await waitForHttpOk(`${manifest.centralBaseUrl}/api/v1/health`, 10_000, "Central health");
  await waitForHttpOk(`${manifest.hostBaseUrl}/health`, 10_000, "Host health");

  const pool = createPool(manifest.databaseUrl);
  const db = createDatabase(pool);
  const service = new CentralService(db, new Set(["agent-mail-dev-bootstrap"]));

  try {
    const artifactPath = `docs/smoke-output-${Date.now()}.md`;
    const root = await service.ingestHumanEmail({
      from: {
        display_name: "Human Operator",
        address: "human@example.com"
      },
      to: [
        {
          display_name: "Aster",
          address: "pm.aster@agents.local"
        }
      ],
      cc: [],
      subject: "Smoke test: backend delegation required",
      body_text: [
        "Please coordinate this smoke test.",
        "Do not edit the repository yourself.",
        "Delegate exactly one task to backend.coda@agents.local.",
        "That backend task must require an artifact.",
        `Ask backend.coda@agents.local to create ${artifactPath} with exact content: smoke ok`,
        "After backend completes, send me a final summary reply in the same thread."
      ].join("\n"),
      raw_body: [
        "Please coordinate this smoke test.",
        "Do not edit the repository yourself.",
        "Delegate exactly one task to backend.coda@agents.local.",
        "That backend task must require an artifact.",
        `Ask backend.coda@agents.local to create ${artifactPath} with exact content: smoke ok`,
        "After backend completes, send me a final summary reply in the same thread."
      ].join("\n"),
      raw_headers: {
        from: "Human Operator <human@example.com>",
        to: "Aster <pm.aster@agents.local>",
        cc: "",
        subject: "Smoke test: backend delegation required"
      },
      references: [],
      linked_resources: []
    });

    console.log(`Seeded human inbound thread ${root.thread.thread_id}`);

    const result = await waitForSmokeCompletion(
      service,
      manifest,
      root.thread.thread_id,
      artifactPath,
      8 * 60_000
    );

    console.log("Smoke test passed.");
    console.log(`Thread: ${result.thread.thread.thread_id}`);
    console.log(`Emails: ${result.thread.emails.length}`);
    console.log(`Tasks: ${result.thread.tasks.length}`);
    for (const task of result.thread.tasks) {
      console.log(`Task ${task.task_id}: ${task.status} -> ${task.assignee_mailbox}`);
    }
    console.log(`Artifact file: ${path.join(manifest.mailboxes[1]!.workspacePath, artifactPath)}`);
  } catch (error) {
    const centralLog = await tailFile(path.join(manifest.logsDir, "central.log"));
    const hostLog = await tailFile(path.join(manifest.logsDir, "host.log"));
    console.error(error instanceof Error ? error.message : String(error));
    console.error("\nHost log tail:\n" + hostLog);
    console.error("\nCentral log tail:\n" + centralLog);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function waitForSmokeCompletion(
  service: CentralService,
  manifest: Awaited<ReturnType<typeof readManifest>>,
  threadId: string,
  artifactPath: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  const codaWorkspace = manifest.mailboxes.find((item) => item.slug === "coda");
  if (!codaWorkspace) {
    throw new Error("Missing Coda workspace in manifest");
  }
  const expectedFile = path.join(codaWorkspace.workspacePath, artifactPath);

  while (Date.now() < deadline) {
    const thread = await service.getThread(threadId);
    const asterUnread = await service.listDeliveries("pm.aster@agents.local", {
      readStatus: "unread",
      order: "oldest_first",
      limit: 20
    });
    const codaUnread = await service.listDeliveries("backend.coda@agents.local", {
      readStatus: "unread",
      order: "oldest_first",
      limit: 20
    });
    const taskDone =
      thread.tasks.length > 0 && thread.tasks.every((task) => task.status === "done");
    const latestEmail = thread.emails.at(-1);
    const asterRepliedToHuman =
      latestEmail?.from.address === "pm.aster@agents.local" &&
      latestEmail.to.some((item) => item.address === "human@example.com");
    const artifactExists = await fileExists(expectedFile);
    const artifactContent = artifactExists ? await readFile(expectedFile, "utf8") : null;
    const artifactOk = artifactContent?.trim() === "smoke ok";

    if (
      taskDone &&
      asterRepliedToHuman &&
      asterUnread.length === 0 &&
      codaUnread.length === 0 &&
      artifactOk
    ) {
      return { thread };
    }

    await sleep(5_000);
  }

  throw new Error(`Timed out waiting for smoke flow to complete on thread ${threadId}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

void main();
