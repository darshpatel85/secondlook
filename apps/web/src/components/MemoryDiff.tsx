import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";

type MemoryDiffProps = {
  reviewId: string;
  repoId: string;
};

export type AddedLine = { index: number; text: string };

export function addedLines(before: string, after: string): AddedLine[] {
  const remaining = new Map<string, number>();
  for (const line of before.split("\n")) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const added: AddedLine[] = [];
  after.split("\n").forEach((line, index) => {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
    } else if (line.trim() !== "") {
      added.push({ index, text: line });
    }
  });
  return added;
}

export function withoutLine(content: string, index: number): string {
  const lines = content.split("\n");
  lines.splice(index, 1);
  return lines.join("\n");
}

export function MemoryDiff({ reviewId, repoId }: MemoryDiffProps) {
  const queryClient = useQueryClient();
  const diff = useQuery({ queryKey: queryKeys.memoryDiff(reviewId), queryFn: () => api.memoryDiff(reviewId) });
  const remove = useMutation({
    mutationFn: (index: number) => api.putMemory(repoId, withoutLine(diff.data?.after ?? "", index)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoryDiff(reviewId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.memory(repoId) });
    },
  });

  const added = diff.data ? addedLines(diff.data.before, diff.data.after) : [];

  return (
    <section className="block memory-diff" aria-label="Memory changes">
      <div className="memory-diff-head">
        <h2>What the agent learned</h2>
        <Link to={`/repos/${encodeURIComponent(repoId)}`} className="small">
          Edit the full memory file
        </Link>
      </div>
      {diff.isPending ? <p className="muted small">Loading memory changes.</p> : null}
      {diff.isError ? <p className="error-text small">{errorMessage(diff.error)}</p> : null}
      {diff.data && added.length === 0 ? <p className="muted small">Nothing new was added to memory during this review.</p> : null}
      {added.length > 0 ? (
        <ul className="memory-added">
          {added.map((line) => (
            <li key={`${line.index}-${line.text}`} className="memory-added-line">
              <code>{line.text}</code>
              <button
                type="button"
                className="button quiet small"
                onClick={() => remove.mutate(line.index)}
                disabled={remove.isPending}
                aria-label={`Remove "${line.text}" from memory`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {remove.isError ? <p className="error-text small">{errorMessage(remove.error)}</p> : null}
    </section>
  );
}
