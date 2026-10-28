import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { AgentQuestion } from "../api/types";

type QuestionCardProps = {
  question: AgentQuestion;
  showPath?: boolean;
};

export function QuestionCard({ question, showPath = false }: QuestionCardProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const answer = useMutation({
    mutationFn: (text: string) => api.answerQuestion(question.reviewId, question.id, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.review(question.reviewId) }),
  });
  const inputId = `question-${question.id}`;

  if (question.answer) {
    return (
      <div className="question answered">
        <p className="question-text">{question.question}</p>
        <p className="small">
          <span className="muted">You answered:</span> {question.answer}
        </p>
      </div>
    );
  }

  return (
    <div className="question">
      <label htmlFor={inputId} className="question-text">
        <span className="callout-label">Agent asks{showPath && question.path ? ` about ${question.path}` : ""}</span>
        {question.question}
      </label>
      <textarea id={inputId} rows={2} value={draft} placeholder="Your answer" onChange={(event) => setDraft(event.target.value)} />
      <div className="row-actions">
        <button
          type="button"
          className="button"
          disabled={draft.trim() === "" || answer.isPending}
          onClick={() => answer.mutate(draft.trim())}
        >
          {answer.isPending ? "Sending" : "Answer"}
        </button>
        {answer.isError ? <span className="error-text small">{errorMessage(answer.error)}</span> : null}
      </div>
    </div>
  );
}
