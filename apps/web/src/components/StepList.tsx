import type { AgentQuestion, Finding, ProgressState, ReviewMode, StepFile, StepRouting, StepWithFiles } from "../api/types";
import { isTestFile, splitHandled } from "../lib/review";
import { ModeToggle } from "./ModeToggle";
import { LogoLoader } from "./AgentPulse";
import { RoutingToggle } from "./RoutingToggle";
import { QuestionCard } from "./QuestionCard";

const stateLabels: Record<ProgressState, string> = {
  not_started: "not started",
  in_progress: "in progress",
  done: "done",
};

type StepListProps = {
  steps: StepWithFiles[];
  selectedFileId?: string | null;
  onSelectFile?: (file: StepFile) => void;
  onChangeMode?: (step: StepWithFiles, mode: ReviewMode) => void;
  onChangeRouting?: (step: StepWithFiles, routing: StepRouting) => void;
  findings?: Finding[];
  flagged?: Map<string, StepFile[]>;
  findingCounts?: Map<string, number>;
  questions?: AgentQuestion[];
  hideTests?: boolean;
  onHideTestsChange?: (hide: boolean) => void;
  updatedPaths?: Set<string> | null;
  onlyUpdated?: boolean;
  onOnlyUpdatedChange?: (only: boolean) => void;
  agentBusy?: boolean;
};

