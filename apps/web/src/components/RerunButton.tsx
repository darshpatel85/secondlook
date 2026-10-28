import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { ReviewDetail, ReviewStepKey } from "../api/types";
import { laterStepsWithData, stepLabels } from "../lib/stepper";
import { ConfirmPopover } from "./ConfirmPopover";

type Props = {
  detail: ReviewDetail;
  step: ReviewStepKey;
  label: string;
  notes?: string;
  primary?: boolean;
  disabled?: boolean;
  onDone?: () => void;
};

export function RerunButton({ detail, step, label, notes, primary = false, disabled = false, onDone }: Props) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);
  const rerun = useMutation({
    mutationFn: () => api.rerunStep(detail.review.id, step, notes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.review(detail.review.id) });
      onDone?.();
    },
  });

  const affected = laterStepsWithData(detail, step);
  const onClick = () => {
    if (affected.length > 0) setConfirming(!confirming);
    else rerun.mutate();
  };

  return (
    <span className="rerun confirm-anchor">
      <button
        type="button"
        className={primary ? "button primary" : "button"}
        disabled={disabled || rerun.isPending || detail.agentBusy}
        onClick={onClick}
      >
        {rerun.isPending ? "Starting" : label}
      </button>
      {confirming ? (
        <ConfirmPopover
          message={`This marks ${affected.map((key) => stepLabels[key]).join(", ")} as out of date until you re-run them.`}
          confirmLabel={label}
          onCancel={cancel}
          onConfirm={() => {
            setConfirming(false);
            rerun.mutate();
          }}
        />
      ) : null}
      {detail.agentBusy ? <span className="muted small">wait for the agent to finish</span> : null}
      {rerun.isError ? <span className="error-text small">{errorMessage(rerun.error)}</span> : null}
    </span>
  );
}

export function StaleNotice({ step }: { step: ReviewStepKey }) {
  return (
    <p className="stale-notice" role="status">
      {stepLabels[step]} is out of date because an earlier step changed. You can still read it; re-run it to refresh.
    </p>
  );
}
