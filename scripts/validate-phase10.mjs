#!/usr/bin/env node

import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const repoRoot = process.cwd();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowIso = () => new Date().toISOString();

const logStep = (message) => {
  console.log(`[phase10] ${message}`);
};

const parseArgs = () => ({
  keepTemp: process.argv.includes("--keep-temp")
});

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate an ephemeral port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
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

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command failed (${command} ${args.join(" ")}):\n${stderr || stdout || `exit ${code}`}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });

const startBackgroundProcess = async ({ name, command, args, env, cwd, logPath }) => {
  await mkdir(join(logPath, ".."), { recursive: true });
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, {
    cwd: cwd ?? repoRoot,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logStream.write(chunk);
  });

  return {
    name,
    logPath,
    child,
    async stop() {
      if (!child.killed) {
        child.kill("SIGINT");
      }

      await Promise.race([
        new Promise((resolve) => child.once("close", resolve)),
        sleep(5000).then(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        })
      ]);

      logStream.end();
    }
  };
};

const waitFor = async (label, fn, timeoutMs = 180_000, intervalMs = 2_000) => {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
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

  throw new Error(
    lastError
      ? `${label} timed out: ${lastError.message}`
      : `${label} timed out after ${timeoutMs}ms`
  );
};

const fetchJson = async (baseUrl, path, init) => {
  const response = await fetch(`${baseUrl}${path}`, init);

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${path}`);
  }

  return response.json();
};

const createTempEnvironment = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-mail-phase10-"));
  const pmWorkspace = join(tempRoot, "pm-workspace");
  const backendWorkspace = join(tempRoot, "backend-workspace");
  const hostConfigPath = join(tempRoot, "host.toml");
  const hostStatePath = join(tempRoot, "state.json");

  await runCommand("git", ["clone", "--quiet", ".", pmWorkspace]);
  await runCommand("git", ["clone", "--quiet", ".", backendWorkspace]);

  await writeFile(
    hostConfigPath,
    `machine_id = "phase10-script-mac"
label = "Phase10 Script Mac"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "${pmWorkspace}"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "backend.coda@agents.local"
name = "Coda"
role = "backend"
workspace_path = "${backendWorkspace}"
git_user_name = "Coda"
git_user_email = "backend.coda@agents.local"
`,
    "utf8"
  );

  return {
    tempRoot,
    pmWorkspace,
    backendWorkspace,
    hostConfigPath,
    hostStatePath,
    centralLog: join(tempRoot, "central.log"),
    hostLog: join(tempRoot, "host.log"),
    webLog: join(tempRoot, "web.log"),
    reportPath: join(tempRoot, "phase10-report.json")
  };
};

const ensureDatabase = async (databaseName) => {
  await runCommand("docker", ["compose", "up", "-d", "postgres"]);
  await runCommand("docker", [
    "exec",
    "agent-mail-postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    `CREATE DATABASE ${databaseName}`
  ]);
};

const startStack = async ({ environment, databaseUrl }) => {
  const centralPort = await getFreePort();
  const hostPort = await getFreePort();
  const webPort = await getFreePort();

  await runCommand("pnpm", ["db:migrate"], {
    env: {
      DATABASE_URL: databaseUrl
    }
  });

  const central = await startBackgroundProcess({
    name: "central",
    command: "pnpm",
    args: ["--filter", "@agent-mail/central", "exec", "tsx", "src/index.ts"],
    env: {
      DATABASE_URL: databaseUrl,
      PORT: String(centralPort)
    },
    logPath: environment.centralLog
  });

  const centralBaseUrl = `http://127.0.0.1:${centralPort}`;
  await waitFor("central health", async () => {
    const response = await fetch(`${centralBaseUrl}/api/v1/health`);
    return response.ok;
  });

  const host = await startBackgroundProcess({
    name: "host",
    command: "pnpm",
    args: ["--filter", "@agent-mail/host", "exec", "tsx", "src/index.ts"],
    env: {
      CENTRAL_BASE_URL: centralBaseUrl,
      HOST_CONFIG_PATH: environment.hostConfigPath,
      HOST_STATE_PATH: environment.hostStatePath,
      HOST_PORT: String(hostPort),
      HOST_BASE_URL: `http://127.0.0.1:${hostPort}`,
      PENDING_WORK_INTERVAL_MS: "3000",
      MACHINE_HEARTBEAT_INTERVAL_MS: "3000",
      SESSION_HEARTBEAT_INTERVAL_MS: "3000"
    },
    logPath: environment.hostLog
  });

  const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
  await waitFor("host status", async () => {
    const response = await fetch(`${hostBaseUrl}/status`);
    return response.ok;
  });

  const web = await startBackgroundProcess({
    name: "web",
    command: "pnpm",
    args: ["--filter", "@agent-mail/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort)],
    env: {
      VITE_PROXY_TARGET: centralBaseUrl
    },
    logPath: environment.webLog
  });

  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  await waitFor("web root", async () => {
    const response = await fetch(webBaseUrl);
    return response.ok;
  });

  return {
    central,
    host,
    web,
    centralBaseUrl,
    hostBaseUrl,
    webBaseUrl
  };
};

const listSessions = (baseUrl) => fetchJson(baseUrl, "/api/v1/sessions");
const listTasks = (baseUrl, query = "") => fetchJson(baseUrl, `/api/v1/tasks${query}`);
const getThread = (baseUrl, threadId) => fetchJson(baseUrl, `/api/v1/threads/${threadId}`);
const createThread = (baseUrl, body) =>
  fetchJson(baseUrl, "/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
const createTask = (baseUrl, body) =>
  fetchJson(baseUrl, "/api/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
const patchTaskStatus = (baseUrl, taskId, status) =>
  fetchJson(baseUrl, `/api/v1/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
const appendMessage = (baseUrl, threadId, body) =>
  fetchJson(baseUrl, `/api/v1/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
const getWorkPackage = (baseUrl, taskId) => fetchJson(baseUrl, `/api/v1/tasks/${taskId}/work-package`);
const clearSession = (baseUrl, sessionId, mailbox) =>
  fetchJson(baseUrl, `/api/v1/sessions/${sessionId}/clear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mailbox,
      requested_by: "human-user",
      force: true
    })
  });

const findSessionByMailbox = (sessions, mailbox) =>
  sessions.find((session) => session.mailbox === mailbox && session.session_status !== "cleared") ?? null;

const scenario1 = async ({ centralBaseUrl }) => {
  const created = await createThread(centralBaseUrl, {
    subject: "Phase10 scenario 1",
    body: "Do not answer directly. Step 1: create exactly one child task assigned to backend.coda@agents.local with requiresArtifact=false. The child task must reply in this thread with exactly: backend scenario1 complete. Step 2: after creating that child task, reply in this thread with exactly: pm scenario1 waiting for backend. Step 3: stop the current turn immediately and do not wait in this same turn. When you are resumed later and the child task is done, reply in this thread with exactly: pm scenario1 complete. Then mark the parent task done.",
    assigned_mailbox: "pm.aster@agents.local"
  });

  const threadId = created.thread.thread_id;
  const parentTaskId = created.primary_task.task_id;

  const outcome = await waitFor("scenario 1", async () => {
    const [sessions, tasks, thread] = await Promise.all([
      listSessions(centralBaseUrl),
      listTasks(centralBaseUrl, `?thread_id=${threadId}`),
      getThread(centralBaseUrl, threadId)
    ]);

    const parentDone = tasks.find((task) => task.task_id === parentTaskId)?.status === "done";
    const childDone = tasks.some(
      (task) => task.parent_task_id === parentTaskId && task.assignee_mailbox === "backend.coda@agents.local" && task.status === "done"
    );
    const waitingReply = thread.messages.some(
      (message) => message.from_id === "pm.aster@agents.local" && message.body.includes("pm scenario1 waiting for backend")
    );
    const backendReply = thread.messages.some(
      (message) => message.from_id === "backend.coda@agents.local" && message.body.includes("backend scenario1 complete")
    );
    const pmReply = thread.messages.some(
      (message) => message.from_id === "pm.aster@agents.local" && message.body.includes("pm scenario1 complete")
    );

    if (parentDone && childDone && waitingReply && backendReply && pmReply) {
      return {
        threadId,
        pmSessionId: findSessionByMailbox(sessions, "pm.aster@agents.local")?.session_id ?? null,
        backendSessionId:
          findSessionByMailbox(sessions, "backend.coda@agents.local")?.session_id ?? null,
        childTaskId: tasks.find((task) => task.parent_task_id === parentTaskId)?.task_id ?? null
      };
    }

    return null;
  });

  return outcome;
};

const scenario2 = async ({ centralBaseUrl, scenario1Result }) => {
  await appendMessage(centralBaseUrl, scenario1Result.threadId, {
    from_type: "human",
    from_id: "human-user",
    to_type: "agent",
    to_id: "pm.aster@agents.local",
    message_kind: "human_mail",
    body: "Follow-up: confirm whether the same PM session is still being reused."
  });

  const followUpTask = await createTask(centralBaseUrl, {
    title: "Phase10 scenario 2 follow-up",
    thread_id: scenario1Result.threadId,
    parent_task_id: null,
    created_by_type: "human",
    created_by_id: "human-user",
    assignee_type: "agent",
    assignee_mailbox: "pm.aster@agents.local",
    requires_artifact: false,
    status: "new",
    body: "Reply in this thread with exactly: pm scenario2 same session confirmed. Then mark this task done."
  });

  return waitFor("scenario 2", async () => {
    const [sessions, tasks, thread] = await Promise.all([
      listSessions(centralBaseUrl),
      listTasks(centralBaseUrl, `?thread_id=${scenario1Result.threadId}`),
      getThread(centralBaseUrl, scenario1Result.threadId)
    ]);

    const sameSession = findSessionByMailbox(sessions, "pm.aster@agents.local")?.session_id === scenario1Result.pmSessionId;
    const taskDone = tasks.find((task) => task.task_id === followUpTask.task_id)?.status === "done";
    const replyFound = thread.messages.some(
      (message) =>
        message.from_id === "pm.aster@agents.local" &&
        message.body.includes("pm scenario2 same session confirmed")
    );

    if (sameSession && taskDone && replyFound) {
      return {
        followUpTaskId: followUpTask.task_id
      };
    }

    return null;
  });
};

const scenario3 = async ({ centralBaseUrl, environment }) => {
  const created = await createThread(centralBaseUrl, {
    subject: "Phase10 scenario 3 artifact",
    body: "Primary task placeholder for artifact scenario.",
    assigned_mailbox: "backend.coda@agents.local"
  });

  const artifactTask = await createTask(centralBaseUrl, {
    title: "Phase10 scenario 3 artifact task",
    thread_id: created.thread.thread_id,
    parent_task_id: created.primary_task.task_id,
    created_by_type: "human",
    created_by_id: "human-user",
    assignee_type: "agent",
    assignee_mailbox: "backend.coda@agents.local",
    requires_artifact: true,
    status: "new",
    body: "Create file PHASE10_ARTIFACT_NOTE.md containing exactly artifact ok. After creating it, reply in this thread with two lines exactly: backend scenario3 complete and Artifacts: PHASE10_ARTIFACT_NOTE.md . Then mark this task done."
  });

  await patchTaskStatus(centralBaseUrl, created.primary_task.task_id, "done");

  return waitFor("scenario 3", async () => {
    const [tasks, thread, workPackage] = await Promise.all([
      listTasks(centralBaseUrl, `?thread_id=${created.thread.thread_id}`),
      getThread(centralBaseUrl, created.thread.thread_id),
      getWorkPackage(centralBaseUrl, artifactTask.task_id)
    ]);

    const artifactDone = tasks.find((task) => task.task_id === artifactTask.task_id)?.status === "done";
    const replyFound = thread.messages.some(
      (message) =>
        message.from_id === "backend.coda@agents.local" &&
        message.body.includes("backend scenario3 complete")
    );
    const artifactRecorded = workPackage.recent_artifacts.some(
      (artifact) => artifact.path === "PHASE10_ARTIFACT_NOTE.md"
    );

      if (artifactDone && replyFound && artifactRecorded) {
        const artifactPath = join(environment.backendWorkspace, "PHASE10_ARTIFACT_NOTE.md");
        const artifactBody = (await readFile(artifactPath, "utf8")).trim();
        if (!artifactBody.toLowerCase().startsWith("artifact ok")) {
          throw new Error(`Unexpected artifact body: ${artifactBody}`);
        }

      return {
        artifactTaskId: artifactTask.task_id,
        backendSessionId:
          findSessionByMailbox(await listSessions(centralBaseUrl), "backend.coda@agents.local")?.session_id ?? null
      };
    }

    return null;
  });
};

const scenario4And5 = async ({ centralBaseUrl, webBaseUrl, scenario3Result, environment }) => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"]
  });
  const page = await browser.newPage();

  try {
    await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=AGENT MAIL CONTROL ROOM");
    await page.waitForSelector("text=Phase10 Script Mac");

    await page.locator('button').filter({ hasText: 'backend.coda@agents.local' }).first().click();
    await page.waitForTimeout(500);

    const detailText = await page.locator("body").innerText();
    if (!detailText.includes(environment.backendWorkspace)) {
      throw new Error("Session detail did not show backend workspace path.");
    }

    await page.getByRole("button", { name: "Clear Session" }).click();

    await waitFor("web clear session", async () => {
      const sessions = await listSessions(centralBaseUrl);
      const cleared = sessions.find((session) => session.session_id === scenario3Result.backendSessionId);
      return cleared?.session_status === "cleared";
    });

    const rebootstrapThread = await createThread(centralBaseUrl, {
      subject: "Phase10 scenario 4 rebootstrap",
      body: "Reply with exactly backend scenario4 new session confirmed and then mark the task done.",
      assigned_mailbox: "backend.coda@agents.local"
    });

    const newSession = await waitFor("scenario 4 backend recovery", async () => {
      const [sessions, tasks, thread] = await Promise.all([
        listSessions(centralBaseUrl),
        listTasks(centralBaseUrl, `?thread_id=${rebootstrapThread.thread.thread_id}`),
        getThread(centralBaseUrl, rebootstrapThread.thread.thread_id)
      ]);

      const currentBackend = findSessionByMailbox(sessions, "backend.coda@agents.local");
      const taskDone = tasks.find((task) => task.task_id === rebootstrapThread.primary_task.task_id)?.status === "done";
      const replyFound = thread.messages.some(
        (message) =>
          message.from_id === "backend.coda@agents.local" &&
          message.body.includes("backend scenario4 new session confirmed")
      );

      if (currentBackend && taskDone && replyFound) {
        return {
          sessionId: currentBackend.session_id,
          reused: currentBackend.session_id === scenario3Result.backendSessionId
        };
      }

      return null;
    });

    const webThreadSubject = `Phase10 web compose ${Date.now()}`;
    await page.fill("#compose-subject", webThreadSubject);
    await page.fill(
      "#compose-body",
      "Please acknowledge this web-composed thread with a backend follow-up if needed."
    );
    await page.selectOption("#compose-mailbox", "pm.aster@agents.local");
    await page.getByRole("button", { name: "Create Thread" }).click();

    const webThread = await waitFor("scenario 5 web compose", async () => {
      const threads = await fetchJson(centralBaseUrl, "/api/v1/threads");
      return threads.find((thread) => thread.subject === webThreadSubject) ?? null;
    });

    await page.getByRole("button", { name: webThreadSubject }).click();
    await page.fill("#reply-body", "Phase10 web reply from human operator.");
    await page.getByRole("button", { name: "Reply to Thread" }).click();

    const webReply = await waitFor("scenario 5 web reply", async () => {
      const threadDetail = await getThread(centralBaseUrl, webThread.thread_id);
      return (
        threadDetail.messages.find(
          (message) =>
            message.from_id === "human-user" &&
            message.body.includes("Phase10 web reply from human operator.")
        ) ?? null
      );
    });

    return {
      newBackendSessionId: newSession.sessionId,
      reusedSessionId: newSession.reused,
      webThreadId: webThread.thread_id,
      webReplyMessageId: webReply.message_id
    };
  } finally {
    await Promise.race([browser.close(), sleep(5000)]);
  }
};

const buildReport = (context) => ({
  generated_at: nowIso(),
  temp_root: context.environment.tempRoot,
  services: {
    central: context.stack.centralBaseUrl,
    host: context.stack.hostBaseUrl,
    web: context.stack.webBaseUrl
  },
  scenarios: context.results
});

const writeProgressReport = async (context) => {
  const report = buildReport(context);
  await writeFile(context.environment.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

const cleanup = async ({ environment, services, keepTemp }) => {
  await Promise.allSettled(services.map((service) => service.stop()));
  await runCommand("pkill", ["-f", environment.tempRoot]).catch(() => {});

  if (!keepTemp) {
    await rm(environment.tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250
    });
  }
};

const main = async () => {
  const args = parseArgs();
  const environment = await createTempEnvironment();
  const databaseName = `agent_mail_phase10_${Date.now()}`;
  const databaseUrl = `postgres://postgres:postgres@localhost:5432/${databaseName}`;

  const services = [];
  const results = {};

  try {
    logStep(`prepare temp root ${environment.tempRoot}`);
    await ensureDatabase(databaseName);
    logStep(`database ready ${databaseName}`);
    const stack = await startStack({ environment, databaseUrl });
    services.push(stack.central, stack.host, stack.web);
    logStep(`stack ready central=${stack.centralBaseUrl} host=${stack.hostBaseUrl} web=${stack.webBaseUrl}`);

    const scenario1Result = await scenario1({ centralBaseUrl: stack.centralBaseUrl });
    results.scenario_1 = scenario1Result;
    await writeProgressReport({ environment, stack, results });
    logStep("scenario 1 complete");

    const scenario2Result = await scenario2({
      centralBaseUrl: stack.centralBaseUrl,
      scenario1Result
    });
    results.scenario_2 = scenario2Result;
    await writeProgressReport({ environment, stack, results });
    logStep("scenario 2 complete");

    const scenario3Result = await scenario3({
      centralBaseUrl: stack.centralBaseUrl,
      environment
    });
    results.scenario_3 = scenario3Result;
    await writeProgressReport({ environment, stack, results });
    logStep("scenario 3 complete");

    const scenario4And5Result = await scenario4And5({
      centralBaseUrl: stack.centralBaseUrl,
      webBaseUrl: stack.webBaseUrl,
      scenario3Result,
      environment
    });
    results.scenario_4 = {
      cleared_session_id: scenario3Result.backendSessionId,
      new_session_id: scenario4And5Result.newBackendSessionId,
      reused_session_id: scenario4And5Result.reusedSessionId
    };
    results.scenario_5 = {
      host_visible_in_web: true,
      session_detail_visible_in_web: true,
      clear_action_works_in_web: true,
      compose_thread_in_web: true,
      reply_thread_in_web: true,
      web_thread_id: scenario4And5Result.webThreadId,
      web_reply_message_id: scenario4And5Result.webReplyMessageId
    };
    await writeProgressReport({ environment, stack, results });
    logStep("scenario 4 and 5 complete");

    const report = buildReport({ environment, stack, results });
    await writeFile(environment.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const failureReport = {
      generated_at: nowIso(),
      temp_root: environment.tempRoot,
      error: error instanceof Error ? error.message : String(error),
      logs: {
        central: environment.centralLog,
        host: environment.hostLog,
        web: environment.webLog
      }
    };
    await writeFile(environment.reportPath, `${JSON.stringify(failureReport, null, 2)}\n`, "utf8");
    console.error(JSON.stringify(failureReport, null, 2));
    throw error;
  } finally {
    try {
      await cleanup({ environment, services, keepTemp: args.keepTemp });
    } catch (error) {
      console.error(
        JSON.stringify({
          generated_at: nowIso(),
          temp_root: environment.tempRoot,
          cleanup_error: error instanceof Error ? error.message : String(error)
        }, null, 2)
      );
    }
  }
};

main().catch(() => {
  process.exit(1);
});
