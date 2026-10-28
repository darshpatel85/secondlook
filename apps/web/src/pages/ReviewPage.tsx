import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api, isMock, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import {
  reviewPhases,
  type ProgressState,
  type ReviewDetail,
  type ReviewStepKey,
  type StepFile,
  type StepPatch,
  type StepWithFiles,
} from "../api/types";
import { AgentPulse, WorkingCard, type PulseActivity } from "../components/AgentPulse";
import { ChatPanel } from "../components/ChatPanel";
import { CopyButton } from "../components/CopyButton";
import { Layout } from "../components/Layout";
import { MemoryDiff } from "../components/MemoryDiff";
import { PhaseBadge } from "../components/PhaseBadge";
import { QueuePanel } from "../components/QueuePanel";
import { ReviewPhase, type ComposerState } from "../components/ReviewPhase";
import { RerunButton, StaleNotice } from "../components/RerunButton";
import { ReviewStepper } from "../components/ReviewStepper";
import { StepList } from "../components/StepList";
import { SyncPrButton } from "../components/SyncPrButton";
import { ApproachStep, IntentStep, RequirementsStep } from "../components/StepViews";
import { useReviewEvents } from "../hooks/useReviewEvents";
import { useStoredFlag } from "../hooks/useStoredFlag";
import {
  defaultFile,
  fileProgress,
  neighbourFile,
  nextUndoneFile,
  onlyUpdatedFiles,
  rubberStampedFiles,
  selectableFiles,
  stepForFile,
  visibleFindings,
  withoutHandledFiles,
  withoutTestFiles,
} from "../lib/review";
import { currentStep, stepStatus } from "../lib/stepper";

function StepContent({
  detail,
  step,
  onRerun,
  activity,
}: {
  detail: ReviewDetail;
  step: ReviewStepKey;
  onRerun: () => void;
  activity: PulseActivity[];
}) {
  if (detail.review.phase === "failed" && step === currentStep(detail)) {
    return (
      <div className="phase">
        <section className="block">
          <h2>Review failed</h2>
          <pre className="error-box">{detail.review.phaseError ?? "No error message was recorded."}</pre>
          <p className="muted small">Re-run this step to try again.</p>
        </section>
      </div>
    );
  }
  switch (step) {
    case "requirements":
      return <RequirementsStep detail={detail} onRerun={onRerun} activity={activity} />;
    case "intent":
      return <IntentStep detail={detail} onRerun={onRerun} />;
    case "approach":
      return <ApproachStep detail={detail} onRerun={onRerun} activity={activity} />;
    case "code_review":
      return (
        <div className="phase">
          <WorkingCard text="The agent is building the step plan." activity={activity} />
        </div>
      );
  }
}

function CodeReviewBar({ detail, onRerun }: { detail: ReviewDetail; onRerun: () => void }) {
  const stale = stepStatus(detail, "code_review") === "stale";
  const canRerun = detail.review.approachDecision === "proceed";
  if (!stale && !canRerun) return null;
  return (
    <div className="code-review-bar">
      {stale ? <StaleNotice step="code_review" /> : null}
      {canRerun ? <RerunButton detail={detail} step="code_review" label="Re-run code review" onDone={onRerun} /> : null}
    </div>
  );
}

