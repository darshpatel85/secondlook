import { reviewStepKeys, type ReviewDetail, type ReviewStepKey } from "../api/types";
import { stepLabels, stepStatus, type StepStatus } from "../lib/stepper";
import { LogoLoader } from "./AgentPulse";

const statusText: Record<StepStatus, string> = {
  done: "done",
  current: "current",
  stale: "out of date",
  locked: "not started",
};

type Props = {
  detail: ReviewDetail;
  viewing: ReviewStepKey;
  onSelect: (step: ReviewStepKey) => void;
};

export function ReviewStepper({ detail, viewing, onSelect }: Props) {
  return (
    <nav className="stepper" aria-label="Review steps">
      <ol>
        {reviewStepKeys.map((step, index) => {
          const status = stepStatus(detail, step);
          const working = status === "current" && detail.agentBusy;
          return (
            <li key={step} className="stepper-item" data-status={status} data-working={working || undefined}>
              <button
                type="button"
                className="stepper-button"
                aria-current={viewing === step ? "step" : undefined}
                disabled={status === "locked"}
                onClick={() => onSelect(step)}
              >
                <span className="stepper-dot" aria-hidden="true">
                  {working ? <LogoLoader size={14} /> : status === "done" ? "✓" : status === "stale" ? "!" : index + 1}
                </span>
                <span className="stepper-text">
                  <span className="stepper-label">{stepLabels[step]}</span>
                  <span className="stepper-status">{working ? "agent working" : statusText[status]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
