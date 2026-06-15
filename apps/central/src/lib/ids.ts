import { createHash, randomBytes } from "node:crypto";

const MESSAGE_DOMAIN = "agent-mail.local";

function randomSuffix(size = 8): string {
  return randomBytes(size).toString("hex");
}

export function createPrefixedId(prefix: string): string {
  return `${prefix}_${randomSuffix()}`;
}

export function createMessageId(): string {
  return `<am-${randomSuffix(12)}@${MESSAGE_DOMAIN}>`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}
