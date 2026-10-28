import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";

export function PastePrForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [prUrl, setPrUrl] = useState("");
  const create = useMutation({
    mutationFn: api.createReview,
    onSuccess: async (review) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      await navigate(`/reviews/${encodeURIComponent(review.id)}`);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = prUrl.trim();
    if (trimmed) {
      create.mutate(trimmed);
    }
  };

  return (
    <form className="form" onSubmit={onSubmit} aria-label="Start a review">
      <div className="field">
        <label htmlFor="pr-url">Pull request URL</label>
        <div className="input-with-button">
          <input
            id="pr-url"
            type="url"
            required
            value={prUrl}
            placeholder="https://github.com/org/repo/pull/123"
            onChange={(event) => setPrUrl(event.target.value)}
          />
          <button type="submit" className="button primary" disabled={create.isPending || prUrl.trim() === ""}>
            {create.isPending ? "Starting" : "Start review"}
          </button>
        </div>
        {create.isError ? <span className="error-text small">{errorMessage(create.error)}</span> : null}
      </div>
    </form>
  );
}
