import {
  getPostgresStatus,
  getProcessStatus,
  loadManifestOrDefault,
  readMailboxStatuses
} from "./lib/local-stack.js";

async function main(): Promise<void> {
  const manifest = await loadManifestOrDefault();
  const postgres = await getPostgresStatus();
  const central = await getProcessStatus("central", manifest);
  const host = await getProcessStatus("host", manifest);
  const mailboxes = await readMailboxStatuses(manifest.statePath);

  console.log("Agent Mail Local Status");
  console.log(`Repo: ${manifest.repoRoot}`);
  console.log(`Manifest: ${manifest.runtimeFile}`);
  console.log(`Postgres: ${postgres.running ? "running" : "stopped"} (${postgres.details})`);
  console.log(
    `Central: ${formatProcess(central)} | health ${central.healthy ? "ok" : "down"} | ${central.healthUrl}`
  );
  console.log(
    `Host: ${formatProcess(host)} | health ${host.healthy ? "ok" : "down"} | ${host.healthUrl}`
  );
  console.log(`Logs: ${manifest.logsDir}`);

  if (mailboxes.length === 0) {
    console.log("Mailboxes: no local host state yet");
    return;
  }

  console.log("Mailboxes:");
  for (const mailbox of mailboxes) {
    const parts = [
      mailbox.mailbox,
      `bootstrapped=${mailbox.bootstrapped}`,
      `binding=${mailbox.bindingStatus}`,
      `runtime=${mailbox.runtimeStatus}`
    ];
    if (mailbox.currentSessionId) {
      parts.push(`session=${mailbox.currentSessionId}`);
    }
    if (mailbox.lastProcessedDeliveryId) {
      parts.push(`last_delivery=${mailbox.lastProcessedDeliveryId}`);
    }
    if (mailbox.lastError) {
      parts.push(`last_error=${mailbox.lastError}`);
    }
    parts.push(`updated=${mailbox.updatedAt}`);
    console.log(`- ${parts.join(" | ")}`);
  }
}

function formatProcess(processStatus: Awaited<ReturnType<typeof getProcessStatus>>): string {
  if (processStatus.pid === null) {
    return "not started";
  }
  return `${processStatus.alive ? "running" : "stale"} pid=${processStatus.pid}`;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
