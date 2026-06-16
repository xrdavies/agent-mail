import { describe, expect, it } from "vitest";

import { createHostApp } from "../src/app.js";
import { HostHttpError } from "../src/errors.js";
import type { HostRuntime } from "../src/runtime.js";

const mailbox = "backend.coda@agents.local";
const mcp = {
  url: "http://127.0.0.1:8788/mcp",
  command: "codex mcp add agent-mail-host --url http://127.0.0.1:8788/mcp",
  json: {
    mcpServers: {
      "agent-mail-host": {
        url: "http://127.0.0.1:8788/mcp"
      }
    }
  },
  toml: '[mcp_servers.agent-mail-host]\nurl = "http://127.0.0.1:8788/mcp"\n'
};

function createRuntimeMock(): HostRuntime {
  return {
    getStatusPayload: async () => ({
      host: {
        host_id: "mac-local",
        label: "Mac Local",
        host_version: "0.1.0",
        host_status: "online",
        last_heartbeat_at: "2026-06-16T12:04:58.000Z",
        last_authenticated_at: "2026-06-16T12:00:03.000Z",
        created_at: "2026-06-16T10:00:00.000Z",
        updated_at: "2026-06-16T12:04:58.000Z"
      },
      managed_mailboxes: [mailbox],
      mailbox_status: [
        {
          mailbox,
          mailbox_runtime_status: "failed",
          current_session_id: "sess_backend_coda",
          pending_unread_count: 2
        }
      ]
    }),
    getMcpConfigPayload: () => mcp,
    getWebOverviewPayload: async () => ({
      host: {
        host_id: "mac-local",
        label: "Mac Local",
        host_version: "0.1.0",
        host_status: "degraded",
        started_at: "2026-06-16T10:00:00.000Z"
      },
      auth: {
        central_base_url: "http://127.0.0.1:3000",
        authenticated: true,
        last_authenticated_at: "2026-06-16T12:00:03.000Z",
        last_heartbeat_at: "2026-06-16T12:04:58.000Z",
        last_auth_error: null
      },
      mcp,
      counters: {
        managed_mailboxes: 1,
        enabled_mailboxes: 1,
        disabled_mailboxes: 0,
        running_mailboxes: 0,
        failed_mailboxes: 1,
        stuck_unread_mailboxes: 1
      },
      attention_mailboxes: [
        {
          mailbox,
          name: "Coda",
          role: "backend",
          management_status: "enabled",
          binding_status: "active",
          runtime_status: "failed",
          pending_unread_count: 2,
          last_error: "resume command exited with code 1",
          bootstrap_status: "succeeded",
          updated_at: "2026-06-16T12:01:13.000Z",
          available_actions: {
            can_resume_now: true,
            can_clear_failure: true,
            can_enable: false,
            can_disable: true,
            can_remove_local_binding: true
          }
        }
      ]
    }),
    listWebMailboxesPayload: async () => ({
      counters: {
        total: 1,
        enabled: 1,
        disabled: 0,
        failed: 1,
        with_unread: 1
      },
      mailboxes: [
        {
          mailbox,
          name: "Coda",
          role: "backend",
          binding_status: "active",
          management_status: "enabled",
          runtime_status: "failed",
          pending_unread_count: 2,
          current_session_id: "sess_backend_coda",
          next_resume_after: null,
          bootstrap_status: "succeeded",
          updated_at: "2026-06-16T12:01:13.000Z",
          last_error: "resume command exited with code 1",
          available_actions: {
            can_resume_now: true,
            can_clear_failure: true,
            can_enable: false,
            can_disable: true,
            can_remove_local_binding: true
          }
        }
      ]
    }),
    getWebMailboxDetailPayload: async () => ({
      profile: {
        mailbox,
        name: "Coda",
        role: "backend",
        responsibilities: "Backend implementation."
      },
      binding: {
        host_id: "mac-local",
        binding_status: "active",
        bound_at: "2026-06-16T10:00:04.000Z",
        unbound_at: null
      },
      workspace: {
        workspace_path: "/tmp/backend-coda",
        git_user_name: "Coda",
        git_user_email: mailbox
      },
      bootstrap: {
        bootstrap_status: "succeeded",
        last_bootstrap_at: "2026-06-16T10:00:04.000Z",
        last_bootstrap_error: null
      },
      runtime: {
        management_status: "enabled",
        runtime_status: "failed",
        current_session_id: "sess_backend_coda",
        active_task_id: "task_044",
        pending_unread_count: 2,
        last_processed_delivery_id: "del_011",
        latest_summary: null,
        failure_count: 3,
        next_resume_after: null,
        last_error: "resume command exited with code 1",
        updated_at: "2026-06-16T12:01:13.000Z"
      },
      recovery: {
        suggested_action: "Clear failure, inspect the agent session or workspace, then resume now."
      },
      recent_events: [
        {
          level: "error",
          title: "Resume failed",
          message: "resume command exited with code 1",
          at: "2026-06-16T12:01:13.000Z"
        }
      ],
      available_actions: {
        can_resume_now: true,
        can_clear_failure: true,
        can_enable: false,
        can_disable: true,
        can_remove_local_binding: true
      }
    }),
    reauthenticateHost: async () => ({
      ok: true,
      host_status: "online",
      last_authenticated_at: "2026-06-16T12:05:10.000Z",
      last_auth_error: null
    }),
    resumeMailboxNow: async () => ({
      ok: true,
      mailbox,
      accepted: true,
      runtime_status: "running"
    }),
    clearMailboxFailure: async () => ({
      ok: true,
      mailbox,
      runtime_status: "idle",
      failure_count: 0,
      next_resume_after: null,
      last_error: null
    }),
    enableMailbox: async () => ({
      ok: true,
      mailbox,
      management_status: "enabled"
    }),
    disableMailbox: async () => ({
      ok: true,
      mailbox,
      management_status: "disabled"
    }),
    removeLocalBinding: async () => ({
      ok: true,
      mailbox,
      binding_status: "inactive",
      management_status: "removed"
    }),
    isAuthenticated: () => true
  } as unknown as HostRuntime;
}

