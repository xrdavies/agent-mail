import { execFile, spawn } from "node:child_process";
import { readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalMailboxProfile {
  slug: string;
  mailbox: string;
  name: string;
  role: string;
  responsibilities: string;
  promptFile: string;
  branch: string;
  workspacePath: string;
}

export interface LocalRuntimeManifest {
  repoRoot: string;
  localDir: string;
  worktreeRoot: string;
  runtimeFile: string;
  logsDir: string;
  pidsDir: string;
  statePath: string;
  databaseUrl: string;
  centralBaseUrl: string;
  hostBaseUrl: string;
  hostMcpUrl: string;
  mailboxes: LocalMailboxProfile[];
}

export interface LocalProcessStatus {
  name: "central" | "host";
  pid: number | null;
  alive: boolean;
  healthUrl: string;
  healthy: boolean;
  logPath: string;
}

export interface LocalPostgresStatus {
  running: boolean;
  details: string;
}

export interface LocalMailboxStatus {
  mailbox: string;
  bootstrapped: boolean;
  bindingStatus: string;
  runtimeStatus: string;
  currentSessionId: string | null;
  lastProcessedDeliveryId: string | null;
  lastError: string | null;
  updatedAt: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "../..");
export const localDir = path.join(repoRoot, ".agent-mail", "local");
export const logsDir = path.join(localDir, "logs");
export const pidsDir = path.join(localDir, "pids");
export const runtimeFile = path.join(localDir, "runtime.json");
export const statePath = path.join(localDir, "host-state.sqlite");
export const bootstrapDir = path.join(localDir, "bootstrap");
export const smokeDir = path.join(localDir, "smoke");
export const worktreeRoot = path.resolve(repoRoot, "..", ".agent-mail-worktrees");
export const databaseUrl = "postgres://postgres:postgres@127.0.0.1:5432/agent_mail";
export const centralBaseUrl = "http://127.0.0.1:3000";
export const hostBaseUrl = "http://127.0.0.1:8788";
export const hostMcpUrl = `${hostBaseUrl}/mcp`;

export function getLocalMailboxProfiles(): LocalMailboxProfile[] {
  return [
    {
      slug: "aster",
      mailbox: "pm.aster@agents.local",
      name: "Aster",
      role: "pm",
      responsibilities:
        "PM agent responsible for intake, clarification, coordination, minimal delegation, and final synthesis back to the human.",
      promptFile: path.join(repoRoot, "PROMPT_ASTER.md"),
      branch: "agent-mail/pm-aster",
      workspacePath: path.join(worktreeRoot, "pm-aster")
    },
    {
      slug: "coda",
      mailbox: "backend.coda@agents.local",
      name: "Coda",
      role: "backend",
      responsibilities:
        "Backend agent responsible for backend analysis, backend implementation, and repository delivery when requested.",
      promptFile: path.join(repoRoot, "PROMPT_CODA.md"),
      branch: "agent-mail/backend-coda",
      workspacePath: path.join(worktreeRoot, "backend-coda")
    }
  ];
}

export function buildManifest(): LocalRuntimeManifest {
  return {
    repoRoot,
    localDir,
    worktreeRoot,
    runtimeFile,
    logsDir,
    pidsDir,
    statePath,
    databaseUrl,
    centralBaseUrl,
    hostBaseUrl,
    hostMcpUrl,
    mailboxes: getLocalMailboxProfiles()
  };
}

export async function ensureLocalDirs(): Promise<void> {
  await mkdir(localDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(pidsDir, { recursive: true });
  await mkdir(bootstrapDir, { recursive: true });
  await mkdir(smokeDir, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
}

export async function writeManifest(manifest: LocalRuntimeManifest): Promise<void> {
  await ensureLocalDirs();
  await writeFile(runtimeFile, JSON.stringify(manifest, null, 2));
}

export async function readManifest(): Promise<LocalRuntimeManifest> {
  return JSON.parse(await readFile(runtimeFile, "utf8")) as LocalRuntimeManifest;
}

export async function loadManifestOrDefault(): Promise<LocalRuntimeManifest> {
  if (await pathExists(runtimeFile)) {
    return readManifest();
  }
  return buildManifest();
}

export async function ensureWorktree(profile: LocalMailboxProfile): Promise<void> {
  const gitPath = path.join(profile.workspacePath, ".git");
  if (await pathExists(gitPath)) {
    await configureWorkspaceGit(profile);
    return;
  }

  if (await pathExists(profile.workspacePath)) {
    throw new Error(`Workspace path exists but is not a git worktree: ${profile.workspacePath}`);
  }

  await runCommand(
    "git",
    ["worktree", "add", "--force", "-B", profile.branch, profile.workspacePath, "HEAD"],
    { cwd: repoRoot }
  );
  await configureWorkspaceGit(profile);
}

export async function configureWorkspaceGit(profile: LocalMailboxProfile): Promise<void> {
  await runCommand("git", ["config", "user.name", profile.name], {
    cwd: profile.workspacePath
  });
  await runCommand("git", ["config", "user.email", profile.mailbox], {
    cwd: profile.workspacePath
  });
}

export function buildHostManagedMailboxesJson(manifest: LocalRuntimeManifest): string {
  return JSON.stringify(
    manifest.mailboxes.map((item) => ({
      mailbox: item.mailbox,
      workspacePath: item.workspacePath,
      gitUserName: item.name,
      gitUserEmail: item.mailbox,
      name: item.name,
      role: item.role,
      responsibilities: item.responsibilities
    }))
  );
}

export function getCentralEnv(manifest: LocalRuntimeManifest): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: manifest.databaseUrl,
    CENTRAL_HOST: "127.0.0.1",
    CENTRAL_PORT: "3000",
    CENTRAL_BOOTSTRAP_KEYS: "agent-mail-dev-bootstrap"
  };
}

export function getHostEnv(manifest: LocalRuntimeManifest): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CENTRAL_BASE_URL: manifest.centralBaseUrl,
    HOST_HOST: "127.0.0.1",
    HOST_PORT: "8788",
    HOST_PUBLIC_BASE_URL: manifest.hostBaseUrl,
    HOST_ID: "mac-local",
    HOST_LABEL: "Mac Local",
    HOST_VERSION: "0.1.0",
    HOST_BOOTSTRAP_KEY: "agent-mail-dev-bootstrap",
    HOST_STATE_PATH: manifest.statePath,
    HOST_HEARTBEAT_INTERVAL_MS: "5000",
    HOST_POLL_INTERVAL_MS: "10000",
    HOST_RESUME_MAX_FAILURES: "3",
    HOST_RESUME_BACKOFF_BASE_MS: "5000",
    HOST_RESUME_DANGEROUSLY_BYPASS: "true",
    HOST_MANAGED_MAILBOXES_JSON: buildHostManagedMailboxesJson(manifest)
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    allowFailure?: boolean;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      input: options.input,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: 0
    };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message: string;
    };
    if (options.allowFailure) {
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        exitCode: typeof failure.code === "number" ? failure.code : 1
      };
    }
    throw new Error(
      `${command} ${args.join(" ")} failed: ${failure.stderr ?? failure.message}`.trim()
    );
  }
}

