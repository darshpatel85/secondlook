import { useEffect, useRef, useState } from "react";
import { severities, type FindingInput, type Severity } from "../api/types";
import { severityLabels } from "../lib/review";

type CommentComposerProps = {
  path: string;
  line: number | null;
  initialBody?: string;
  pending: boolean;
  error: string | null;
  onSubmit: (input: FindingInput) => void;
  onCancel: () => void;
};

function titleFrom(text: string): string {
  const first = text.split("\n").find((row) => row.trim() !== "") ?? "";
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}...` : first;
}

export function CommentComposer({ path, line, initialBody = "", pending, error, onSubmit, onCancel }: CommentComposerProps) {
  const [severity, setSeverity] = useState<Severity>("should_fix");
  const [body, setBody] = useState(initialBody);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  const canSubmit = !pending && body.trim() !== "";

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit({
      path,
      ...(line !== null ? { line } : {}),
      severity,
      title: titleFrom(body.trim()),
      body: body.trim(),
    });
  };

  return (
    <form
      className="composer"
      aria-label={line !== null ? `Comment on line ${line}` : `Comment on ${path}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="composer-head">
        <span className="composer-where">
          Your comment on <span className="mono">{path}</span>
          {line !== null ? <span className="mono">:{line}</span> : <span className="muted"> (whole file)</span>}
        </span>
        <label htmlFor="composer-severity" className="visually-hidden">
          Severity
        </label>
        <select id="composer-severity" value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>
          {severities.map((option) => (
            <option key={option} value={option}>
              {severityLabels[option]}
            </option>
          ))}
        </select>
      </div>
      <label htmlFor="composer-body" className="visually-hidden">
        Comment
      </label>
      <textarea
        id="composer-body"
        ref={bodyRef}
        rows={4}
        value={body}
        placeholder="The comment as the author will read it. Cmd or Ctrl+Enter submits"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="row-actions">
        <button type="submit" className="button primary" disabled={!canSubmit}>
          {pending ? "Adding" : "Add comment"}
        </button>
        <button type="button" className="button quiet" onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className="error-text small">{error}</span> : null}
      </div>
    </form>
  );
}
