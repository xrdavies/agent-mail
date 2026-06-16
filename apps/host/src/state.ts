import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ManagedMailboxConfig } from "./config.js";

export interface MailboxLocalState {
  mailbox: string;
  workspacePath: string;
  gitUserName: string;
  gitUserEmail: string;
  name: string | null;
  role: string | null;
  responsibilities: string | null;
  bootstrapped: boolean;
  bindingStatus: "active" | "inactive" | "failed";
  managementStatus: "enabled" | "disabled" | "removed";
  runtimeStatus: "bootstrapping" | "idle" | "running" | "failed" | "cleared";
  currentSessionId: string | null;
  activeTaskId: string | null;
  lastProcessedDeliveryId: string | null;
  latestSummary: string | null;
  failureCount: number;
  nextResumeAfter: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastBootstrapAt: string | null;
  bootstrapStatus: "never_started" | "succeeded" | "failed";
  lastBootstrapError: string | null;
  boundAt: string | null;
  unboundAt: string | null;
  updatedAt: string;
}

export interface HostEvent {
  mailbox: string | null;
  level: "info" | "error";
  title: string;
  message: string | null;
  at: string;
}

export class HostStateStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dbPath: string, mailboxes: ManagedMailboxConfig[]) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mailbox_state (
        mailbox TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        git_user_name TEXT NOT NULL,
        git_user_email TEXT NOT NULL,
        name TEXT,
        role TEXT,
        responsibilities TEXT,
        bootstrapped INTEGER NOT NULL DEFAULT 0,
        binding_status TEXT NOT NULL DEFAULT 'inactive',
        runtime_status TEXT NOT NULL DEFAULT 'idle',
        current_session_id TEXT,
        active_task_id TEXT,
        last_processed_delivery_id TEXT,
        latest_summary TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        next_resume_after TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mailbox_events (
        event_id TEXT PRIMARY KEY,
        mailbox TEXT,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureMailboxStateColumns();
    this.seedManagedMailboxes(mailboxes);
  }

  close(): void {
    this.db.close();
  }

  getHostToken(): string | null {
    return this.getKvValue("host_token");
  }

  setHostToken(token: string | null): void {
    this.setKvValue("host_token", token);
  }

  getLastAuthError(): string | null {
    return this.getKvValue("last_auth_error");
  }

  setLastAuthError(message: string | null): void {
    this.setKvValue("last_auth_error", message);
  }

  getMailboxState(mailbox: string): MailboxLocalState | null {
    const row = this.db
      .prepare("SELECT * FROM mailbox_state WHERE mailbox = ?")
      .get(mailbox) as MailboxRow | undefined;
    return row ? mapMailboxRow(row) : null;
  }

  listMailboxStates(): MailboxLocalState[] {
    const rows = this.db
      .prepare("SELECT * FROM mailbox_state ORDER BY mailbox ASC")
      .all() as unknown as MailboxRow[];
    return rows.map(mapMailboxRow);
  }

  listEvents(options: {
    mailbox?: string;
    limit?: number;
  } = {}): HostEvent[] {
    const limit = options.limit ?? 10;
    const rows = options.mailbox
      ? (this.db
          .prepare(
            `
              SELECT * FROM mailbox_events
              WHERE mailbox = ? OR mailbox IS NULL
              ORDER BY created_at DESC
              LIMIT ?
            `
          )
          .all(options.mailbox, limit) as unknown as HostEventRow[])
      : (this.db
          .prepare("SELECT * FROM mailbox_events ORDER BY created_at DESC LIMIT ?")
          .all(limit) as unknown as HostEventRow[]);
    return rows.map(mapHostEventRow);
  }

  recordEvent(input: HostEvent): void {
    this.db
      .prepare(
        `
          INSERT INTO mailbox_events (
            event_id,
            mailbox,
            level,
            title,
            message,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        `evt_${randomUUID()}`,
        input.mailbox,
        input.level,
        input.title,
        input.message,
        input.at
      );
  }

  upsertMailboxConfig(mailbox: ManagedMailboxConfig): void {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO mailbox_state (
            mailbox,
            workspace_path,
            git_user_name,
            git_user_email,
            name,
            role,
            responsibilities,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(mailbox) DO UPDATE SET
            workspace_path = excluded.workspace_path,
            git_user_name = excluded.git_user_name,
            git_user_email = excluded.git_user_email,
            name = COALESCE(excluded.name, mailbox_state.name),
            role = COALESCE(excluded.role, mailbox_state.role),
            responsibilities = COALESCE(excluded.responsibilities, mailbox_state.responsibilities),
            updated_at = excluded.updated_at
        `
      )
      .run(
        mailbox.mailbox,
        mailbox.workspacePath,
        mailbox.gitUserName,
        mailbox.gitUserEmail,
        mailbox.name ?? null,
        mailbox.role ?? null,
        mailbox.responsibilities ?? null,
        timestamp
      );
  }

  markBootstrapped(input: {
    mailbox: string;
    workspacePath: string;
    gitUserName: string;
    gitUserEmail: string;
    name: string;
    role: string;
    responsibilities: string;
    sessionId: string;
  }): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET workspace_path = ?,
              git_user_name = ?,
              git_user_email = ?,
              name = ?,
              role = ?,
              responsibilities = ?,
              bootstrapped = 1,
              binding_status = 'active',
              management_status = 'enabled',
              runtime_status = 'idle',
              current_session_id = ?,
              failure_count = 0,
              next_resume_after = NULL,
              last_error = NULL,
              last_error_at = NULL,
              last_bootstrap_at = ?,
              bootstrap_status = 'succeeded',
              last_bootstrap_error = NULL,
              bound_at = ?,
              unbound_at = NULL,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(
        input.workspacePath,
        input.gitUserName,
        input.gitUserEmail,
        input.name,
        input.role,
        input.responsibilities,
        input.sessionId,
        timestamp,
        timestamp,
        timestamp,
        input.mailbox
      );
    return this.requireMailboxState(input.mailbox);
  }

  markBootstrapFailed(mailbox: string, errorMessage: string): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET bootstrapped = 0,
              binding_status = 'failed',
              runtime_status = 'failed',
              last_error = ?,
              last_error_at = ?,
              last_bootstrap_at = ?,
              bootstrap_status = 'failed',
              last_bootstrap_error = ?,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(errorMessage, timestamp, timestamp, errorMessage, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  markResumeStarted(mailbox: string): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET runtime_status = 'running',
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  markResumeSuccess(mailbox: string, input: {
    lastProcessedDeliveryId: string;
    latestSummary: string | null;
  }): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET runtime_status = 'idle',
              last_processed_delivery_id = ?,
              latest_summary = ?,
              failure_count = 0,
              next_resume_after = NULL,
              last_error = NULL,
              last_error_at = NULL,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(input.lastProcessedDeliveryId, input.latestSummary, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  markResumeFailure(mailbox: string, input: {
    maxFailures: number;
    backoffBaseMs: number;
    errorMessage: string;
  }): MailboxLocalState {
    const current = this.requireMailboxState(mailbox);
    const nextFailureCount = current.failureCount + 1;
    const nextResumeAfter =
      nextFailureCount >= input.maxFailures
        ? null
        : new Date(Date.now() + input.backoffBaseMs * 2 ** (nextFailureCount - 1)).toISOString();
    const runtimeStatus = nextFailureCount >= input.maxFailures ? "failed" : "idle";
    const timestamp = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET runtime_status = ?,
              failure_count = ?,
              next_resume_after = ?,
              last_error = ?,
              last_error_at = ?,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(
        runtimeStatus,
        nextFailureCount,
        nextResumeAfter,
        input.errorMessage,
        timestamp,
        timestamp,
        mailbox
      );
    return this.requireMailboxState(mailbox);
  }

  clearFailure(mailbox: string): MailboxLocalState {
    const current = this.requireMailboxState(mailbox);
    const timestamp = new Date().toISOString();
    const runtimeStatus =
      current.managementStatus === "removed" || !current.bootstrapped ? "cleared" : "idle";
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET runtime_status = ?,
              failure_count = 0,
              next_resume_after = NULL,
              last_error = NULL,
              last_error_at = NULL,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(runtimeStatus, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  setManagementStatus(
    mailbox: string,
    managementStatus: MailboxLocalState["managementStatus"]
  ): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET management_status = ?,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(managementStatus, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  markBindingRemoved(mailbox: string): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET bootstrapped = 0,
              binding_status = 'inactive',
              management_status = 'removed',
              runtime_status = 'cleared',
              current_session_id = NULL,
              active_task_id = NULL,
              failure_count = 0,
              next_resume_after = NULL,
              last_error = NULL,
              last_error_at = NULL,
              unbound_at = ?,
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(timestamp, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  setRuntimeStatus(
    mailbox: string,
    runtimeStatus: MailboxLocalState["runtimeStatus"],
    latestSummary?: string | null
  ): MailboxLocalState {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE mailbox_state
          SET runtime_status = ?,
              latest_summary = COALESCE(?, latest_summary),
              updated_at = ?
          WHERE mailbox = ?
        `
      )
      .run(runtimeStatus, latestSummary ?? null, timestamp, mailbox);
    return this.requireMailboxState(mailbox);
  }

  private getKvValue(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM kv_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setKvValue(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare("DELETE FROM kv_state WHERE key = ?").run(key);
      return;
    }
    this.db
      .prepare(
        `
          INSERT INTO kv_state (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(key, value);
  }

  private requireMailboxState(mailbox: string): MailboxLocalState {
    const state = this.getMailboxState(mailbox);
    if (!state) {
      throw new Error(`Mailbox ${mailbox} is not configured`);
    }
    return state;
  }

  private seedManagedMailboxes(mailboxes: ManagedMailboxConfig[]): void {
    for (const mailbox of mailboxes) {
      this.upsertMailboxConfig(mailbox);
    }
  }

  private ensureMailboxStateColumns(): void {
    const rows = this.db.prepare("PRAGMA table_info(mailbox_state)").all() as Array<{
      name: string;
    }>;
    const columns = new Set(rows.map((row) => row.name));

    const addColumn = (name: string, definition: string) => {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE mailbox_state ADD COLUMN ${definition}`);
      }
    };

    addColumn("management_status", "management_status TEXT NOT NULL DEFAULT 'enabled'");
    addColumn("last_bootstrap_at", "last_bootstrap_at TEXT");
    addColumn("bootstrap_status", "bootstrap_status TEXT NOT NULL DEFAULT 'never_started'");
    addColumn("last_bootstrap_error", "last_bootstrap_error TEXT");
    addColumn("last_error_at", "last_error_at TEXT");
    addColumn("bound_at", "bound_at TEXT");
    addColumn("unbound_at", "unbound_at TEXT");
  }
}

interface MailboxRow {
  mailbox: string;
  workspace_path: string;
  git_user_name: string;
  git_user_email: string;
  name: string | null;
  role: string | null;
  responsibilities: string | null;
  bootstrapped: number;
  binding_status: MailboxLocalState["bindingStatus"];
  management_status: MailboxLocalState["managementStatus"];
  runtime_status: MailboxLocalState["runtimeStatus"];
  current_session_id: string | null;
  active_task_id: string | null;
  last_processed_delivery_id: string | null;
  latest_summary: string | null;
  failure_count: number;
  next_resume_after: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_bootstrap_at: string | null;
  bootstrap_status: MailboxLocalState["bootstrapStatus"];
  last_bootstrap_error: string | null;
  bound_at: string | null;
  unbound_at: string | null;
  updated_at: string;
}

interface HostEventRow {
  mailbox: string | null;
  level: HostEvent["level"];
  title: string;
  message: string | null;
  created_at: string;
}

function mapMailboxRow(row: MailboxRow): MailboxLocalState {
  return {
    mailbox: row.mailbox,
    workspacePath: row.workspace_path,
    gitUserName: row.git_user_name,
    gitUserEmail: row.git_user_email,
    name: row.name,
    role: row.role,
    responsibilities: row.responsibilities,
    bootstrapped: row.bootstrapped === 1,
    bindingStatus: row.binding_status,
    managementStatus: row.management_status,
    runtimeStatus: row.runtime_status,
    currentSessionId: row.current_session_id,
    activeTaskId: row.active_task_id,
    lastProcessedDeliveryId: row.last_processed_delivery_id,
    latestSummary: row.latest_summary,
    failureCount: row.failure_count,
    nextResumeAfter: row.next_resume_after,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    lastBootstrapAt: row.last_bootstrap_at,
    bootstrapStatus: row.bootstrap_status,
    lastBootstrapError: row.last_bootstrap_error,
    boundAt: row.bound_at,
    unboundAt: row.unbound_at,
    updatedAt: row.updated_at
  };
}

function mapHostEventRow(row: HostEventRow): HostEvent {
  return {
    mailbox: row.mailbox,
    level: row.level,
    title: row.title,
    message: row.message,
    at: row.created_at
  };
}
