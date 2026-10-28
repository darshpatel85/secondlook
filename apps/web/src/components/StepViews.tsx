import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { ContextGap, ReviewDetail } from "../api/types";
import { isRerunning, stepStatus } from "../lib/stepper";
import { WorkingCard, type PulseActivity } from "./AgentPulse";
import { ApproachView } from "./ApproachView";
import { CheckpointPhase } from "./CheckpointPhase";
import { ContextChecklistView } from "./ContextChecklistView";
import { RerunButton, StaleNotice } from "./RerunButton";

type StepProps = { detail: ReviewDetail; onRerun: () => void; activity?: PulseActivity[] };



export function RequirementsStep({ detail, onRerun, activity }: StepProps) {
  const { review, gaps } = detail;
  const integrations = useQuery({ queryKey: queryKeys.integrations, queryFn: () => api.integrations() });
  const jiraBase = integrations.data?.settings.jira?.siteUrl?.replace(/\/$/, "");
  const running = review.phase === "preparing" || (detail.agentBusy && (review.phase === "context" || isRerunning(review, "requirements")));

  return (
    <div className="phase">
      {running ? <WorkingCard text="The agent is reading the ticket, design and diff." activity={activity} /> : null}
      <section className="block">
        <h2>Intent</h2>
        {review.intentSummary ? (
          <p className="prose">{review.intentSummary}</p>
        ) : (
          <p className="muted waiting">Waiting for the agent to summarise the intent.</p>
        )}
        <dl className="facts">
          <dt>Ticket</dt>
          <dd>
            {review.jiraKey && jiraBase ? (
              <a href={`${jiraBase}/browse/${review.jiraKey}`} target="_blank" rel="noreferrer">
                {review.jiraKey}
              </a>
            ) : review.jiraKey ? (
              review.jiraKey
            ) : (
              <span className="muted">none found</span>
            )}
          </dd>
          <dt>Design</dt>
          <dd>
            {review.figmaUrl ? (
              <a href={review.figmaUrl} target="_blank" rel="noreferrer" className="truncate">
                {review.figmaUrl}
              </a>
            ) : (
              <span className="muted">none</span>
            )}
          </dd>
        </dl>
      </section>

      {review.phase !== "preparing" ? (
        <section className="block">
          <h2>Context the tests cannot see</h2>
          <ContextChecklistView checklist={review.contextChecklist} />
        </section>
      ) : null}

      <section className="block">
        <h2>Questions the agent raised</h2>
        {gaps.length === 0 ? (
          <p className="muted">No open questions.</p>
        ) : (
          <ul className="gap-list">
            {gaps.map((gap) => (
              <li key={gap.id} className="gap" data-answered={gap.answer ? "true" : "false"}>
                <p className="gap-question">{gap.question}</p>
                <p className="prose">{gap.answer ?? <span className="muted">not answered yet, answer it in the Intent step</span>}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {review.phase !== "preparing" ? (
        <section className="block">
          <p className="muted small">Re-run if the ticket, design or PR description changed. The agent rewrites the intent and may ask new questions.</p>
          <RerunButton detail={detail} step="requirements" label="Re-run requirements" onDone={onRerun} />
        </section>
      ) : null}
    </div>
  );
}

function GapRow({ gap }: { gap: ContextGap }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(gap.answer ?? "");
  const save = useMutation({
    mutationFn: (answer: string) => api.answerGap(gap.reviewId, gap.id, answer),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.review(gap.reviewId) }),
  });
  const unchanged = draft.trim() === (gap.answer ?? "").trim();
  const inputId = `gap-${gap.id}`;

  return (
    <li className="gap" data-answered={gap.answer ? "true" : "false"}>
      <label htmlFor={inputId} className="gap-question">
        {gap.question}
      </label>
      <textarea id={inputId} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Your answer" />
      <div className="row-actions">
        <button
          type="button"
          className="button"
          disabled={unchanged || draft.trim() === "" || save.isPending}
          onClick={() => save.mutate(draft.trim())}
        >
          {save.isPending ? "Saving" : gap.answer ? "Update answer" : "Save answer"}
        </button>
        {gap.answer ? <span className="muted small">answered</span> : <span className="muted small">needs an answer</span>}
        {save.isError ? <span className="error-text small">{errorMessage(save.error)}</span> : null}
      </div>
    </li>
  );
}

export function IntentStep({ detail, onRerun }: StepProps) {
  const { review, gaps } = detail;
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(review.reviewerNotes ?? "");
  useEffect(() => setNotes(review.reviewerNotes ?? ""), [review.reviewerNotes]);
  const complete = useMutation({
    mutationFn: () => api.completeContext(review.id, notes.trim() || undefined),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.review(review.id) });
      onRerun();
    },
  });
  const allAnswered = gaps.every((gap) => Boolean(gap.answer));
  const firstRun = review.phase === "context";
  const waitingForRequirements = review.intentSummary === null || isRerunning(review, "requirements");

  return (
    <div className="phase">
      {stepStatus(detail, "intent") === "stale" ? <StaleNotice step="intent" /> : null}
      {waitingForRequirements ? <p className="muted waiting">The requirements step is still running. You can answer questions as they arrive.</p> : null}

      {review.contextAutoConfirmed && !firstRun ? (
        <aside className="callout" aria-live="polite">
          <span className="callout-label">Confirmed automatically</span>
          <p>The agent found nothing it could not answer, so the review moved on without waiting for you. Add notes and re-run below if something is missing.</p>
        </aside>
      ) : null}

      {review.intentSummary ? (
        <section className="block">
          <h2>Intent</h2>
          <p className="prose">{review.intentSummary}</p>
        </section>
      ) : null}

      {review.contextChecklist ? (
        <details className="block">
          <summary className="block-summary">Context the agent checked</summary>
          <ContextChecklistView checklist={review.contextChecklist} />
        </details>
      ) : null}

      <section className="block">
        <h2>Questions</h2>
        {gaps.length === 0 ? (
          <p className="muted">The agent has no questions.</p>
        ) : (
          <ul className="gap-list">
            {gaps.map((gap) => (
              <GapRow key={gap.id} gap={gap} />
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <h2>Notes for the agent</h2>
        <label htmlFor="reviewer-notes" className="visually-hidden">
          Notes for the agent
        </label>
        <textarea
          id="reviewer-notes"
          rows={4}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything the agent should know about this author, this area of the code, or how you want the review done"
        />
        <div className="row-actions">
          {firstRun ? (
            <button
              type="button"
              className="button primary"
              disabled={!allAnswered || waitingForRequirements || complete.isPending}
              onClick={() => complete.mutate()}
            >
              {complete.isPending ? "Sending" : "Confirm intent"}
            </button>
          ) : (
            <RerunButton
              detail={detail}
              step="intent"
              label="Save and re-run approach"
              notes={notes.trim()}
              primary
              disabled={!allAnswered}
              onDone={onRerun}
            />
          )}
          {!allAnswered ? <span className="muted small">answer every question first</span> : null}
          {complete.isError ? <span className="error-text small">{errorMessage(complete.error)}</span> : null}
        </div>
      </section>
    </div>
  );
}

export function ApproachStep({ detail, onRerun, activity }: StepProps) {
  const { review } = detail;
  const stale = stepStatus(detail, "approach") === "stale";
  const rewriting = isRerunning(review, "approach") && review.phase === "checkpoint";

  return (
    <>
      {stale ? <StaleNotice step="approach" /> : null}
      {rewriting && detail.agentBusy ? <WorkingCard text="The agent is rewriting the approach." activity={activity} /> : null}
      {review.phase === "checkpoint" ? (
        <CheckpointPhase detail={detail} />
      ) : (
        <div className="phase">
          <section className="block">
            <h2>Approach</h2>
            <ApproachView review={review} empty={<p className="muted">No approach summary was recorded.</p>} />
            {review.approachDecision ? (
              <p className="muted small">Decision: {review.approachDecision === "proceed" ? "proceeded to code review" : "approach rejected"}</p>
            ) : null}
          </section>
        </div>
      )}
      {review.approachSummary !== null || review.phase === "checkpoint" ? (
        <div className="phase">
          <section className="block">
            <p className="muted small">Re-run to have the agent look at the approach again, for example after you corrected the intent.</p>
            <RerunButton detail={detail} step="approach" label="Re-run approach" onDone={onRerun} />
          </section>
        </div>
      ) : null}
    </>
  );
}
