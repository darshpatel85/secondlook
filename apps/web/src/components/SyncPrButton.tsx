import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { ReviewDetail } from "../api/types";
import { ConfirmPopover } from "./ConfirmPopover";

export function SyncPrButton({ detail }: { detail: ReviewDetail }) {
  const queryClient = useQueryClient();
  const [upToDate, setUpToDate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);
  const sync = useMutation({
    mutationFn: () => api.syncPullRequest(detail.review.id),
    onSuccess: async (result) => {
      setUpToDate(!result.changed);
      await queryClient.invalidateQueries({ queryKey: queryKeys.review(detail.review.id) });
    },
  });

  useEffect(() => {
    if (!upToDate) return;
    const timer = window.setTimeout(() => setUpToDate(false), 4000);
    return () => window.clearTimeout(timer);
  }, [upToDate]);

  const preparing = detail.review.phase === "preparing";
  return (
    <span className="rerun confirm-anchor">
      <button
        type="button"
        className="button"
        disabled={preparing || sync.isPending || detail.agentBusy}
        title={detail.agentBusy ? "Wait for the agent to finish" : "Pull the latest PR changes from GitHub"}
        aria-expanded={confirming}
        onClick={() => setConfirming(!confirming)}
      >
        {sync.isPending ? "Refetching" : "Refetch PR"}
      </button>
      {confirming ? (
        <ConfirmPopover
          message="Fetch the latest commits and description from GitHub? If the PR changed, the review restarts from Requirements and later steps are marked out of date. Your findings are kept."
          confirmLabel="Refetch"
          onCancel={cancel}
          onConfirm={() => {
            setConfirming(false);
            sync.mutate();
          }}
        />
      ) : null}
      {upToDate ? <span className="muted small">already up to date</span> : null}
      {sync.isError ? <span className="error-text small">{errorMessage(sync.error)}</span> : null}
    </span>
  );
}