function RiskReason({ reason }: { reason: string }) {
  const match = /^`([^`]+)`\s*(.*)$/.exec(reason);
  const path = match?.[1] ?? null;
  const why = match?.[2] ?? reason;
  const name = path ? path.split("/").pop() : null;
  return (
    <p className="risk-reason small" title={path ? `${path} ${why}` : why}>
      Raised to full review: {name ? <span className="mono">{name}</span> : null} {why}
    </p>
  );
}

function FilterSwitch({ on, label, title, onChange }: { on: boolean; label: string; title: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="tests-switch" title={title} onClick={() => onChange(!on)}>
      <span className="tests-switch-track" aria-hidden="true">
        <span className="tests-switch-thumb" />
      </span>
      {label}
    </button>
  );
}

function FileRow({
  file,
  selected,
  count,
  updated,
  onSelect,
  agentBusy,
}: {
  file: StepFile;
  selected: boolean;
  count: number | undefined;
  updated: boolean;
  onSelect?: (file: StepFile) => void;
  agentBusy?: boolean;
}) {
  const pending = agentBusy !== undefined && file.checked === null;
  const content = (
    <>
      <span className="state-dot" data-state={file.state} role="img" aria-label={stateLabels[file.state]} />
      <span className="file-path" title={file.path}>
        {file.path}
      </span>
      {updated ? <span className="file-updated" role="img" aria-label="changed since your last review" title="Changed since your last review" /> : null}
      {pending ? (
        <span className="agent-pending" title={agentBusy ? "The agent is still reviewing this file" : "The agent has not reviewed this file yet. It picks up missed files when its up-front pass ends."}>
          {agentBusy ? <LogoLoader size={13} /> : "not reviewed"}
        </span>
      ) : null}
      {count ? (
        <span className="file-count" aria-label={`${count} finding${count === 1 ? "" : "s"}`}>
          {count}
        </span>
      ) : null}
    </>
  );
  if (!onSelect) {
    return <li className="file-row">{content}</li>;
  }
  return (
    <li className="file-row" data-selected={selected || undefined}>
      <button type="button" className="file-button" aria-current={selected ? "true" : undefined} onClick={() => onSelect(file)}>
        {content}
      </button>
    </li>
  );
}

export function StepList({
  steps,
  selectedFileId = null,
  onSelectFile,
  onChangeMode,
  onChangeRouting,
  findings = [],
  flagged,
  findingCounts,
  questions = [],
  hideTests = false,
  onHideTestsChange,
  updatedPaths = null,
  onlyUpdated = false,
  onOnlyUpdatedChange,
  agentBusy,
}: StepListProps) {
  const testCount = steps.reduce((sum, step) => sum + step.files.filter((file) => !file.skipped && isTestFile(file.path)).length, 0);
  const updatedCount = updatedPaths ? steps.reduce((sum, step) => sum + step.files.filter((file) => updatedPaths.has(file.path)).length, 0) : 0;
  const filterUpdated = onlyUpdated && updatedPaths !== null;
  const isShown = (file: StepFile) => !(hideTests && isTestFile(file.path)) && !(filterUpdated && !updatedPaths.has(file.path));
  const header = (
    <div className="steplist-head">
      <h2 className="pane-title">Steps</h2>
      <div className="steplist-filters">
        {onOnlyUpdatedChange && updatedPaths ? (
          <FilterSwitch
            on={onlyUpdated}
            label={`Only updated (${updatedCount})`}
            title="Show only files that changed since your last review"
            onChange={onOnlyUpdatedChange}
          />
        ) : null}
        {onHideTestsChange && testCount > 0 ? (
          <FilterSwitch
            on={hideTests}
            label="Hide tests"
            title={`${testCount} test file${testCount === 1 ? "" : "s"} in this review`}
            onChange={onHideTestsChange}
          />
        ) : null}
      </div>
    </div>
  );
  const shownFiles = steps.flatMap((step) => step.files.filter((file) => !file.skipped && isShown(file)));
  const reviewedCount = shownFiles.filter((file) => file.checked !== null).length;
  const openQuestions = questions.filter((question) => question.path === null && !question.answer);

  if (steps.length === 0) {
    return (
      <div className="steplist">
        {header}
        <p className="muted">No step plan yet.</p>
      </div>
    );
  }

  return (
    <div className="steplist">
      {header}
      {agentBusy !== undefined && shownFiles.length > 0 ? (
        <p className="agent-review-status small" role="status">
          {agentBusy && reviewedCount < shownFiles.length ? <LogoLoader size={13} /> : null}
          {reviewedCount === shownFiles.length
            ? `Agent reviewed all ${shownFiles.length} files`
            : `Agent reviewed ${reviewedCount} of ${shownFiles.length} files`}
        </p>
      ) : null}
      {openQuestions.length > 0 ? (
        <div className="step-questions">
          {openQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </div>
      ) : null}
      {onSelectFile ? (
        <p className="muted small keys-hint">
          <kbd>j</kbd> next file, <kbd>k</kbd> previous
        </p>
      ) : null}
      <ol className="step-items">
        {steps.map((step, index) => {
          const reviewable = step.files.filter((file) => !file.skipped);
          const { handled } = splitHandled(step, findings, questions);
          const live = reviewable.filter((file) => isShown(file) && !handled.includes(file));
          if (filterUpdated && reviewable.length > 0 && live.length === 0) return null;
          const hiddenTests = hideTests ? reviewable.filter((file) => isTestFile(file.path)).length : 0;
          const hiddenUnchanged = reviewable.length - live.length - hiddenTests - handled.length;
          const skipped = step.files.filter((file) => file.skipped);
          const done = live.filter((file) => file.state === "done").length;
          const flags = flagged?.get(step.id) ?? [];
          return (
            <li key={step.id} className="step" data-state={step.state}>
              <div className="step-head">
                <span className="step-index">{index + 1}</span>
                <span className="step-title">{step.title}</span>
                {flags.length > 0 ? (
                  <span
                    className="warn-icon"
                    role="img"
                    aria-label={`Possible rubber stamp: ${flags.map((file) => file.path).join(", ")} marked done with no comments`}
                    title={`Possible rubber stamp: ${flags.map((file) => file.path).join(", ")} marked done with no comments or chat`}
                  >
                    !
                  </span>
                ) : null}
                {step.kind === "design" ? <span className="kind-badge">design</span> : null}
                <span className="risk-badge" data-risk={step.risk}>
                  {step.risk}
                </span>
              </div>
              <p className="step-purpose">{step.purpose}</p>
              {step.riskReason ? <RiskReason reason={step.riskReason} /> : null}
              <div className="step-controls">
                <span className="muted small">{live.length === 0 && handled.length > 0 ? "nothing needs you" : `${done}/${live.length} done`}</span>
                {onChangeRouting ? (
                  <RoutingToggle value={step.routing} stepTitle={step.title} onChange={(routing) => onChangeRouting(step, routing)} />
                ) : null}
              </div>
              {step.routing === "full" ? (
                <div className="step-controls">
                  <span />
                  {onChangeMode ? (
                    <ModeToggle value={step.reviewMode} stepTitle={step.title} onChange={(mode) => onChangeMode(step, mode)} />
                  ) : (
                    <span className="muted small">{step.reviewMode.replaceAll("_", " ")}</span>
                  )}
                </div>
              ) : null}
              <ul className="file-rows">
                {live.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    selected={file.id === selectedFileId}
                    count={findingCounts?.get(file.path)}
                    updated={updatedPaths?.has(file.path) ?? false}
                    onSelect={onSelectFile}
                    agentBusy={agentBusy}
                  />
                ))}
              </ul>
              {handled.length > 0 ? (
                <details className="skipped handled">
                  <summary className="muted small">
                    {handled.length} file{handled.length === 1 ? "" : "s"} handled by the agent
                  </summary>
                  <ul className="file-rows">
                    {handled.map((file) => (
                      <FileRow
                        key={file.id}
                        file={file}
                        selected={file.id === selectedFileId}
                        count={undefined}
                        updated={updatedPaths?.has(file.path) ?? false}
                        onSelect={onSelectFile}
                      />
                    ))}
                  </ul>
                </details>
              ) : null}
              {hiddenTests > 0 ? (
                <p className="muted small hidden-tests">
                  {hiddenTests} test file{hiddenTests === 1 ? "" : "s"} hidden
                </p>
              ) : null}
              {hiddenUnchanged > 0 ? (
                <p className="muted small hidden-tests">
                  {hiddenUnchanged} unchanged file{hiddenUnchanged === 1 ? "" : "s"} hidden
                </p>
              ) : null}
              {skipped.length > 0 ? (
                <details className="skipped">
                  <summary className="muted small">
                    {skipped.length} file{skipped.length === 1 ? "" : "s"} skipped
                  </summary>
                  <ul className="file-rows">
                    {skipped.map((file) => (
                      <li key={file.id} className="file-row" data-skipped="true">
                        <span className="state-dot" data-state="skipped" role="img" aria-label="skipped" />
                        <span className="skipped-file">
                          <span className="file-path" title={file.path}>
                            {file.path}
                          </span>
                          {file.skipReason ? <span className="muted">{file.skipReason}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
