import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { ApproachInput, ReviewDetail } from "../api/types";
import { ApproachView } from "./ApproachView";

type Mode = "idle" | "correct" | "reject";

export function CheckpointPhase({ detail }: { detail: ReviewDetail }) {
  const { review } = detail;
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (input: ApproachInput) => api.decideApproach(review.id, input),
    onSuccess: () => {
      setMode("idle");
      setNote("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.review(review.id) });
    },
  });

  const submitNote = () => {
    if (mode === "correct") {
      decide.mutate({ decision: "correct", note: note.trim() });
    } else if (mode === "reject") {
      decide.mutate(note.trim() ? { decision: "reject", note: note.trim() } : { decision: "reject" });
    }
  };

  return (
    <div className="phase">
      <section className="block">
        <h2>Approach</h2>
        <ApproachView review={review} empty={<p className="muted waiting">Waiting for the agent to describe the approach.</p>} />
      </section>

      <section className="block">
        <h2>Decision</h2>
        <div className="button-row">
          <button
            type="button"
            className="button primary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decision: "proceed" })}
          >
            Proceed
          </button>
          <button
            type="button"
            className="button"
            aria-pressed={mode === "correct"}
            disabled={decide.isPending}
            onClick={() => setMode(mode === "correct" ? "idle" : "correct")}
          >
            Correct
          </button>
          <button
            type="button"
            className="button"
            aria-pressed={mode === "reject"}
            disabled={decide.isPending}
            onClick={() => setMode(mode === "reject" ? "idle" : "reject")}
          >
            Reject
          </button>
        </div>

        {mode !== "idle" ? (
          <div className="decision-note">
            <label htmlFor="decision-note">
              {mode === "correct" ? "What did the agent get wrong?" : "Why is the approach rejected? (optional)"}
            </label>
            <textarea
              id="decision-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={mode === "correct" ? "The job does extend BaseStreamingJob, see line 4" : "Explain for the author"}
            />
            <div className="row-actions">
              <button
                type="button"
                className="button primary"
                disabled={decide.isPending || (mode === "correct" && note.trim() === "")}
                onClick={submitNote}
              >
                {mode === "correct" ? "Send correction" : "Confirm reject"}
              </button>
              <button type="button" className="button quiet" onClick={() => setMode("idle")}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {decide.isError ? <p className="error-text small">{errorMessage(decide.error)}</p> : null}
      </section>
    </div>
  );
}
