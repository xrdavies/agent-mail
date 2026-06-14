import type { AgentProfile } from "@agent-mail/contracts";

import type { MailboxLocalState } from "./state.js";

export function buildResumePrompt(profile: AgentProfile, delivery: {
  deliveryId: string;
  emailId: string;
  threadId: string;
}): string {
  const roleRules = getRoleRules(profile.role);
  return `You are ${profile.name}, role ${profile.role}, mailbox ${profile.mailbox}.

Your identity, responsibilities, language rules, git workflow, and standing mail/task handling rules are already defined in the workspace AGENTS.md.
Follow AGENTS.md as the persistent local rule file.

This is a resumed work turn, not a bootstrap turn.

Host has selected the target unread delivery for this turn:
- deliveryId: ${delivery.deliveryId}
- emailId: ${delivery.emailId}
- threadId: ${delivery.threadId}

This turn is only for that delivery.
Do not switch to another unread delivery in this turn.
Do not process a second unread delivery even if more unread deliveries exist.

Required execution order:
1. Call get_oldest_unread_delivery and confirm the oldest unread delivery still matches ${delivery.deliveryId}.
2. Call get_delivery for ${delivery.deliveryId}.
3. If ${delivery.deliveryId} is no longer unread or cannot be found, stop this turn and do not pick a replacement delivery yourself.
4. Call get_email for ${delivery.emailId}.
5. Call get_thread only if the single email is not sufficient.
6. Decide which case applies:
   - no task needed
   - direct reply
   - delegation or specialist work
   - task completion
7. Send the required reply email using send_email.
8. If delegation is needed, create the task after the delegation email has been sent.
9. If task completion is needed, update task status only after the completion email has been sent, using completedByEmailId.
10. Mark ${delivery.deliveryId} as read using mark_delivery_read.
11. Stop after this one delivery is fully handled.

${roleRules}`;
}

export function createSyntheticSessionId(mailbox: string): string {
  return `sess_${mailbox.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

export function getMailboxIdentity(state: MailboxLocalState): Pick<AgentProfile, "mailbox" | "name" | "role" | "responsibilities" | "profile_status" | "agent_id" | "registered_by_host_id" | "created_at" | "updated_at" | "retired_at"> {
  return {
    agent_id: `local_${state.mailbox}`,
    mailbox: state.mailbox,
    name: state.name ?? state.mailbox,
    role: state.role ?? "agent",
    responsibilities: state.responsibilities ?? "Agent Mail runtime participant.",
    profile_status: "active",
    registered_by_host_id: "local",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    retired_at: null
  };
}

function getRoleRules(role: string): string {
  switch (role) {
    case "pm":
      return `Additional PM turn constraints:
- Prefer answering directly when possible.
- Delegate only when another agent is clearly needed.
- Keep delegation minimal and specific.
- Do not fan out to multiple agents unless the current email explicitly requires broader coordination.
- Keep the reply concise, clear, and visible in the thread.`;
    case "backend":
      return `Additional backend turn constraints:
- Answer backend-specific questions directly.
- Do not create new delegation tasks unless the current email explicitly requires further specialist work.
- If repository work is required, perform only the minimal necessary change.
- If repository files were changed, report the concrete output paths in the reply.`;
    default:
      return `Additional role constraints:
- Stay within your declared role responsibilities.
- Prefer direct action over unnecessary delegation.
- Keep the reply concrete and visible in the thread.`;
  }
}