export async function runStreamingCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? -1}`));
      }
    });
  });
}

export async function spawnManagedProcess(
  name: "central" | "host",
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number> {
  const logPath = path.join(logsDir, `${name}.log`);
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ["ignore", out, out]
  });
  child.unref();
  await writeFile(path.join(pidsDir, `${name}.pid`), String(child.pid));
  return child.pid ?? 0;
}

export async function stopManagedProcess(name: "central" | "host"): Promise<void> {
  const pidPath = path.join(pidsDir, `${name}.pid`);
  if (!(await pathExists(pidPath))) {
    return;
  }
  const pid = Number((await readFile(pidPath, "utf8")).trim());
  if (Number.isFinite(pid) && (await isPidAlive(pid))) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore stale pid.
    }
    await sleep(500);
    if (await isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore stale pid.
      }
    }
  }
  await rm(pidPath, { force: true });
}

export async function readManagedPid(name: "central" | "host"): Promise<number | null> {
  const pidPath = path.join(pidsDir, `${name}.pid`);
  if (!(await pathExists(pidPath))) {
    return null;
  }
  const raw = (await readFile(pidPath, "utf8")).trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForHttpOk(url: string, timeoutMs: number, label: string): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }, timeoutMs, 500, label);
}

export async function waitForPostgres(timeoutMs: number): Promise<void> {
  await waitFor(async () => {
    const result = await runCommand(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "postgres", "-d", "agent_mail"],
      { cwd: repoRoot, allowFailure: true }
    );
    return result.exitCode === 0;
  }, timeoutMs, 1000, "PostgreSQL readiness");
}

export async function getPostgresStatus(): Promise<LocalPostgresStatus> {
  const result = await runCommand(
    "docker",
    ["compose", "ps", "postgres", "--format", "json"],
    { cwd: repoRoot, allowFailure: true }
  );

  if (result.exitCode !== 0) {
    return {
      running: false,
      details: result.stderr.trim() || "docker compose ps failed"
    };
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      running: false,
      details: "postgres container not found"
    };
  }

  const parsed = JSON.parse(lines[0]!) as { State?: string; Status?: string };
  const running = parsed.State === "running";
  return {
    running,
    details: parsed.Status ?? parsed.State ?? "unknown"
  };
}

export async function resetDatabase(): Promise<void> {
  await runCommand(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'agent_mail' AND pid <> pg_backend_pid();"
    ],
    { cwd: repoRoot }
  );
  await runCommand(
    "docker",
    ["compose", "exec", "-T", "postgres", "dropdb", "-U", "postgres", "--if-exists", "agent_mail"],
    { cwd: repoRoot }
  );
  await runCommand(
    "docker",
    ["compose", "exec", "-T", "postgres", "createdb", "-U", "postgres", "agent_mail"],
    { cwd: repoRoot }
  );
}

export async function clearHostState(stateFilePath: string): Promise<void> {
  for (const suffix of ["", "-shm", "-wal"]) {
    await rm(`${stateFilePath}${suffix}`, { force: true });
  }
}

export async function tailFile(filePath: string, maxLines = 60): Promise<string> {
  if (!(await pathExists(filePath))) {
    return "";
  }
  const content = await readFile(filePath, "utf8");
  return content.split("\n").slice(-maxLines).join("\n");
}

export async function extractFirstCodeBlock(markdownPath: string): Promise<string> {
  const markdown = await readFile(markdownPath, "utf8");
  const match = markdown.match(/```(?:text)?\n([\s\S]*?)```/);
  if (!match?.[1]) {
    throw new Error(`No fenced code block found in ${markdownPath}`);
  }
  return match[1].trim();
}

export function renderWorkspaceAgentsFile(profile: LocalMailboxProfile): string {
  const roleSections = {
    pm: `## PM behavior rules
