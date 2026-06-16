import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getMailboxes, sendHumanEmail } from "../lib/api.js";

const DEFAULT_FROM = "Human Operator <human.operator@example.com>";

function parseFromField(input: string): { display_name: string; address: string } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const namedMatch = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (namedMatch) {
    const displayName = namedMatch[1]?.trim();
    const address = namedMatch[2]?.trim();
    if (displayName && address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return {
        display_name: displayName,
        address
      };
    }
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      display_name: trimmed.split("@")[0] ?? trimmed,
      address: trimmed
    };
  }

  return null;
}

function parseLinkedResources(input: string): Array<{ url: string }> {
  const tokens = input
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return tokens.map((token) => {
    try {
      return { url: new URL(token).toString() };
    } catch {
      throw new Error(`Invalid linked resource URL: ${token}`);
    }
  });
}

export function ComposePage() {
  const queryClient = useQueryClient();
  const [fromValue, setFromValue] = useState(DEFAULT_FROM);
  const [toValue, setToValue] = useState("");
  const [ccValue, setCcValue] = useState("");
  const [subjectValue, setSubjectValue] = useState("");
  const [bodyValue, setBodyValue] = useState("");
  const [linkedResourcesValue, setLinkedResourcesValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["compose-mailboxes"],
    queryFn: getMailboxes
  });

  const recipientOptions = data?.mailboxes ?? [];

  useEffect(() => {
    if (recipientOptions.length === 0) {
      return;
    }
    const currentExists = recipientOptions.some((item) => item.profile.mailbox === toValue);
    if (!toValue || !currentExists) {
      setToValue(recipientOptions[0]?.profile.mailbox ?? "");
    }
  }, [recipientOptions, toValue]);

  const mutation = useMutation({
    mutationFn: sendHumanEmail,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["mailboxes"] }),
        queryClient.invalidateQueries({ queryKey: ["threads"] }),
        queryClient.invalidateQueries({ queryKey: ["mails"] })
      ]);
      setFormError(null);
    }
  });

  const submitError = formError ?? mutation.error?.message ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const from = parseFromField(fromValue);
    const trimmedSubject = subjectValue.trim();
    const trimmedBody = bodyValue.trim();
    if (!from) {
      setFormError("From must be in `Name <email@example.com>` format.");
      return;
    }
    if (!toValue) {
      setFormError("Select a mailbox recipient.");
      return;
    }
    if (!trimmedSubject) {
      setFormError("Subject is required.");
      return;
    }
    if (!trimmedBody) {
      setFormError("Body is required.");
      return;
    }

    let linkedResources: Array<{ url: string }> = [];
    try {
      linkedResources = parseLinkedResources(linkedResourcesValue);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Invalid linked resources.");
      return;
    }

    const cc =
      ccValue && ccValue !== toValue
        ? [
            {
              display_name:
                recipientOptions.find((item) => item.profile.mailbox === ccValue)?.profile.name ?? ccValue,
              address: ccValue
            }
          ]
        : [];

    try {
      await mutation.mutateAsync({
        from,
        to: [
          {
            display_name:
              recipientOptions.find((item) => item.profile.mailbox === toValue)?.profile.name ?? toValue,
            address: toValue
          }
        ],
        cc,
        subject: trimmedSubject,
        body_text: trimmedBody,
        raw_body: trimmedBody,
        references: [],
        linked_resources: linkedResources
      });
    } catch {
      // Error state is surfaced through the mutation object.
    }
  }

  return (
    <>
      <section className="panel compose-form-page">
        <form className="field-list" onSubmit={handleSubmit}>
          <div className="compose-row">
            <label className="compose-label" htmlFor="compose-from">
              From
            </label>
            <input
              id="compose-from"
              className="input"
              type="text"
              value={fromValue}
              onChange={(event) => setFromValue(event.target.value)}
              placeholder="Human Operator <human.operator@example.com>"
              required
            />
          </div>

          <div className="compose-row">
            <label className="compose-label" htmlFor="compose-to">
              To
            </label>
            <select
              id="compose-to"
              className="input"
              value={toValue}
              onChange={(event) => setToValue(event.target.value)}
              disabled={isLoading || mutation.isPending || recipientOptions.length === 0}
              required
            >
              {recipientOptions.length === 0 ? (
                <option value="">{isLoading ? "Loading mailboxes..." : "No mailboxes available"}</option>
              ) : null}
              {recipientOptions.map((item) => (
                <option key={item.profile.mailbox} value={item.profile.mailbox}>
                  {item.profile.name} · {item.profile.mailbox}
                </option>
              ))}
            </select>
          </div>

          <div className="compose-row">
            <label className="compose-label" htmlFor="compose-cc">
              Cc
            </label>
            <select
              id="compose-cc"
              className="input"
              value={ccValue}
              onChange={(event) => setCcValue(event.target.value)}
              disabled={isLoading || mutation.isPending || recipientOptions.length === 0}
            >
              <option value="">No Cc</option>
              {recipientOptions
                .filter((item) => item.profile.mailbox !== toValue)
                .map((item) => (
                  <option key={item.profile.mailbox} value={item.profile.mailbox}>
                    {item.profile.name} · {item.profile.mailbox}
                  </option>
                ))}
            </select>
          </div>

          <div className="compose-row">
            <label className="compose-label" htmlFor="compose-subject">
              Subject
            </label>
            <input
              id="compose-subject"
              className="input"
              type="text"
              value={subjectValue}
              onChange={(event) => setSubjectValue(event.target.value)}
              placeholder="Need API follow-up"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="compose-body">Body</label>
            <textarea
              id="compose-body"
              className="textarea textarea-body textarea-plain"
              value={bodyValue}
              onChange={(event) => setBodyValue(event.target.value)}
              placeholder="Write the message that should be delivered to the selected mailbox."
              spellCheck
              required
            />
          </div>

          <div className="field">
            <label htmlFor="compose-linked-resources">Linked Resources</label>
            <input
              id="compose-linked-resources"
              className="input input-mono"
              type="text"
              value={linkedResourcesValue}
              onChange={(event) => setLinkedResourcesValue(event.target.value)}
              placeholder="https://github.com/xrdavies/agent-mail/pull/18"
            />
          </div>

          {submitError ? <p className="form-error">{submitError}</p> : null}
          {isError && recipientOptions.length === 0 ? (
            <p className="form-error">Failed to load mailbox recipients.</p>
          ) : null}

          <div className="button-row compose-actions">
            <Link className="button subtle" to="/overview">
              Cancel
            </Link>
            <button className="button button-primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </form>
      </section>

      {mutation.data ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Sent</h2>
              <p className="panel-copy">
                Human inbound mail created and delivered to {mutation.data.deliveries.length} mailbox
                {mutation.data.deliveries.length === 1 ? "" : "es"}.
              </p>
            </div>
            <div className="chip-row">
              <span className="chip success">sent</span>
            </div>
          </div>

          <div className="definition-list">
            <div>
              <dt>Email</dt>
              <dd>
                <Link to={`/mails/${encodeURIComponent(mutation.data.email.email_id)}`}>
                  {mutation.data.email.email_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Thread</dt>
              <dd>
                <Link to={`/threads/${encodeURIComponent(mutation.data.thread.thread_id)}`}>
                  {mutation.data.thread.thread_id}
                </Link>
              </dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{mutation.data.deliveries.map((item) => item.delivery_id).join(" · ")}</dd>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
