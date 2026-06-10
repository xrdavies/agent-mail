#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, closeSync, openSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const stateDir = resolve(repoRoot, ".agent-mail", "local-stack");
const logsDir = join(stateDir, "logs");
const statePath = join(stateDir, "state.json");
const defaultHostConfigPath = resolve(repoRoot, "apps/host/host.local.toml");
const defaultHostExamplePath = resolve(repoRoot, "apps/host/host.example.toml");
const defaultHostStatePath = resolve(repoRoot, ".agent-mail", "host-state.local.json");
const defaultPmWorktreePath = resolve(repoRoot, ".agent-mail", "worktrees", "pm-aster");
const defaultBackendWorktreePath = resolve(
  repoRoot,
  ".agent-mail",
  "worktrees",
  "backend-coda"
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (message) => {
  console.log(`[local-stack] ${message}`);
};

const fail = (message) => {
  throw new Error(message);
};

const parseArgs = () => {
  const [, , command = "status", ...rest] = process.argv;

  return {
    command,
    flags: new Set(rest)
  };
};

const runtime = () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/agent_mail_local";
  const database = new URL(databaseUrl);
  const databaseName = database.pathname.replace(/^\//, "");

  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    fail(
      `Unsupported local database name "${databaseName}". Use DATABASE_URL with an alphanumeric/underscore database name.`
    );
  }

  const centralPort = Number(process.env.AGENT_MAIL_CENTRAL_PORT ?? "3000");
  const hostPort = Number(process.env.AGENT_MAIL_HOST_PORT ?? "8788");
  const webPort = Number(process.env.AGENT_MAIL_WEB_PORT ?? "5173");
  const hostConfigPath = resolve(
    repoRoot,
    process.env.AGENT_MAIL_HOST_CONFIG ?? defaultHostConfigPath
  );
  const hostStatePath = resolve(
    repoRoot,
    process.env.AGENT_MAIL_HOST_STATE ?? defaultHostStatePath
  );
  const centralBaseUrl = `http://localhost:${centralPort}`;
  const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
  const webBaseUrl = `http://localhost:${webPort}`;

  return {
    databaseUrl,
    databaseName,
    centralPort,
    hostPort,
    webPort,
    hostConfigPath,
    hostStatePath,
    centralBaseUrl,
    hostBaseUrl,
    webBaseUrl
  };
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `Command failed: ${command} ${args.join(" ")}\n${stderr || stdout || `exit ${code}`}`
          )
        );
        return;
      }

      resolvePromise({
        stdout,
        stderr
      });
    });
  });

const startDetachedProcess = async ({ name, command, args, env, logPath }) => {
  await mkdir(logsDir, { recursive: true });
  const fd = openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    detached: true,
    stdio: ["ignore", fd, fd]
  });
  closeSync(fd);
  child.unref();

  return {
    name,
    pid: child.pid,
    logPath
  };
};

const isPidRunning = (pid) => {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stopPid = async (pid) => {
  if (!isPidRunning(pid)) {
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPidRunning(pid)) {
      return;
    }

    await sleep(250);
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    return;
  }
};

const httpRequest = (url) =>
  new Promise((resolvePromise, rejectPromise) => {
    const request = http.get(
      url,
      {
        timeout: 3000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolvePromise({
            statusCode: response.statusCode ?? 0,
            body
          });
        });
      }
    );

    request.on("error", rejectPromise);
    request.on("timeout", () => {
      request.destroy(new Error(`Request timed out for ${url}`));
    });
  });

const waitFor = async (label, fn, timeoutMs = 60000, intervalMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  fail(lastError ? `${label} timed out: ${lastError.message}` : `${label} timed out.`);
};

const readState = async () => {
  if (!existsSync(statePath)) {
    return null;
  }

  const raw = await readFile(statePath, "utf8");
  return JSON.parse(raw);
};

