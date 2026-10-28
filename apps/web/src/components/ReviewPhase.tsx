import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import { useStoredFlag } from "../hooks/useStoredFlag";
import type { Finding, FindingInput, ReviewDetail, Severity, StepFile, StepWithFiles } from "../api/types";
import { newLinesInPatch, parsePatch } from "../lib/diff";
import { awaitingVerifier, dismissedByVerifier, inReview, severityOrder, visibleFindings } from "../lib/review";
import { CheckedList } from "./CheckedList";
import { CommentComposer } from "./CommentComposer";
import { DiffViewer } from "./DiffViewer";
import { FindingCard } from "./FindingCard";
import { FindingMarker } from "./FindingMarker";
import { QuestionCard } from "./QuestionCard";

export type ComposerState = { line: number | null; seed: string; key: number };

type ReviewPhaseProps = {
  detail: ReviewDetail;
  file: StepFile | null;
  step: StepWithFiles | null;
  composer: ComposerState | null;
  onComposer: (next: ComposerState | null) => void;
  onSetState: (file: StepFile, state: "in_progress" | "done") => void;
  statePending: boolean;
};

const statusLabels: Record<string, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
};

function viewFileUrl(detail: ReviewDetail, path: string, status: string): string {
  const { repo, review } = detail;
  const ref = status === "deleted" ? review.baseRef : review.headSha;
  const encode = (value: string) => value.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo.owner}/${repo.name}/blob/${encode(ref)}/${encode(path)}`;
}

function strongest(findings: Finding[]): Severity {
  return severityOrder.find((severity) => findings.some((finding) => finding.severity === severity)) ?? "nit";
}

function VerifierStatus({ checking, dismissed, prUrl }: { checking: Finding[]; dismissed: Finding[]; prUrl: string }) {
  if (checking.length === 0 && dismissed.length === 0) return null;
  return (
    <>
      {checking.length > 0 ? (
        <p className="muted small waiting" aria-live="polite">
          A second agent is checking {checking.length} more finding{checking.length === 1 ? "" : "s"} before showing {checking.length === 1 ? "it" : "them"}.
        </p>
      ) : null}
      {dismissed.length > 0 ? (
        <details className="block verifier-dismissed">
          <summary className="muted">
            {dismissed.length} finding{dismissed.length === 1 ? "" : "s"} dismissed by the verifier
          </summary>
          <p className="muted small">
            A second agent checked {dismissed.length === 1 ? "this" : "these"} against the code and thinks {dismissed.length === 1 ? "it is" : "they are"} wrong. Accept one anyway if you disagree.
          </p>
          {dismissed.map((finding) => (
            <FindingCard key={finding.id} finding={finding} prUrl={prUrl} showPath />
          ))}
        </details>
      ) : null}
    </>
  );
}

function FindingStack({
  findings,
  expanded,
  onToggle,
  prUrl,
}: {
  findings: Finding[];
  expanded: (finding: Finding) => boolean;
  onToggle: (finding: Finding) => void;
  prUrl: string;
}) {
  return (
    <>
      {findings.map((finding) => (
        <div key={finding.id} className="finding-slot">
          <FindingMarker finding={finding} expanded={expanded(finding)} onToggle={() => onToggle(finding)} />
          {expanded(finding) ? <FindingCard finding={finding} prUrl={prUrl} /> : null}
        </div>
      ))}
    </>
  );
}

export function ReviewPhase({ detail, file, step, composer, onComposer, onSetState, statePending }: ReviewPhaseProps) {
  const queryClient = useQueryClient();
  const reviewId = detail.review.id;
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const [diffOpened, setDiffOpened] = useState<Set<string>>(new Set());
  const [preferSinceReview, setPreferSinceReview] = useStoredFlag("ai-review:diff-since-review", true);
  const canDiffSinceReview = file !== null && detail.review.reviewedSha !== null && (detail.review.updatedPaths?.includes(file.path) ?? false);
  const sinceReview = canDiffSinceReview && preferSinceReview;

  const diff = useQuery({
    queryKey: [...queryKeys.review(reviewId), "diff", file?.id ?? "", detail.review.headSha, sinceReview ? "since-review" : "all"],
    queryFn: () => api.fileDiff(reviewId, file?.id ?? "", sinceReview),
    enabled: file !== null,
    staleTime: Infinity,
  });

  const addFinding = useMutation({
    mutationFn: (input: FindingInput) => api.addFinding(reviewId, input),
    onSuccess: () => {
      onComposer(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.review(reviewId) });
    },
  });

  const hunks = useMemo(() => (diff.data ? parsePatch(diff.data.patch) : []), [diff.data]);
  const linesInDiff = useMemo(() => newLinesInPatch(hunks), [hunks]);

  const isExpanded = (finding: Finding) => toggled.get(finding.id) ?? finding.status === "proposed";
  const toggle = (finding: Finding) =>
    setToggled((current) => {
      const next = new Map(current);
      next.set(finding.id, !isExpanded(finding));
      return next;
    });

  const prLevel = detail.findings.filter((finding) => finding.path === null && inReview(finding));
  const prLevelChecking = detail.findings.filter((finding) => finding.path === null && awaitingVerifier(finding));
  const prLevelDismissed = detail.findings.filter((finding) => finding.path === null && dismissedByVerifier(finding));

  if (!file) {
    return (
      <div className="phase">
        {detail.steps.length === 0 ? (
          <section className="block">
            <h2>{detail.review.phase === "done" ? "Review posted" : "Review"}</h2>
            <p className="prose">
              {detail.review.approachDecision === "reject"
                ? "The approach was rejected at the checkpoint, so there is no step plan. The agent's PR-level comment is below."
                : "No step plan has been recorded."}
            </p>
          </section>
        ) : (
          <section className="block">
            <h2>Review</h2>
            <p className="muted">Pick a file from the step list to start.</p>
          </section>
        )}
        {prLevel.length > 0 ? (
          <section className="block">
            <h2>Pull request level</h2>
            {prLevel.map((finding) => (
              <FindingCard key={finding.id} finding={finding} prUrl={detail.review.prUrl} />
            ))}
          </section>
        ) : null}
        <VerifierStatus checking={prLevelChecking} dismissed={prLevelDismissed} prUrl={detail.review.prUrl} />
      </div>
    );
  }

  const { shown, hidden, checking, dismissed } = visibleFindings(detail.findings, step, file);
  const routing = step?.routing ?? "full";
  const diffFolded = routing !== "full" && !diffOpened.has(file.id);
  const fileQuestions = detail.questions.filter((question) => question.path === file.path);
  const openQuestions = fileQuestions.filter((question) => !question.answer);
  const answeredQuestions = fileQuestions.filter((question) => question.answer);

  const widgets = new Map<number, ReactNode>();
  const marks = new Map<number, Severity>();
  const ranges = new Set<number>();
  const offDiff: Finding[] = [];
  const byLine = new Map<number, Finding[]>();

  for (const finding of shown) {
    if (!diffFolded && finding.line !== null && linesInDiff.has(finding.line)) {
      const list = byLine.get(finding.line) ?? [];
      list.push(finding);
      byLine.set(finding.line, list);
      if (finding.endLine && finding.endLine > finding.line) {
        for (let line = finding.line + 1; line <= finding.endLine; line += 1) {
          ranges.add(line);
        }
      }
    } else {
      offDiff.push(finding);
    }
  }

  const composerInline = composer !== null && composer.line !== null && linesInDiff.has(composer.line);
  const lineSet = new Set<number>([...byLine.keys(), ...(composerInline && composer.line !== null ? [composer.line] : [])]);

  for (const line of lineSet) {
    const findings = byLine.get(line) ?? [];
    if (findings.length > 0) {
      marks.set(line, strongest(findings));
    }
    widgets.set(
      line,
      <div className="line-widgets">
        <FindingStack findings={findings} expanded={isExpanded} onToggle={toggle} prUrl={detail.review.prUrl} />
        {composerInline && composer.line === line ? (
          <CommentComposer
            key={composer.key}
            path={file.path}
            line={line}
            initialBody={composer.seed}
            pending={addFinding.isPending}
            error={addFinding.isError ? errorMessage(addFinding.error) : null}
            onSubmit={(input) => addFinding.mutate(input)}
            onCancel={() => onComposer(null)}
          />
        ) : null}
      </div>,
    );
  }

  const done = file.state === "done";
  const status = diff.data?.status ?? "";

  return (
    <div className="file-view">
      <header className="file-head">
        <div className="file-head-main">
          <h2 className="file-title mono">{file.path}</h2>
          <div className="file-meta muted small">
            {status ? <span className="file-status" data-status={status}>{statusLabels[status] ?? status}</span> : null}
            {step ? (
              <span>
                {step.title} · {step.routing === "full" ? step.reviewMode.replaceAll("_", " ") : step.routing === "auto" ? "agent handles" : "findings only"}
              </span>
            ) : null}
            <span>{file.state.replaceAll("_", " ")}</span>
          </div>
        </div>
        {canDiffSinceReview ? (
          <div className="mode-toggle" role="group" aria-label="Which changes to show">
            <button
              type="button"
              className="mode-option"
              aria-pressed={sinceReview}
              title="Only what changed in this file since your last review"
              onClick={() => setPreferSinceReview(true)}
            >
              since last review
            </button>
            <button
              type="button"
              className="mode-option"
              aria-pressed={!sinceReview}
              title="Everything this PR changes in this file"
              onClick={() => setPreferSinceReview(false)}
            >
              all changes
            </button>
          </div>
        ) : null}
        <div className="file-head-actions">
          <a className="button" href={viewFileUrl(detail, file.path, status)} target="_blank" rel="noreferrer" title="Open the whole file on GitHub in a new tab">
            View file
          </a>
          <button
            type="button"
            className="button"
            disabled={composer !== null && composer.line === null}
            onClick={() => onComposer({ line: null, seed: "", key: Date.now() })}
          >
            Comment on file
          </button>
          {done ? (
            <button type="button" className="button quiet" disabled={statePending} onClick={() => onSetState(file, "in_progress")}>
              Reopen
            </button>
          ) : (
            <button type="button" className="button primary" disabled={statePending} onClick={() => onSetState(file, "done")}>
              {statePending ? "Saving" : "Mark done"}
            </button>
          )}
        </div>
      </header>

      {prLevel.length > 0 ? (
        <details className="pr-level">
          <summary>
            {prLevel.length} pull request level finding{prLevel.length === 1 ? "" : "s"}
          </summary>
          {prLevel.map((finding) => (
            <FindingCard key={finding.id} finding={finding} prUrl={detail.review.prUrl} />
          ))}
        </details>
      ) : null}

      {openQuestions.length > 0 ? (
        <div className="file-questions">
          {openQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </div>
      ) : null}

      {hidden.length > 0 ? (
        <aside className="callout look-first" aria-live="polite">
          <span className="callout-label">Look first</span>
          <p>The agent's findings for this file stay hidden until you mark it done. Your own comments show straight away.</p>
        </aside>
      ) : null}
      {step?.reviewMode === "look_first" && done && shown.some((finding) => finding.origin === "ai") ? (
        <aside className="callout look-first" aria-live="polite">
          <span className="callout-label">Look first</span>
          <p>
            Revealed {shown.filter((finding) => finding.origin === "ai").length} AI finding
            {shown.filter((finding) => finding.origin === "ai").length === 1 ? "" : "s"} now that the file is done.
          </p>
        </aside>
      ) : null}

      {composer !== null && !composerInline ? (
        <CommentComposer
          key={composer.key}
          path={file.path}
          line={composer.line}
          initialBody={composer.seed}
          pending={addFinding.isPending}
          error={addFinding.isError ? errorMessage(addFinding.error) : null}
          onSubmit={(input) => addFinding.mutate(input)}
          onCancel={() => onComposer(null)}
        />
      ) : null}

      {diffFolded ? (
        <aside className="callout routing-note">
          <span className="callout-label">{routing === "auto" ? "Handled by the agent" : "Findings only"}</span>
          <p>
            {routing === "auto"
              ? "This step is low risk, so it is left to the agent and the verifier unless they raise something."
              : "This step is medium risk, so you see the agent's findings rather than the whole diff."}{" "}
            {file.checked && file.checked.length > 0 ? "What the agent checked is listed below." : null}
          </p>
          <div className="row-actions">
            <button type="button" className="button" onClick={() => setDiffOpened((current) => new Set(current).add(file.id))}>
              Show diff
            </button>
          </div>
        </aside>
      ) : diff.isPending ? (
        <p className="muted waiting">Loading diff.</p>
      ) : diff.isError ? (
        <p className="error-text">{errorMessage(diff.error)}</p>
      ) : (
        <DiffViewer
          path={diff.data.path}
          hunks={hunks}
          widgets={widgets}
          marks={marks}
          ranges={ranges}
          activeLine={composer?.line ?? null}
          onPickLine={(line) => onComposer({ line, seed: "", key: Date.now() })}
        />
      )}

      {offDiff.length > 0 ? (
        <section className="block off-diff">
          <h2>{diffFolded ? "Findings" : "Findings outside the shown diff"}</h2>
          <FindingStack findings={offDiff} expanded={isExpanded} onToggle={toggle} prUrl={detail.review.prUrl} />
        </section>
      ) : null}

      <VerifierStatus checking={checking} dismissed={dismissed} prUrl={detail.review.prUrl} />

      <CheckedList checked={file.checked} />

      {answeredQuestions.length > 0 ? (
        <section className="block">
          <h2>Answered questions</h2>
          {answeredQuestions.map((question) => (
            <QuestionCard key={question.id} question={question} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