function MockPhaseSwitcher({ current }: { current: string }) {
  return (
    <nav className="mock-phases" aria-label="Mock phase">
      {reviewPhases.map((phase) => (
        <Link key={phase} to={`?phase=${phase}`} aria-current={phase === current ? "page" : undefined}>
          {phase}
        </Link>
      ))}
    </nav>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.review(id ?? ""),
    queryFn: () => api.getReview(id ?? ""),
    enabled: Boolean(id),
  });
  const events = useReviewEvents(id);
  const liveActivity = useMemo(() => events.activity.filter((entry) => entry.kind === "tool"), [events.activity]);
  const chat = useMutation({
    mutationFn: (text: string) => api.sendChat(id ?? "", text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.review(id ?? "") }),
  });

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [lastLine, setLastLine] = useState<number | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  const data = detail.data;
  const steps = useMemo(() => data?.steps ?? [], [data]);
  const [hideTests, setHideTests] = useStoredFlag("ai-review:hide-tests", true);
  const [stepsOpen, setStepsOpen] = useStoredFlag("ai-review:steps-open", true);
  const [chatOpen, setChatOpen] = useStoredFlag("ai-review:chat-open", true);
  const chatCount = data?.chat.length ?? 0;
  const [seenChat, setSeenChat] = useState<number | null>(null);
  useEffect(() => {
    if (data && (chatOpen || seenChat === null)) setSeenChat(chatCount);
  }, [data, chatOpen, chatCount, seenChat]);
  const unreadChat = chatOpen || seenChat === null ? 0 : Math.max(0, chatCount - seenChat);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (event.key === "[") setStepsOpen(!stepsOpen);
      if (event.key === "]") setChatOpen(!chatOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepsOpen, chatOpen, setStepsOpen, setChatOpen]);
  const [onlyUpdated, setOnlyUpdated] = useStoredFlag("ai-review:only-updated", true);
  const updatedList = data?.review.updatedPaths ?? null;
  const updatedPaths = useMemo(() => (updatedList ? new Set(updatedList) : null), [updatedList]);
  const navSteps = useMemo(() => {
    const routed = data ? withoutHandledFiles(steps, data.findings, data.questions) : steps;
    const shown = hideTests ? withoutTestFiles(routed) : routed;
    return onlyUpdated && updatedPaths ? onlyUpdatedFiles(shown, updatedPaths) : shown;
  }, [steps, data, hideTests, onlyUpdated, updatedPaths]);
  const reviewLive = data ? ["review", "posting", "done"].includes(data.review.phase) : false;
  const [pickedStep, setPickedStep] = useState<ReviewStepKey | null>(null);
  const activeStep = data ? currentStep(data) : "requirements";
  const viewStep = pickedStep ?? activeStep;
  const inReview = viewStep === "code_review" && data !== undefined && data.review.phase !== "planning" && (reviewLive || data.steps.length > 0);
  const selectedFile = useMemo(
    () => (selectedFileId ? (selectableFiles(steps).find((file) => file.id === selectedFileId) ?? null) : null),
    [steps, selectedFileId],
  );
  const selectedStep = stepForFile(steps, selectedFile);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.review(id ?? "") });

  const openFile = useMutation({
    mutationFn: (file: StepFile) => api.patchFile(id ?? "", file.id, "in_progress"),
    onSuccess: invalidate,
  });
  const changeFileState = useMutation({
    mutationFn: ({ file, state }: { file: StepFile; state: ProgressState }) => api.patchFile(id ?? "", file.id, state),
    onSuccess: invalidate,
  });
  const patchStep = useMutation({
    mutationFn: ({ step, patch }: { step: StepWithFiles; patch: StepPatch }) => api.patchStep(id ?? "", step.id, patch),
    onSuccess: invalidate,
  });

  const open = openFile.mutate;
  const selectFile = useCallback(
    (file: StepFile) => {
      setSelectedFileId(file.id);
      setComposer(null);
      setLastLine(null);
      if (reviewLive && file.state === "not_started") {
        open(file);
      }
    },
    [open, reviewLive],
  );

  const setFileState = (file: StepFile, state: "in_progress" | "done") => {
    changeFileState.mutate(
      { file, state },
      {
        onSuccess: () => {
          if (state === "done") {
            const next = nextUndoneFile(navSteps, file.id);
            if (next && next.id !== file.id) {
              selectFile(next);
            }
          }
        },
      },
    );
  };
  const fileError = openFile.error ?? changeFileState.error ?? patchStep.error;

  useEffect(() => {
    if (inReview && selectedFileId === null) {
      const first = defaultFile(navSteps);
      if (first) {
        setSelectedFileId(first.id);
      }
    }
  }, [inReview, navSteps, selectedFileId]);

  useEffect(() => {
    if (!inReview || queueOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) {
        return;
      }
      if (event.key === "j" || event.key === "k") {
        const next = neighbourFile(navSteps, selectedFileId, event.key === "j" ? 1 : -1);
        if (next && next.id !== selectedFileId) {
          event.preventDefault();
          selectFile(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inReview, queueOpen, navSteps, selectedFileId, selectFile]);

  const onComposer = (next: ComposerState | null) => {
    setComposer(next);
    if (next && next.line !== null) {
      setLastLine(next.line);
    }
  };

  if (!id) {
    return (
      <Layout>
        <p className="error-text">No review id in the URL.</p>
      </Layout>
    );
  }

  if (detail.isPending) {
    return (
      <Layout wide>
        <div className="phase centred">
          <span className="spinner" role="img" aria-label="loading" />
          <p className="muted">Loading review.</p>
        </div>
      </Layout>
    );
  }

  if (detail.isError || !data) {
    return (
      <Layout>
        <p className="error-text">{detail.isError ? errorMessage(detail.error) : "Review not found"}</p>
        <Link to="/">Back to the home page</Link>
      </Layout>
    );
  }

  const { review, repo } = data;
  const progress = fileProgress(navSteps);
  const flagged = new Map<string, StepFile[]>();
  for (const step of steps) {
    const files = rubberStampedFiles(data, step);
    if (files.length > 0) {
      flagged.set(step.id, files);
    }
  }
  const flaggedCount = [...flagged.values()].reduce((sum, files) => sum + files.length, 0);
  const findingCounts = new Map<string, number>();
  for (const step of steps) {
    for (const file of step.files) {
      const { shown } = visibleFindings(data.findings, step, file);
      const live = shown.filter((finding) => finding.status !== "rejected");
      if (live.length > 0) {
        findingCounts.set(file.path, live.length);
      }
    }
  }
  const queued = data.findings.filter((finding) => finding.status === "accepted").length;

  return (
    <Layout wide>
      <div className="review">
        <header className="review-header">
          <div className="review-heading">
            <h1 className="review-title">{review.title}</h1>
            <div className="review-meta">
              <span className="pr-link">
                <a href={review.prUrl} target="_blank" rel="noreferrer">
                  #{review.prNumber}
                </a>
                <CopyButton text={review.prUrl} label="Copy PR link" />
              </span>
              <span>
                {repo.owner}/{repo.name}
              </span>
              {review.author ? <span>by {review.author}</span> : null}
              <span className="muted">
                {review.headRef} into {review.baseRef}
              </span>
              {review.verdict === "approve" ? <span className="verdict-label" data-verdict="approve">approved</span> : null}
              {review.verdict === "request_changes" ? (
                <span className="verdict-label" data-verdict="request_changes">
                  changes requested
                </span>
              ) : null}
            </div>
          </div>
          <div className="review-status">
            {reviewLive ? (
              <>
                <span className="progress" role="status" aria-label={`${progress.done} of ${progress.total} files done`}>
                  <span className="progress-bar" aria-hidden="true">
                    <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%" }} />
                  </span>
                  {progress.done}/{progress.total} files
                </span>
                {flaggedCount > 0 ? (
                  <span
                    className="warn-icon"
                    role="img"
                    aria-label={`${flaggedCount} high risk file${flaggedCount === 1 ? "" : "s"} marked done without comments`}
                    title={`${flaggedCount} high risk file${flaggedCount === 1 ? "" : "s"} marked done without comments or chat. See the step list.`}
                  >
                    !
                  </span>
                ) : null}
                <button type="button" className="button" onClick={() => setQueueOpen(true)} aria-haspopup="dialog">
                  Queue ({queued})
                </button>
              </>
            ) : null}
            <SyncPrButton detail={data} />
            {data.agentBusy ? (
              <AgentPulse />
            ) : (
              <span className="muted small" role="status">
                agent idle
              </span>
            )}
            {events.status !== "open" ? <span className="muted small">{events.status}</span> : null}
            <PhaseBadge phase={review.phase} />
          </div>
        </header>
        {review.setupWarnings.length > 0 ? (
          <div className="stale-notice setup-warnings" role="status">
            <strong>Setup warnings</strong>
            <ul>
              {review.setupWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {isMock ? <MockPhaseSwitcher current={review.phase} /> : null}
        <div className="review-toolbar">
          <button
            type="button"
            className="drawer-toggle"
            aria-pressed={stepsOpen}
            aria-controls="steps-drawer"
            title="Show or hide the steps panel ( [ )"
            onClick={() => setStepsOpen(!stepsOpen)}
          >
            <span className="drawer-icon" data-side="left" aria-hidden="true" />
            Steps
          </button>
          <ReviewStepper detail={data} viewing={viewStep} onSelect={(step) => setPickedStep(step === activeStep ? null : step)} />
          <button
            type="button"
            className="drawer-toggle"
            aria-pressed={chatOpen}
            aria-controls="chat-drawer"
            title="Show or hide the chat panel ( ] )"
            onClick={() => setChatOpen(!chatOpen)}
          >
            Chat
            {unreadChat > 0 ? (
              <span className="drawer-badge" aria-label={`${unreadChat} new message${unreadChat === 1 ? "" : "s"}`}>
                {unreadChat}
              </span>
            ) : null}
            <span className="drawer-icon" data-side="right" aria-hidden="true" />
          </button>
        </div>

        <div className="review-grid" data-steps={stepsOpen ? "open" : "closed"} data-chat={chatOpen ? "open" : "closed"}>
          <aside className="pane pane-left" id="steps-drawer" aria-label="Steps" hidden={!stepsOpen}>
            {inReview ? (
              <StepList
                steps={steps}
                selectedFileId={selectedFileId}
                onSelectFile={selectFile}
                onChangeMode={(step, mode) => patchStep.mutate({ step, patch: { reviewMode: mode } })}
                onChangeRouting={(step, routing) => patchStep.mutate({ step, patch: { routing } })}
                findings={data.findings}
                flagged={flagged}
                findingCounts={findingCounts}
                questions={data.questions}
                hideTests={hideTests}
                onHideTestsChange={setHideTests}
                updatedPaths={updatedPaths}
                onlyUpdated={onlyUpdated}
                onOnlyUpdatedChange={setOnlyUpdated}
                agentBusy={reviewLive ? data.agentBusy : undefined}
              />
            ) : (
              <StepList steps={steps} findings={data.findings} questions={data.questions} />
            )}
            {fileError ? <p className="error-text small">{errorMessage(fileError)}</p> : null}
          </aside>
          <section className="pane pane-centre" aria-label={inReview ? "File" : "Phase"}>
            {viewStep === "code_review" ? <CodeReviewBar detail={data} onRerun={() => setPickedStep(null)} /> : null}
            {inReview && review.phase === "done" ? <MemoryDiff reviewId={review.id} repoId={repo.id} /> : null}
            {inReview ? (
              <ReviewPhase
                detail={data}
                file={selectedFile}
                step={selectedStep}
                composer={composer}
                onComposer={onComposer}
                onSetState={setFileState}
                statePending={changeFileState.isPending}
              />
            ) : (
              <StepContent detail={data} step={viewStep} onRerun={() => setPickedStep(null)} activity={liveActivity} />
            )}
          </section>
          <aside className="pane pane-right" id="chat-drawer" aria-label="Chat" hidden={!chatOpen}>
            <ChatPanel
              messages={data.chat}
              activity={events.activity}
              history={data.activity}
              agentBusy={data.agentBusy}
              sending={chat.isPending}
              error={chat.isError ? errorMessage(chat.error) : null}
              onSend={(text) => chat.mutate(text)}
              onMakeComment={inReview && selectedFile ? (text) => onComposer({ line: lastLine, seed: text, key: Date.now() }) : undefined}
            />
          </aside>
        </div>
        {queueOpen ? <QueuePanel detail={data} onClose={() => setQueueOpen(false)} /> : null}
      </div>
    </Layout>
  );
}
