import { spawn } from "node:child_process";

export type WorkspaceGitMeta = {
  branch: string | null;
  commitSha: string | null;
  repository: string | null;
  prLink: string | null;
};

type Executor = (command: string, workspacePath: string, args: string[]) => Promise<string>;

const defaultExecutor: Executor = async (command, workspacePath, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspacePath,
      stdio: "pipe"
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
        reject(new Error(stderr || `${command} ${args.join(" ")} failed with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });

export class WorkspaceGitInspector {
  constructor(private readonly executor: Executor = defaultExecutor) {}

  async inspect(workspacePath: string): Promise<WorkspaceGitMeta> {
    try {
      const [branch, commitSha] = await Promise.all([
        this.executor("git", workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
        this.executor("git", workspacePath, ["rev-parse", "HEAD"])
      ]);

      const repository =
        (await this.tryGh(workspacePath, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])) ??
        null;
      const prLink =
        branch && branch !== "HEAD"
          ? ((await this.tryGh(workspacePath, ["pr", "list", "--state", "all", "--head", branch, "--json", "url", "--jq", ".[0].url"])) ??
            null)
          : null;

      return {
        branch,
        commitSha,
        repository,
        prLink
      };
    } catch {
      return {
        branch: null,
        commitSha: null,
        repository: null,
        prLink: null
      };
    }
  }

  private async tryGh(workspacePath: string, args: string[]): Promise<string | null> {
    try {
      const value = await this.executor("gh", workspacePath, args);
      return value || null;
    } catch {
      return null;
    }
  }
}
