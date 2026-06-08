import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type CodexSessionMeta = {
  id: string;
  timestamp: string;
  cwd: string;
  path: string;
  mtimeMs: number;
};

const getCodexHome = () => process.env.CODEX_HOME ?? join(homedir(), ".codex");

const collectJsonlFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files;
};

const parseSessionMetaFile = async (path: string): Promise<CodexSessionMeta | null> => {
  const source = await readFile(path, "utf8").catch(() => null);

  if (!source) {
    return null;
  }

  const firstLine = source.split("\n", 1)[0];

  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: {
        id?: string;
        timestamp?: string;
        cwd?: string;
      };
    };

    if (
      parsed.type !== "session_meta" ||
      !parsed.payload?.id ||
      !parsed.payload.timestamp ||
      !parsed.payload.cwd
    ) {
      return null;
    }

    const fileStat = await stat(path);

    return {
      id: parsed.payload.id,
      timestamp: parsed.payload.timestamp,
      cwd: resolve(parsed.payload.cwd),
      path,
      mtimeMs: fileStat.mtimeMs
    };
  } catch {
    return null;
  }
};

export class CodexSessionResolver {
  constructor(private readonly codexHomePath: string = getCodexHome()) {}

  async findLatestByWorkspace(workspacePath: string): Promise<CodexSessionMeta | null> {
    const sessionsRoot = join(this.codexHomePath, "sessions");
    const sessionFiles = await collectJsonlFiles(sessionsRoot);
    const targetWorkspace = resolve(workspacePath);
    const candidates = await Promise.all(sessionFiles.map((path) => parseSessionMetaFile(path)));

    return (
      candidates
        .filter((candidate): candidate is CodexSessionMeta => Boolean(candidate))
        .filter((candidate) => candidate.cwd === targetWorkspace)
        .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null
    );
  }
}