describe("Host web routes", () => {
  it("serves overview, roster, detail, and action routes", async () => {
    const app = createHostApp(createRuntimeMock());

    const mcpResponse = await app.request("http://localhost/mcp-config");
    expect(mcpResponse.status).toBe(200);
    expect((await mcpResponse.json()).url).toBe("http://127.0.0.1:8788/mcp");

    const overviewResponse = await app.request("http://localhost/api/v1/web/overview");
    expect(overviewResponse.status).toBe(200);
    expect((await overviewResponse.json()).counters.failed_mailboxes).toBe(1);

    const mailboxesResponse = await app.request("http://localhost/api/v1/web/mailboxes?q=backend");
    expect(mailboxesResponse.status).toBe(200);
    expect((await mailboxesResponse.json()).mailboxes[0]?.mailbox).toBe(mailbox);

    const detailResponse = await app.request(`http://localhost/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}`);
    expect(detailResponse.status).toBe(200);
    expect((await detailResponse.json()).runtime.failure_count).toBe(3);

    const resumeResponse = await app.request(
      `http://localhost/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/resume`,
      { method: "POST" }
    );
    expect(resumeResponse.status).toBe(200);
    expect((await resumeResponse.json()).runtime_status).toBe("running");

    const removeBindingResponse = await app.request(
      `http://localhost/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/binding`,
      { method: "DELETE" }
    );
    expect(removeBindingResponse.status).toBe(200);
    expect((await removeBindingResponse.json()).management_status).toBe("removed");
  });

  it("returns 409 when remove local binding hits a running mailbox conflict", async () => {
    const runtime = createRuntimeMock();
    runtime.removeLocalBinding = async () => {
      throw new HostHttpError(
        409,
        "Cannot remove local binding while mailbox runtime is running"
      );
    };

    const app = createHostApp(runtime);
    const response = await app.request(
      `http://localhost/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/binding`,
      {
        method: "DELETE"
      }
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      "Cannot remove local binding while mailbox runtime is running"
    );
  });
});
