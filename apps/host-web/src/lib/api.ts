import {
  hostWebClearFailureResponseSchema,
  hostWebHostReauthResponseSchema,
  hostWebMailboxDetailResponseSchema,
  hostWebMailboxesResponseSchema,
  hostWebOverviewResponseSchema,
  hostWebRemoveBindingResponseSchema,
  hostWebResumeMailboxResponseSchema,
  hostWebSetManagementStatusResponseSchema
} from "@agent-mail/contracts";

export type HostWebOverviewResponse = ReturnType<typeof hostWebOverviewResponseSchema.parse>;
export type HostWebMailboxesResponse = ReturnType<typeof hostWebMailboxesResponseSchema.parse>;
export type HostWebMailboxDetailResponse = ReturnType<typeof hostWebMailboxDetailResponseSchema.parse>;
export type HostWebAvailableActions = HostWebMailboxDetailResponse["available_actions"];
export type HostWebMailboxSummary = HostWebMailboxesResponse["mailboxes"][number];

async function requestJson<T>(input: RequestInfo | URL, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new Error(message);
  }
  return parse(payload);
}

export function getHostWebOverview(): Promise<HostWebOverviewResponse> {
  return requestJson("/api/v1/web/overview", { method: "GET" }, hostWebOverviewResponseSchema.parse);
}

export function getHostWebMailboxes(query?: {
  q?: string;
}): Promise<HostWebMailboxesResponse> {
  const search = new URLSearchParams();
  if (query?.q) {
    search.set("q", query.q);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson(`/api/v1/web/mailboxes${suffix}`, { method: "GET" }, hostWebMailboxesResponseSchema.parse);
}

export function getHostWebMailboxDetail(mailbox: string): Promise<HostWebMailboxDetailResponse> {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}`,
    { method: "GET" },
    hostWebMailboxDetailResponseSchema.parse
  );
}

export function reauthenticateHost() {
  return requestJson(
    "/api/v1/web/host/re-auth",
    { method: "POST" },
    hostWebHostReauthResponseSchema.parse
  );
}

export function resumeMailbox(mailbox: string) {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/resume`,
    { method: "POST" },
    hostWebResumeMailboxResponseSchema.parse
  );
}

export function clearMailboxFailure(mailbox: string) {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/clear-failure`,
    { method: "POST" },
    hostWebClearFailureResponseSchema.parse
  );
}

export function enableMailbox(mailbox: string) {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/enable`,
    { method: "POST" },
    hostWebSetManagementStatusResponseSchema.parse
  );
}

export function disableMailbox(mailbox: string) {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/disable`,
    { method: "POST" },
    hostWebSetManagementStatusResponseSchema.parse
  );
}

export function removeMailboxBinding(mailbox: string) {
  return requestJson(
    `/api/v1/web/mailboxes/${encodeURIComponent(mailbox)}/binding`,
    { method: "DELETE" },
    hostWebRemoveBindingResponseSchema.parse
  );
}
