import { spawn } from "node:child_process";

export type WorkspaceGitMeta = {
  branch: string | null;
  commitSha: string | null;
};

type Executor = (workspacePath: string, args: string[]) => Promise<string>;

const defaultExecutor: Executor = async (workspacePath, args) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", args, {
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
        reject(new Error(stderr || `git ${args.join(" ")} failed with code ${code}`));
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
        this.executor(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
        this.executor(workspacePath, ["rev-parse", "HEAD"])
      ]);

      return {
        branch,
        commitSha
      };
    } catch {
      return {
        branch: null,
        commitSha: null
      };
    }
  }
}
