import {
  getPostgresStatus,
  loadManifestOrDefault,
  runCommand,
  stopManagedProcess
} from "./lib/local-stack.js";

const args = new Set(process.argv.slice(2));
const keepPostgres = args.has("--keep-postgres");

async function main(): Promise<void> {
  const manifest = await loadManifestOrDefault();

  await stopManagedProcess("host");
  await stopManagedProcess("central");

  if (!keepPostgres) {
    const postgres = await getPostgresStatus();
    if (postgres.running) {
      await runCommand("docker", ["compose", "stop", "postgres"], {
        cwd: manifest.repoRoot
      });
    }
  }

  console.log("Agent Mail local stack stopped.");
  console.log(`Host/Central pid files cleaned under ${manifest.pidsDir}`);
  if (keepPostgres) {
    console.log("Postgres left running because --keep-postgres was set.");
  } else {
    console.log("Postgres stop attempted.");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