- Prefer answering directly when possible.
- Delegate only when another agent is clearly needed.
- Keep delegation minimal and specific.
- If broader coordination is not explicitly required, do not fan out unnecessarily.
- When sending the final human-facing synthesis after a specialist completes work, send it to the human without cc'ing the specialist unless further agent action is required.

## Repository rules
- PM should avoid direct repository changes unless the task explicitly requires PM-owned repository work.
- If repository work is needed outside PM scope, delegate it to the appropriate specialist.
- If repository output is expected, describe the expected output clearly in the delegation email.
- If PM must modify the repository, follow the Git workflow rules in this file.`,
    backend: `## Backend behavior rules
- Answer backend-specific questions directly.
- Produce repository changes only when the request explicitly requires implementation.
- Report concrete output paths when files are changed.
- Do not delegate by default.
- Only create further delegation if the current email explicitly requires another specialist.
- If you are only cc'ed on a final status-sync email and no new backend action is requested, mark it read and stop without replying.

## Repository rules
- If repository changes are required, perform the minimal necessary backend change.
- Verify the result before concluding the turn.
- If repository work was performed, follow the Git workflow rules in this file.
- Stop after the requested repository change and email reply are complete.`
  } as const;

  const mailSpecificLine =
    profile.role === "backend"
      ? "- If the email requests backend work, reply with concrete backend analysis or implementation results."
      : "- If delegation is needed, send the delegation email first and create the task second.";

  const taskSpecificLine =
    profile.role === "backend"
      ? "- Treat the incoming delegation email as the primary execution context.\n- Create tasks only when explicit tracking is needed and only through Host MCP."
      : "- Create tasks explicitly through Host MCP.\n- Create only the minimum necessary follow-up task.";

  const roleSection = roleSections[profile.role as keyof typeof roleSections];
  if (!roleSection) {
    throw new Error(`Unsupported bootstrap role: ${profile.role}`);
  }

  return `# AGENTS.md

