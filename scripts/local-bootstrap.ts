import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  bootstrapDir,
  buildCodexMcpConfigArgs,
  formatCommand,
  readBootstrapFlag,
  readManifest,
  renderWorkspaceAgentsFile,
  runCommand,
  runStreamingCommand,
  uniqueTempFile,
  waitForHttpOk
} from "./lib/local-stack.js";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

async function main(): Promise<void> {
  const manifest = await readManifest();
  await waitForHttpOk(`${manifest.centralBaseUrl}/api/v1/health`, 10_000, "Central health");
  await waitForHttpOk(`${manifest.hostBaseUrl}/health`, 10_000, "Host health");

  for (const mailbox of manifest.mailboxes) {
    const bootstrapped = await readBootstrapFlag(manifest.statePath, mailbox.mailbox);
    if (bootstrapped && !force) {
      console.log(`Skip ${mailbox.mailbox}: already bootstrapped.`);
      continue;
    }

    const agentsTemplatePath = path.join(bootstrapDir, `${mailbox.slug}-AGENTS.md`);
    await writeFile(agentsTemplatePath, renderWorkspaceAgentsFile(mailbox));
    const prompt = [
      `You are ${mailbox.name}, role ${mailbox.role}, mailbox ${mailbox.mailbox}.`,
      "",
      "This is the first manual startup for this mailbox on this Host.",
      "",
      "Follow these steps exactly:",
      `1. Read the file ${agentsTemplatePath}.`,
      "2. Overwrite AGENTS.md at the current workspace root with exactly the contents of that file and no modifications.",
      "3. Use Host MCP to call bootstrap_agent with these exact values:",
      `   - name: ${mailbox.name}`,
      `   - mailbox: ${mailbox.mailbox}`,
      `   - role: ${mailbox.role}`,
      `   - responsibilities: ${mailbox.responsibilities}`,
      "   - workspacePath: current workspace root",
      "4. Stop immediately after bootstrap and registration succeed.",
      "",
      "Do not process unread deliveries.",
      "Do not create tasks.",
      "Do not reply to email.",
      "Do not modify any file except AGENTS.md."
    ].join("\n");
    const outputPath = uniqueTempFile(`agent-mail-bootstrap-${mailbox.slug}`, "txt");
    const codexArgs = [
      "exec",
      "-C",
      mailbox.workspacePath,
      ...buildCodexMcpConfigArgs(manifest.hostMcpUrl),
      "--dangerously-bypass-approvals-and-sandbox",
      "--output-last-message",
      outputPath,
      prompt
    ];

    console.log(`Bootstrap ${mailbox.mailbox}`);
    console.log(formatCommand("codex", codexArgs));
    await runStreamingCommand("codex", codexArgs, {
      cwd: manifest.repoRoot
    });
  }

  console.log("Bootstrap completed.");
  console.log("Run smoke next: pnpm e2e:smoke");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
