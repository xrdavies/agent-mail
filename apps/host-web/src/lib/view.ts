import type {
  HostWebAvailableActions,
  HostWebMailboxDetailResponse,
  HostWebMailboxSummary,
  HostWebOverviewResponse
} from "./api.js";

export function formatTimestamp(input: string | null): string {
  if (!input) {
    return "-";
  }
  return new Date(input).toLocaleString("zh-CN", {
    hour12: false
  });
}

export function formatShortTimestamp(input: string | null): string {
  if (!input) {
    return "-";
  }
  return new Date(input).toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

export function statusChipClass(status: string): string {
  if (status === "failed") return "danger";
  if (status === "running" || status === "enabled" || status === "active" || status === "succeeded") return "success";
  if (status === "disabled") return "warning";
  return "info";
}

export function mailboxDetailPath(mailbox: string): string {
  return `/mailboxes/${encodeURIComponent(mailbox)}`;
}

export function summarizeMailboxCopy(
  mailbox: Pick<
    HostWebMailboxSummary,
    "management_status" | "runtime_status" | "pending_unread_count"
  > &
    Pick<HostWebOverviewResponse["attention_mailboxes"][number], "last_error">
): string {
  const parts = [
    mailbox.runtime_status,
    `unread ${mailbox.pending_unread_count}`
  ];
  if (mailbox.management_status !== "enabled") {
    parts.unshift(mailbox.management_status);
  }
  if (mailbox.last_error) {
    parts.push(`error: ${mailbox.last_error}`);
  }
  return parts.join(" · ");
}

export function detailSummary(detail: HostWebMailboxDetailResponse): string {
  const parts = [
    `${detail.binding.binding_status} on ${detail.binding.host_id}`,
    `unread ${detail.runtime.pending_unread_count}`
  ];
  if (detail.runtime.last_error) {
    parts.push(`last error ${formatShortTimestamp(detail.runtime.updated_at)}`);
  }
  return parts.join(" · ");
}

export function hasAnyAction(actions: HostWebAvailableActions): boolean {
  return (
    actions.can_resume_now ||
    actions.can_clear_failure ||
    actions.can_enable ||
    actions.can_disable ||
    actions.can_remove_local_binding
  );
}