const writeState = async (state) => {
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const removeState = async () => {
  await rm(statePath, { force: true });
};

const gitBranchExists = async (branchName) => {
  try {
    await runCommand("git", ["rev-parse", "--verify", branchName]);
    return true;
  } catch {
    return false;
  }
};

const ensureWorktree = async (worktreePath, branchName) => {
  if (existsSync(worktreePath)) {
    log(`worktree ready: ${worktreePath}`);
    return;
  }

  await mkdir(resolve(worktreePath, ".."), { recursive: true });

  if (await gitBranchExists(branchName)) {
    await runCommand("git", ["worktree", "add", worktreePath, branchName]);
  } else {
    await runCommand("git", ["worktree", "add", worktreePath, "-b", branchName, "HEAD"]);
  }

  log(`created worktree: ${worktreePath}`);
};

const renderDefaultHostConfig = () => `machine_id = "mac-local"
label = "Mac Local"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "${defaultPmWorktreePath}"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "backend.coda@agents.local"
name = "Coda"
role = "backend"
workspace_path = "${defaultBackendWorktreePath}"
git_user_name = "Coda"
git_user_email = "backend.coda@agents.local"
`;

const ensureHostConfig = async (hostConfigPath) => {
  if (!existsSync(hostConfigPath)) {
    if (hostConfigPath !== defaultHostConfigPath) {
      fail(`Host config not found: ${hostConfigPath}`);
    }

    await mkdir(resolve(hostConfigPath, ".."), { recursive: true });

    if (existsSync(defaultHostExamplePath)) {
      await copyFile(defaultHostExamplePath, hostConfigPath);
      let content = await readFile(hostConfigPath, "utf8");
      content = content.replace(
        /\/absolute\/path\/to\/pm-worktree/g,
        defaultPmWorktreePath
      );
      content = content.replace(
        /\/absolute\/path\/to\/backend-worktree/g,
        defaultBackendWorktreePath
      );
      content = content.replace(/machine_id = "mac-b"/, 'machine_id = "mac-local"');
      content = content.replace(/label = "Mac B"/, 'label = "Mac Local"');
      await writeFile(hostConfigPath, content, "utf8");
    } else {
      await writeFile(hostConfigPath, renderDefaultHostConfig(), "utf8");
    }

    log(`created host config: ${hostConfigPath}`);
    return;
  }

  let content = await readFile(hostConfigPath, "utf8");
  const updated = content
    .replace(/\/absolute\/path\/to\/pm-worktree/g, defaultPmWorktreePath)
    .replace(/\/absolute\/path\/to\/backend-worktree/g, defaultBackendWorktreePath);

  if (updated !== content) {
    await writeFile(hostConfigPath, updated, "utf8");
    log(`updated placeholder workspace paths in: ${hostConfigPath}`);
  }
};

const parseMailboxConfigs = (hostConfigText) =>
  hostConfigText
    .split(/\[\[mailboxes\]\]/g)
    .slice(1)
    .map((block) => {
      const mailbox = block.match(/mailbox\s*=\s*"([^"]+)"/)?.[1] ?? null;
      const workspacePath = block.match(/workspace_path\s*=\s*"([^"]+)"/)?.[1] ?? null;
      return {
        mailbox,
        workspacePath
      };
    })
    .filter((entry) => entry.mailbox && entry.workspacePath);

const validateHostConfig = async (hostConfigPath) => {
  if (!existsSync(hostConfigPath)) {
    fail(`Host config not found: ${hostConfigPath}`);
  }

  const hostConfigText = await readFile(hostConfigPath, "utf8");
  const mailboxes = parseMailboxConfigs(hostConfigText);

  if (mailboxes.length === 0) {
    fail(`No [[mailboxes]] entries found in ${hostConfigPath}`);
  }

  for (const mailbox of mailboxes) {
    if (!mailbox.workspacePath || !existsSync(mailbox.workspacePath)) {
      fail(
        `Workspace path missing for ${mailbox.mailbox}: ${mailbox.workspacePath ?? "<unset>"}`
      );
    }

    if (!existsSync(resolve(mailbox.workspacePath, ".git"))) {
      fail(`Workspace is not a git checkout for ${mailbox.mailbox}: ${mailbox.workspacePath}`);
    }
  }

  return mailboxes;
};

const bootstrap = async (context) => {
  await mkdir(resolve(repoRoot, ".agent-mail"), { recursive: true });
  await ensureWorktree(defaultPmWorktreePath, "agent-mail/local-pm");
  await ensureWorktree(defaultBackendWorktreePath, "agent-mail/local-backend");
  await ensureHostConfig(context.hostConfigPath);
  const mailboxes = await validateHostConfig(context.hostConfigPath);

  log(`host config ready: ${context.hostConfigPath}`);
  log(`mailboxes: ${mailboxes.map((entry) => entry.mailbox).join(", ")}`);
};

const ensureLocalDatabase = async (context, { fresh }) => {
  await runCommand("docker", ["compose", "up", "-d", "postgres"]);

  const queryResult = await runCommand("docker", [
    "exec",
    "agent-mail-postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${context.databaseName}'`
  ]);

  const exists = queryResult.stdout.trim() === "1";

  if (fresh && exists) {
    await runCommand("docker", [
      "exec",
      "agent-mail-postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${context.databaseName}' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS ${context.databaseName}; CREATE DATABASE ${context.databaseName};`
    ]);
    log(`recreated database: ${context.databaseName}`);
    return;
  }

  if (!exists) {
    await runCommand("docker", [
      "exec",
      "agent-mail-postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      `CREATE DATABASE ${context.databaseName}`
    ]);
    log(`created database: ${context.databaseName}`);
  } else {
    log(`database ready: ${context.databaseName}`);
  }
};

const migrateDatabase = async (context) => {
  await runCommand("pnpm", ["db:migrate"], {
    env: {
      DATABASE_URL: context.databaseUrl
    }
  });
  log("migrations applied");
};

