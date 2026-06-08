import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

export type CodexTurnInput = {
  workspacePath: string;
  prompt: string;
  outputFile: string;
  mcpUrl: string;
  sessionId?: string | null;
  codexBin?: string;
  gitUserName?: string;
  gitUserEmail?: string;
};

export type CodexTurnResult = {
  sessionId: string;
  lastMessage: string;
  stdout: string;
  stderr: string;
};

type ProcessExecutor = (input: {
  cmd: string;
  args: string[];
  cwd: string;
  stdin: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const defaultExecutor: ProcessExecutor = async ({ cmd, args, cwd, stdin, env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        ...env
      }
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
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });

const parseSessionId = (stdout: string) => {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        thread_id?: string;
      };

      if (parsed.type === "thread.started" && parsed.thread_id) {
        return parsed.thread_id;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Unable to find Codex thread.started event in --json output.");
};

export class CodexRunner {
  constructor(
    private readonly executor: ProcessExecutor = defaultExecutor,
    private readonly codexBin = "codex"
  ) {}

  async runTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
    await mkdir(dirname(input.outputFile), { recursive: true });

    const mcpConfigArg = `mcp_servers.agent_mail_host.url="${input.mcpUrl}"`;
    const args = input.sessionId
      ? [
          "exec",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-C",
          input.workspacePath,
          "-c",
          mcpConfigArg,
          "-o",
          input.outputFile,
          "resume",
          input.sessionId,
          "-"
        ]
      : [
          "exec",
          "--json",
          "--dangerously-bypass-approvals-and-sandbox",
          "-C",
          input.workspacePath,
          "-c",
          mcpConfigArg,
          "-o",
          input.outputFile,
          "-"
        ];

    const result = await this.executor({
      cmd: input.codexBin ?? this.codexBin,
      args,
      cwd: input.workspacePath,
      stdin: input.prompt,
      env: {
        ...(input.gitUserName
          ? {
              GIT_AUTHOR_NAME: input.gitUserName,
              GIT_COMMITTER_NAME: input.gitUserName
            }
          : {}),
        ...(input.gitUserEmail
          ? {
              GIT_AUTHOR_EMAIL: input.gitUserEmail,
              GIT_COMMITTER_EMAIL: input.gitUserEmail
            }
          : {})
      }
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Codex exited with code ${result.exitCode}: ${result.stderr || result.stdout || "unknown error"}`
      );
    }

    const lastMessage = (await readFile(input.outputFile, "utf8")).trim();

    return {
      sessionId: parseSessionId(result.stdout),
      lastMessage,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
