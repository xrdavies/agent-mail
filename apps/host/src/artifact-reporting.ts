import type { ArtifactType, Task } from "@agent-mail/shared";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { CentralApiClient } from "./client.js";
import type { HostMailboxConfig } from "./config.js";
import type { WorkspaceGitInspector } from "./workspace-git.js";

export const extractArtifactPaths = (text: string): string[] => {
  const artifactLine = text
    .split("\n")
    .find((line) => line.trim().toLowerCase().startsWith("artifacts:"));

  if (!artifactLine) {
    return [];
  }

  return artifactLine
    .slice(artifactLine.indexOf(":") + 1)
    .split(",")
    .map((value) => value.replaceAll("`", "").trim())
    .filter(Boolean);
};

export const inferArtifactType = (path: string): ArtifactType => {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".md") || lowerPath.endsWith(".txt")) {
    return "document";
  }

  if (lowerPath.includes(".test.") || lowerPath.includes(".spec.") || lowerPath.endsWith(".snap")) {
    return "test";
  }

  if (
    lowerPath.endsWith(".json") ||
    lowerPath.endsWith(".yaml") ||
    lowerPath.endsWith(".yml") ||
    lowerPath.endsWith(".toml")
  ) {
    return "config";
  }

  if (lowerPath.endsWith(".sh")) {
    return "script";
  }

  if (
    lowerPath.endsWith(".ts") ||
    lowerPath.endsWith(".tsx") ||
    lowerPath.endsWith(".js") ||
    lowerPath.endsWith(".jsx") ||
    lowerPath.endsWith(".py") ||
    lowerPath.endsWith(".go") ||
    lowerPath.endsWith(".rs")
  ) {
    return "code";
  }

  return "other";
};

export const finalizeArtifactsForTask = async (input: {
  mailbox: HostMailboxConfig;
  task: Task;
  client: CentralApiClient;
  workspaceInspector: Pick<WorkspaceGitInspector, "inspect">;
  artifactSourceText: string;
}): Promise<string | null> => {
  const artifactPaths = extractArtifactPaths(input.artifactSourceText);

  if (artifactPaths.length === 0) {
    return `Task ${input.task.task_id} requires artifacts, but no Artifacts: line was found.`;
  }

  const missingPaths: string[] = [];

  for (const path of artifactPaths) {
    try {
      await access(resolve(input.mailbox.workspace_path, path));
    } catch {
      missingPaths.push(path);
    }
  }

  if (missingPaths.length > 0) {
    return `Task ${input.task.task_id} reported missing artifact paths: ${missingPaths.join(", ")}.`;
  }

  const gitMeta = await input.workspaceInspector.inspect(input.mailbox.workspace_path);

  for (const path of artifactPaths) {
    await input.client.createArtifact({
      task_id: input.task.task_id,
      mailbox: input.mailbox.mailbox,
      repository: gitMeta.repository,
      artifact_type: inferArtifactType(path),
      path,
      branch: gitMeta.branch,
      commit_sha: gitMeta.commitSha,
      pr_link: gitMeta.prLink
    });
  }

  return null;
};
