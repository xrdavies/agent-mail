import path from "node:path";

import {
  buildManifest,
  clearHostState,
  ensureLocalDirs,
  ensureWorktree,
  formatCommand,
  getCentralEnv,
  getHostEnv,
  readManifest,
  resetDatabase,
  runCommand,
  spawnManagedProcess,
  stopManagedProcess,
  tailFile,
  waitForHttpOk,
  waitForPostgres,
  writeManifest
} from "./lib/local-stack.js";

const args = new Set(process.argv.slice(2));
const fresh = args.has("--fresh");

async function main(): Promise<void> {
  const manifest = buildManifest();
  await ensureLocalDirs();
  for (const mailbox of manifest.mailboxes) {
    await ensureWorktree(mailbox);
  }
  await writeManifest(manifest);

  await stopManagedProcess("host");
  await stopManagedProcess("central");

  await runCommand("docker", ["compose", "up", "-d", "postgres"], {
    cwd: manifest.repoRoot
  });
  await waitForPostgres(60_000);

  if (fresh) {
    await resetDatabase();
    await clearHostState(manifest.statePath);
    await runCommand("git", ["worktree", "list"], { cwd: manifest.repoRoot });
  }

  await runCommand("pnpm", ["build"], { cwd: manifest.repoRoot });
  await runCommand("pnpm", ["db:migrate"], {
    cwd: manifest.repoRoot,
    env: getCentralEnv(manifest)
  });

  const centralPid = await spawnManagedProcess(
    "central",
    [path.join("apps", "central", "dist", "src", "index.js")],
    getCentralEnv(manifest)
  );
  try {
    await waitForHttpOk(`${manifest.centralBaseUrl}/api/v1/health`, 30_000, "Central health");
  } catch (error) {
    const logTail = await tailFile(path.join(manifest.logsDir, "central.log"));
    throw new Error(`${String(error)}\n\nCentral log tail:\n${logTail}`);
  }

  const hostPid = await spawnManagedProcess(
    "host",
    [path.join("apps", "host", "dist", "src", "index.js")],
    getHostEnv(manifest)
  );
  try {
    await waitForHttpOk(`${manifest.hostBaseUrl}/health`, 30_000, "Host health");
  } catch (error) {
    const logTail = await tailFile(path.join(manifest.logsDir, "host.log"));
    throw new Error(`${String(error)}\n\nHost log tail:\n${logTail}`);
  }

  console.log("Agent Mail local stack started.");
  console.log(`Central: ${manifest.centralBaseUrl} (pid ${centralPid})`);
  console.log(`Host:    ${manifest.hostBaseUrl} (pid ${hostPid})`);
  console.log(`MCP:     ${manifest.hostMcpUrl}`);
  for (const mailbox of manifest.mailboxes) {
    console.log(`Workspace ${mailbox.mailbox}: ${mailbox.workspacePath}`);
  }
  console.log(`Logs: ${manifest.logsDir}`);
  console.log(`Run bootstrap next: pnpm local:bootstrap`);
  if (fresh) {
    console.log("Started with --fresh: database and host state were reset.");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  void (async () => {
    const manifest = await readManifest().catch(() => null);
    if (manifest) {
      console.error(`Central log: ${formatCommand("tail", ["-n", "80", path.join(manifest.logsDir, "central.log")])}`);
      console.error(`Host log: ${formatCommand("tail", ["-n", "80", path.join(manifest.logsDir, "host.log")])}`);
    }
    process.exitCode = 1;
  })();
});