## Identity
- name: ${profile.name}
- mailbox: ${profile.mailbox}
- role: ${profile.role}

## Responsibilities
${profile.responsibilities}

## Language
- Most Important: Always respond in Simplified Chinese unless the user explicitly asks for another language.

## Git workflow
- Git commit messages must follow Conventional Commits.
- After completing a coherent modification set, create a focused commit.
- After verification, push commits to the remote repository.

## Runtime rules
- Always operate as mailbox \`${profile.mailbox}\`.
- Work through Agent Mail using Host MCP only.
- Do not assume direct access to Central credentials.
- Do not process mail during first manual bootstrap; real mail handling starts only in resumed turns.
- Treat this \`AGENTS.md\` as the standing local rule file for identity, behavior, and workflow constraints.

## Mail handling rules
- Real mail handling begins only when Host resumes this mailbox for unread work.
- In each resumed turn, process exactly one unread delivery unless explicitly instructed otherwise.
- Always prefer the oldest unread delivery first.
- Read the target email before marking it read.
- Mark a delivery read only through MCP.
- If no task is needed, still send a receipt or direct reply.
${mailSpecificLine}
- Keep meaningful progress visible through email replies.

## Task rules
${taskSpecificLine}
- Do not create duplicate tasks.
- If a task is completed, send the completion email first and update task status second using \`completedByEmailId\`.
- Do not mark a task done without a reply email.

${roleSection}
`;
}

export function buildCodexMcpConfigArgs(mcpUrl: string): string[] {
  return [
    "-c",
    `mcp_servers.agent-mail-host.url="${mcpUrl}"`,
    "-c",
    "mcp_servers.nowledge-mem.enabled=false"
  ];
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readBootstrapFlag(stateFilePath: string, mailbox: string): Promise<boolean> {
  if (!(await pathExists(stateFilePath))) {
    return false;
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(stateFilePath);
  try {
    const row = db
      .prepare("SELECT bootstrapped FROM mailbox_state WHERE mailbox = ?")
      .get(mailbox) as { bootstrapped?: number } | undefined;
    return row?.bootstrapped === 1;
  } finally {
    db.close();
  }
}

export async function readMailboxStatuses(stateFilePath: string): Promise<LocalMailboxStatus[]> {
  if (!(await pathExists(stateFilePath))) {
    return [];
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(stateFilePath);
  try {
    const rows = db
      .prepare(
        `
          SELECT mailbox, bootstrapped, binding_status, runtime_status, current_session_id,
                 last_processed_delivery_id, last_error, updated_at
          FROM mailbox_state
          ORDER BY mailbox ASC
        `
      )
      .all() as Array<{
      mailbox: string;
      bootstrapped: number;
      binding_status: string;
      runtime_status: string;
      current_session_id: string | null;
      last_processed_delivery_id: string | null;
      last_error: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      mailbox: row.mailbox,
      bootstrapped: row.bootstrapped === 1,
      bindingStatus: row.binding_status,
      runtimeStatus: row.runtime_status,
      currentSessionId: row.current_session_id,
      lastProcessedDeliveryId: row.last_processed_delivery_id,
      lastError: row.last_error,
      updatedAt: row.updated_at
    }));
  } finally {
    db.close();
  }
}

export async function getProcessStatus(
  name: "central" | "host",
  manifest: LocalRuntimeManifest
): Promise<LocalProcessStatus> {
  const pid = await readManagedPid(name);
  const alive = pid !== null ? await isPidAlive(pid) : false;
  const healthUrl =
    name === "central"
      ? `${manifest.centralBaseUrl}/api/v1/health`
      : `${manifest.hostBaseUrl}/health`;
  let healthy = false;
  try {
    const response = await fetch(healthUrl);
    healthy = response.ok;
  } catch {
    healthy = false;
  }
  return {
    name,
    pid,
    alive,
    healthUrl,
    healthy,
    logPath: path.join(logsDir, `${name}.log`)
  };
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export function uniqueTempFile(prefix: string, extension: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
}
