import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";

const emptyForm = {
  cloneUrl: "",
  skillPath: "",
  docsPaths: "",
  relatedPaths: "",
};

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function RepoForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const create = useMutation({
    mutationFn: api.createRepo,
    onSuccess: () => {
      setForm(emptyForm);
      return queryClient.invalidateQueries({ queryKey: queryKeys.repos });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const docsPaths = splitList(form.docsPaths);
    const relatedPaths = splitList(form.relatedPaths);
    create.mutate({
      cloneUrl: form.cloneUrl.trim(),
      skillPath: form.skillPath.trim(),
      ...(docsPaths.length > 0 ? { docsPaths } : {}),
      ...(relatedPaths.length > 0 ? { relatedPaths } : {}),
    });
  };

  return (
    <form className="form" onSubmit={onSubmit} aria-label="Add a repository">
      <div className="field">
        <label htmlFor="repo-clone-url">Clone URL</label>
        <input
          id="repo-clone-url"
          type="url"
          required
          value={form.cloneUrl}
          placeholder="https://github.com/org/repo.git"
          onChange={(event) => setForm({ ...form, cloneUrl: event.target.value })}
        />
      </div>
      <div className="field-row">
        <div className="field grow">
          <label htmlFor="repo-skill-path">Skill path</label>
          <input
            id="repo-skill-path"
            type="text"
            required
            value={form.skillPath}
            placeholder=".claude/skills/review/SKILL.md"
            onChange={(event) => setForm({ ...form, skillPath: event.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="repo-docs-paths">Docs paths</label>
        <input
          id="repo-docs-paths"
          type="text"
          value={form.docsPaths}
          placeholder="docs/conventions.md, docs/architecture.md"
          onChange={(event) => setForm({ ...form, docsPaths: event.target.value })}
        />
        <span className="hint">Comma separated, relative to the repo root. Optional.</span>
      </div>
      <div className="field">
        <label htmlFor="repo-related-paths">Related repos</label>
        <input
          id="repo-related-paths"
          type="text"
          value={form.relatedPaths}
          placeholder="/Users/you/code/related-repo"
          onChange={(event) => setForm({ ...form, relatedPaths: event.target.value })}
        />
        <span className="hint">Comma separated absolute paths to local checkouts. Pulled before each review so the agent can read them. Optional.</span>
      </div>
      <div className="row-actions">
        <button type="submit" className="button primary" disabled={create.isPending}>
          {create.isPending ? "Adding" : "Add repository"}
        </button>
        {create.isError ? <span className="error-text small">{errorMessage(create.error)}</span> : null}
      </div>
    </form>
  );
}
