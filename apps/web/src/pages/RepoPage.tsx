import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { DocEdit, DocEditStatus } from "../api/types";
import { Layout } from "../components/Layout";
import { AuthorFilter, matchesAuthor, OpenPullList, useAuthorFilter } from "../components/OpenPullList";
import { formatRelative } from "../lib/time";

function MemoryEditor({ repoId }: { repoId: string }) {
  const queryClient = useQueryClient();
  const memory = useQuery({ queryKey: queryKeys.memory(repoId), queryFn: () => api.getMemory(repoId) });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (content: string) => api.putMemory(repoId, content),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.memory(repoId), saved);
      setDraft(null);
    },
  });

  useEffect(() => {
    setDraft(null);
  }, [repoId]);

  const saved = memory.data?.content ?? "";
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  return (
    <section className="home-section">
      <h2>Memory</h2>
      <p className="muted small">
        What the agent remembers about this repository. It is read into every review. Keep the four section headings; remove any line you do not want
        the agent to act on.
      </p>
      {memory.isPending ? <p className="muted">Loading memory.</p> : null}
      {memory.isError ? <p className="error-text">{errorMessage(memory.error)}</p> : null}
      {memory.data ? (
        <>
          <textarea
            className="memory-editor"
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label="Repository memory"
          />
          <div className="button-row">
            <button type="button" className="button primary" onClick={() => save.mutate(value)} disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving" : "Save memory"}
            </button>
            <button type="button" className="button quiet" onClick={() => setDraft(null)} disabled={!dirty || save.isPending}>
              Discard changes
            </button>
            {save.isSuccess && !dirty ? <span className="muted small">Saved.</span> : null}
          </div>
          {save.isError ? <p className="error-text small">{errorMessage(save.error)}</p> : null}
        </>
      ) : null}
    </section>
  );
}

const statusLabels: Record<DocEditStatus, string> = {
  proposed: "proposed",
  approved: "approved",
  discarded: "discarded",
  opened: "in a PR",
};

function DocEditCard({ edit, onDecide, pending }: { edit: DocEdit; onDecide: (status: "approved" | "discarded") => void; pending: boolean }) {
  return (
    <li className="doc-edit" data-status={edit.status}>
      <div className="doc-edit-head">
        <code className="doc-edit-path">{edit.path}</code>
        <span className="doc-edit-status" data-status={edit.status}>
          {statusLabels[edit.status]}
        </span>
      </div>
      <p className="doc-edit-rationale">{edit.rationale}</p>
      <p className="muted small">
        {formatRelative(edit.createdAt)}
        {edit.reviewId ? (
          <>
            {" · from "}
            <Link to={`/reviews/${encodeURIComponent(edit.reviewId)}`}>this review</Link>
          </>
        ) : null}
      </p>
      {edit.error ? <p className="error-text small">Could not apply last time: {edit.error}</p> : null}
      <details className="doc-edit-diff">
        <summary>Show diff</summary>
        <pre>{edit.diff}</pre>
      </details>
      {edit.status === "proposed" || edit.status === "approved" ? (
        <div className="row-actions">
          {edit.status === "proposed" ? (
            <button type="button" className="button primary" onClick={() => onDecide("approved")} disabled={pending}>
              Approve
            </button>
          ) : null}
          <button type="button" className="button quiet" onClick={() => onDecide("discarded")} disabled={pending}>
            Discard
          </button>
        </div>
      ) : null}
    </li>
  );
}