const serviceDefinitions = (context) => ({
  central: {
    url: context.centralBaseUrl,
    logPath: join(logsDir, "central.log"),
    command: "pnpm",
    args: ["dev:central"],
    env: {
      DATABASE_URL: context.databaseUrl,
      PORT: String(context.centralPort)
    }
  },
  host: {
    url: context.hostBaseUrl,
    logPath: join(logsDir, "host.log"),
    command: "pnpm",
    args: ["dev:host"],
    env: {
      CENTRAL_BASE_URL: context.centralBaseUrl,
      HOST_CONFIG_PATH: context.hostConfigPath,
      HOST_STATE_PATH: context.hostStatePath,
      HOST_PORT: String(context.hostPort),
      HOST_BASE_URL: context.hostBaseUrl
    }
  },
  web: {
    url: context.webBaseUrl,
    logPath: join(logsDir, "web.log"),
    command: "pnpm",
    args: ["dev:web"],
    env: {
      VITE_PROXY_TARGET: context.centralBaseUrl
    }
  }
});

const waitForStackReady = async (context) => {
  await waitFor("central health", async () => {
    const response = await httpRequest(`${context.centralBaseUrl}/api/v1/health`);
    return response.statusCode === 200 && response.body.includes('"ok":true');
  });

  await waitFor("host health", async () => {
    const response = await httpRequest(`${context.hostBaseUrl}/health`);
    return response.statusCode === 200 && response.body.includes('"ok":true');
  });

  await waitFor("web root", async () => {
    const response = await httpRequest(`${context.webBaseUrl}/`);
    return response.statusCode === 200 && response.body.includes("<div id=\"root\"></div>");
  });
};

const stopManagedProcesses = async () => {
  const state = await readState();

  if (!state) {
    return false;
  }

  const services = ["web", "host", "central"];

  for (const serviceName of services) {
    const service = state.services?.[serviceName];
    if (service?.pid) {
      await stopPid(service.pid);
    }
  }

  await removeState();

  try {
    await runCommand("docker", ["compose", "stop", "postgres"]);
  } catch {
    // ignore docker stop failures for local cleanup
  }

  return true;
};

const printStatus = async (context) => {
  const state = await readState();
  const services = serviceDefinitions(context);

  if (!state) {
    console.log("Local stack is not managed by scripts yet.");
    console.log("Use: pnpm local:start");
    return;
  }

  const rows = [];

  for (const [name, definition] of Object.entries(services)) {
    const pid = state.services?.[name]?.pid ?? null;
    const running = isPidRunning(pid);
    let reachable = false;

    try {
      const path =
        name === "central"
          ? "/api/v1/health"
          : name === "host"
            ? "/health"
            : "/";
      const response = await httpRequest(`${definition.url}${path}`);
      reachable = response.statusCode === 200;
    } catch {
      reachable = false;
    }

    rows.push({
      name,
      pid,
      running,
      reachable,
      url: definition.url,
      logPath: state.services?.[name]?.logPath ?? definition.logPath
    });
  }

  console.table(rows);
  console.log(`database: ${context.databaseUrl}`);
  console.log(`host config: ${context.hostConfigPath}`);
  console.log(`host state: ${context.hostStatePath}`);
};

const start = async (context, flags) => {
  if (flags.has("--restart")) {
    await stopManagedProcesses();
  }

  const existingState = await readState();
  if (existingState) {
    const isAnyRunning = Object.values(existingState.services ?? {}).some((service) =>
      isPidRunning(service.pid)
    );

    if (isAnyRunning) {
      log("stack is already running");
      await printStatus(context);
      return;
    }
  }

  await bootstrap(context);
  await ensureLocalDatabase(context, {
    fresh: flags.has("--fresh")
  });

  if (flags.has("--fresh")) {
    await rm(context.hostStatePath, { force: true });
  }

  await migrateDatabase(context);
  await mkdir(logsDir, { recursive: true });

  const definitions = serviceDefinitions(context);
  const state = {
    startedAt: new Date().toISOString(),
    databaseUrl: context.databaseUrl,
    databaseName: context.databaseName,
    hostConfigPath: context.hostConfigPath,
    hostStatePath: context.hostStatePath,
    services: {}
  };

  try {
    for (const [name, definition] of Object.entries(definitions)) {
      const processInfo = await startDetachedProcess({
        name,
        command: definition.command,
        args: definition.args,
        env: definition.env,
        logPath: definition.logPath
      });
      state.services[name] = processInfo;
    }

    await writeState(state);
    await waitForStackReady(context);
  } catch (error) {
    await writeState(state);
    await stopManagedProcesses();
    throw error;
  }

  log("local stack is ready");
  console.log(`Web: ${context.webBaseUrl}`);
  console.log(`Central: ${context.centralBaseUrl}`);
  console.log(`Host: ${context.hostBaseUrl}`);
  console.log(`Logs: ${logsDir}`);
};

const stop = async () => {
  const stopped = await stopManagedProcesses();

  if (!stopped) {
    log("no managed local stack was running");
    return;
  }

  log("local stack stopped");
};

const main = async () => {
  const { command, flags } = parseArgs();
  const context = runtime();

  switch (command) {
    case "bootstrap":
      await bootstrap(context);
      break;
    case "start":
      await start(context, flags);
      break;
    case "status":
      await printStatus(context);
      break;
    case "stop":
      await stop();
      break;
    default:
      fail(`Unknown command: ${command}`);
  }
};

main().catch((error) => {
  console.error(`[local-stack] ${error.message}`);
  process.exit(1);
});
