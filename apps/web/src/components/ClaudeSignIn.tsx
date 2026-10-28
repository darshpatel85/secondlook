import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import { LogoLoader } from "./AgentPulse";

type ClaudeSignInProps = {
  canRetry: boolean;
  disabled: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

export function ClaudeSignIn({ canRetry, disabled, onRetry, onDismiss }: ClaudeSignInProps) {
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const start = useMutation({
    mutationFn: () => api.startClaudeLogin(),
    onSuccess: ({ login }) => setStartedAt(login.startedAt),
  });

  const status = useQuery({
    queryKey: queryKeys.claudeAuth,
    queryFn: () => api.claudeAuth(),
    enabled: startedAt !== null,
    refetchInterval: 2000,
  });

  const login = status.data?.login;
  const thisLogin = login && login.startedAt === startedAt ? login : undefined;
  const finished = thisLogin !== undefined && !thisLogin.running;
  const signedIn = finished && thisLogin.error === null && status.data?.loggedIn === true;
  const failed = finished && !signedIn;

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    setStartedAt(null);
    if (canRetry) {
      onRetry();
    } else {
      onDismiss();
    }
  }, [signedIn, canRetry, onRetry, onDismiss]);

  const waiting = start.isPending || (startedAt !== null && !finished);

  return (
    <div className="chat-auth" role="alert">
      <strong>Claude sign-in has expired</strong>
      {waiting ? (
        <p className="small chat-auth-wait">
          <LogoLoader size={13} />
          Finish signing in in the browser window that opened.
          {thisLogin?.url ? (
            <>
              {" "}
              No window?{" "}
              <a href={thisLogin.url} target="_blank" rel="noreferrer">
                Open the sign-in page
              </a>
              .
            </>
          ) : null}
        </p>
      ) : (
        <p className="small">
          The agent could not log in to Claude. Sign in again{canRetry ? " and your last message will be sent again" : ""}.
        </p>
      )}
      {failed ? <p className="small error-text">Sign-in did not finish: {thisLogin.error ?? "still logged out"}</p> : null}
      {start.isError ? <p className="small error-text">{errorMessage(start.error)}</p> : null}
      <div className="row-actions">
        <button type="button" className="button primary" disabled={waiting || disabled} onClick={() => start.mutate()}>
          {failed ? "Try again" : "Sign in again"}
        </button>
        {canRetry ? (
          <button type="button" className="button" disabled={waiting || disabled} onClick={onRetry}>
            Retry last message
          </button>
        ) : null}
        <button type="button" className="button quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