function DocEditQueue({ repoId }: { repoId: string }) {
  const queryClient = useQueryClient();
  const edits = useQuery({ queryKey: queryKeys.docEdits(repoId), queryFn: () => api.listDocEdits(repoId) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.docEdits(repoId) });
  const decide = useMutation({
    mutationFn: ({ edit, status }: { edit: DocEdit; status: "approved" | "discarded" }) => api.patchDocEdit(repoId, edit.id, status),
    onSuccess: invalidate,
  });
  const openPr = useMutation({
    mutationFn: () => api.openDocsPr(repoId),
    onSuccess: invalidate,
  });

  const approved = edits.data?.filter((edit) => edit.status === "approved").length ?? 0;

  return (
    <section className="home-section">
      <h2>Proposed doc edits</h2>
      <p className="muted small">
        Changes the agent suggested to the repository docs during reviews. Approve the ones you want, then open a single docs PR with all of them.
      </p>
      {edits.isPending ? <p className="muted">Loading doc edits.</p> : null}
      {edits.isError ? <p className="error-text">{errorMessage(edits.error)}</p> : null}
      {edits.data && edits.data.length === 0 ? <p className="muted">No doc edits have been proposed yet.</p> : null}
      {edits.data && edits.data.length > 0 ? (
        <>
          <div className="button-row">
            <button type="button" className="button primary" onClick={() => openPr.mutate()} disabled={approved === 0 || openPr.isPending}>
              {openPr.isPending ? "Opening PR" : `Open docs PR (${approved} approved)`}
            </button>
            {openPr.data ? (
              <a href={openPr.data.prUrl} target="_blank" rel="noreferrer">
                PR opened: {openPr.data.prUrl}
              </a>
            ) : null}
          </div>
          {openPr.isError ? <p className="error-text small">{errorMessage(openPr.error)}</p> : null}
          {decide.isError ? <p className="error-text small">{errorMessage(decide.error)}</p> : null}
          <ul className="doc-edit-list">
            {edits.data.map((edit) => (
              <DocEditCard key={edit.id} edit={edit} pending={decide.isPending} onDecide={(status) => decide.mutate({ edit, status })} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RelatedReposEditor({ repoId, saved }: { repoId: string; saved: string[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (relatedPaths: string[]) => api.updateRepoRelatedPaths(repoId, relatedPaths),
    onSuccess: (repo) => {
      queryClient.setQueryData(queryKeys.repo(repoId), repo);
      setDraft(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.repos });
    },
  });

  const savedText = saved.join("\n");
  const value = draft ?? savedText;
  const dirty = draft !== null && draft !== savedText;
  const paths = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return (
    <section className="home-section">
      <h2>Related repos</h2>
      <p className="muted small">
        Local checkouts the agent may read during a review, one absolute path per line. Each one gets a <code>git pull</code> before the review
        starts, and the pull request checkout gets a <code>yarn install</code> when it has a yarn.lock.
      </p>
      <textarea
        className="memory-editor related-paths-editor"
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        placeholder="/Users/you/code/related-repo"
        aria-label="Related repo paths"
      />
      <div className="button-row">
        <button type="button" className="button primary" onClick={() => save.mutate(paths)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving" : "Save related repos"}
        </button>
        <button type="button" className="button quiet" onClick={() => setDraft(null)} disabled={!dirty || save.isPending}>
          Discard changes
        </button>
        {save.isSuccess && !dirty ? <span className="muted small">Saved.</span> : null}
      </div>
      {save.isError ? <p className="error-text small">{errorMessage(save.error)}</p> : null}
    </section>
  );
}

function OpenPulls({ repoId }: { repoId: string }) {
  const pulls = useQuery({ queryKey: queryKeys.repoPulls(repoId), queryFn: () => api.listRepoPulls(repoId) });
  const [author, setAuthor] = useAuthorFilter();

  return (
    <section className="home-section">
      <h2>Open pull requests</h2>
      {pulls.isPending ? <p className="muted">Loading pull requests.</p> : null}
      {pulls.isError ? <p className="error-text">{errorMessage(pulls.error)}</p> : null}
      {pulls.data && pulls.data.length > 0 ? <AuthorFilter pulls={pulls.data} value={author} onChange={setAuthor} /> : null}
      {pulls.data ? <OpenPullList pulls={pulls.data.filter((pull) => matchesAuthor(pull, author))} /> : null}
    </section>
  );
}

export function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const repo = useQuery({ queryKey: queryKeys.repo(id ?? ""), queryFn: () => api.getRepo(id ?? ""), enabled: Boolean(id) });

  if (!id) {
    return (
      <Layout>
        <p className="error-text">No repository id in the URL.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="home-section">
        <Link to="/" className="small">
          Back to all repositories
        </Link>
        {repo.isPending ? <p className="muted">Loading repository.</p> : null}
        {repo.isError ? <p className="error-text">{errorMessage(repo.error)}</p> : null}
        {repo.data ? (
          <>
            <h1>
              {repo.data.owner}/{repo.data.name}
            </h1>
            <p className="muted small">
              {repo.data.defaultBranch} · {repo.data.skillPath}
              {repo.data.docsPaths.length > 0 ? ` · docs: ${repo.data.docsPaths.join(", ")}` : ""}
            </p>
          </>
        ) : null}
      </section>
      {repo.data ? (
        <>
          <OpenPulls repoId={id} />
          <RelatedReposEditor repoId={id} saved={repo.data.relatedPaths} />
          <MemoryEditor repoId={id} />
          <DocEditQueue repoId={id} />
        </>
      ) : null}
    </Layout>
  );
}
