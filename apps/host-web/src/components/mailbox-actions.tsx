import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { HostWebAvailableActions } from "../lib/api.js";
import {
  clearMailboxFailure,
  disableMailbox,
  enableMailbox,
  resumeMailbox
} from "../lib/api.js";

export function MailboxActions(props: {
  mailbox: string;
  actions: HostWebAvailableActions;
  showClearFailure?: boolean;
}) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resume = useMutation({
    mutationFn: () => resumeMailbox(props.mailbox),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const enable = useMutation({
    mutationFn: () => enableMailbox(props.mailbox),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const disable = useMutation({
    mutationFn: () => disableMailbox(props.mailbox),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const clearFailure = useMutation({
    mutationFn: () => clearMailboxFailure(props.mailbox),
    onSuccess: async () => {
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["host-web"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const busy =
    resume.isPending || enable.isPending || disable.isPending || clearFailure.isPending;

  return (
    <div className="action-stack">
      <div className="button-row table-actions">
        {props.actions.can_enable ? (
          <button className="button subtle" disabled={busy} type="button" onClick={() => enable.mutate()}>
            enable
          </button>
        ) : null}

        {props.actions.can_disable ? (
          <button className="button subtle" disabled={busy} type="button" onClick={() => disable.mutate()}>
            disable
          </button>
        ) : null}

        <button
          className={`button subtle${props.actions.can_resume_now ? "" : " is-disabled"}`}
          disabled={busy || !props.actions.can_resume_now}
          type="button"
          onClick={() => resume.mutate()}
        >
          resume now
        </button>

        {props.showClearFailure && props.actions.can_clear_failure ? (
          <button className="button subtle" disabled={busy} type="button" onClick={() => clearFailure.mutate()}>
            clear failure
          </button>
        ) : null}
      </div>

      {errorMessage ? <p className="meta error-text">{errorMessage}</p> : null}
    </div>
  );
}
