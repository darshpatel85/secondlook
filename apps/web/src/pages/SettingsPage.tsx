import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "../api/client";
import { errorMessage } from "../api/errors";
import type { CustomServer, IntegrationSettings, McpServerStatus } from "../api/types";
import { CopyButton } from "../components/CopyButton";
import { Layout } from "../components/Layout";

type ServerType = CustomServer["type"];

const emptyServer = {
  name: "",
  label: "",
  type: "stdio" as ServerType,
  command: "",
  args: "",
  url: "",
  env: "",
  guidance: "",
};

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseEnv(value: string): Record<string, string> {
  return Object.fromEntries(
    lines(value).map((line) => {
      const at = line.indexOf("=");
      return at === -1 ? [line, ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
}

function StatusPill({ status }: { status: McpServerStatus | undefined }) {
  if (!status) return <span className="mcp-pill">not checked</span>;
  const up = status.status === "connected";
  return (
    <span className={up ? "mcp-pill mcp-pill-up" : "mcp-pill mcp-pill-down"}>
      <span className="mcp-dot" aria-hidden="true" />
      {up ? "connected" : status.status}
    </span>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const integrations = useQuery({ queryKey: queryKeys.integrations, queryFn: () => api.integrations() });
  const status = useQuery({ queryKey: queryKeys.mcpStatus, queryFn: () => api.mcpStatus() });
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [server, setServer] = useState(emptyServer);
  const [showServerForm, setShowServerForm] = useState(false);

  const save = useMutation({
    mutationFn: (settings: IntegrationSettings) => api.saveIntegrations(settings),
    onSuccess: async (view) => {
      queryClient.setQueryData(queryKeys.integrations, view);
      queryClient.setQueryData(queryKeys.mcpStatus, await api.mcpStatus(true));
    },
  });

  if (integrations.isPending) {
    return (
      <Layout>
        <p className="muted">Loading settings.</p>
      </Layout>
    );
  }
  if (integrations.isError) {
    return (
      <Layout>
        <p className="error-text">{errorMessage(integrations.error)}</p>
      </Layout>
    );
  }

  const { settings, signInCommand } = integrations.data;
  const statusOf = (name: string) => status.data?.servers.find((entry) => entry.name === name);
  const update = (next: Partial<IntegrationSettings>) => save.mutate({ ...settings, ...next });
  const without = <K extends "jira" | "figma">(key: K): IntegrationSettings => {
    const next = { ...settings };
    delete next[key];
    return next;
  };
  const customNames = Object.keys(settings.servers);
  const anyConnected = Boolean(settings.jira || settings.figma || customNames.length > 0);

  const saveJira = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const site = (siteUrl ?? settings.jira?.siteUrl ?? "").trim();
    update({ jira: { ...settings.jira, ...(site ? { siteUrl: site } : { siteUrl: undefined }) } });
    setSiteUrl(null);
  };

  const addServer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const extras = {
      ...(server.label.trim() ? { label: server.label.trim() } : {}),
      ...(server.guidance.trim() ? { guidance: server.guidance.trim() } : {}),
    };
    const entry: CustomServer =
      server.type === "stdio"
        ? { type: "stdio", command: server.command.trim(), args: lines(server.args), env: parseEnv(server.env), ...extras }
        : { type: server.type, url: server.url.trim(), ...extras };
    save.mutate(
      { ...settings, servers: { ...settings.servers, [server.name.trim()]: entry } },
      {
        onSuccess: () => {
          setServer(emptyServer);
          setShowServerForm(false);
        },
      },
    );
  };

  const removeServer = (name: string) => {
    const servers = { ...settings.servers };
    delete servers[name];
    update({ servers });
  };

  return (
    <Layout>
      <section className="home-section">
        <h1>Integrations</h1>
        <p className="muted settings-intro">
          Second Look reviews from the repository and the pull request alone. Connect a tool when you want the agent to read
          tickets, designs or your own knowledge sources as well. Nothing is connected until you add it here.
        </p>

        <ul className="integration-list">
          <li className="integration">
            <div className="integration-head">
              <div>
                <h2>Jira and Confluence</h2>
                <p className="muted small">Reads the ticket named in the branch, title or description, and linked Confluence pages.</p>
              </div>
              {settings.jira ? <StatusPill status={statusOf("atlassian")} /> : null}
            </div>
            {settings.jira ? (
              <form className="form" onSubmit={saveJira} aria-label="Jira settings">
                <div className="field">
                  <label htmlFor="jira-site">Jira site</label>
                  <input
                    id="jira-site"
                    type="url"
                    value={siteUrl ?? settings.jira.siteUrl ?? ""}
                    placeholder="https://your-team.atlassian.net"
                    onChange={(event) => setSiteUrl(event.target.value)}
                  />
                  <span className="hint">Optional. Used to link ticket keys in a review.</span>
                </div>
                <div className="button-row">
                  <button type="submit" className="button" disabled={save.isPending || siteUrl === null}>
                    Save
                  </button>
                  <button type="button" className="button quiet" disabled={save.isPending} onClick={() => save.mutate(without("jira"))}>
                    Disconnect
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="button" disabled={save.isPending} onClick={() => update({ jira: {} })}>
                Connect Jira
              </button>
            )}
          </li>

          <li className="integration">
            <div className="integration-head">
              <div>
                <h2>Figma</h2>
                <p className="muted small">Opens Figma links in the pull request description and compares the change with the design.</p>
              </div>
              {settings.figma ? <StatusPill status={statusOf("figma")} /> : null}
            </div>
            {settings.figma ? (
              <button type="button" className="button quiet" disabled={save.isPending} onClick={() => save.mutate(without("figma"))}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="button" disabled={save.isPending} onClick={() => update({ figma: {} })}>
                Connect Figma
              </button>
            )}
          </li>

          <li className="integration">
            <div className="integration-head">
              <div>
                <h2>Other MCP servers</h2>
                <p className="muted small">Any MCP server: an internal knowledge base, docs search, a legacy code index. The agent gets read access to its tools.</p>
              </div>
            </div>
            {customNames.length > 0 ? (
              <ul className="custom-servers">
                {customNames.map((name) => {
                  const entry = settings.servers[name]!;
                  return (
                    <li key={name}>
                      <div className="custom-server-main">
                        <strong>{entry.label ?? name}</strong>
                        <code className="small">{entry.type === "stdio" ? [entry.command, ...entry.args].join(" ") : entry.url}</code>
                        {entry.guidance ? <span className="muted small">{entry.guidance}</span> : null}
                      </div>
                      <StatusPill status={statusOf(name)} />
                      <button type="button" className="button quiet small" disabled={save.isPending} onClick={() => removeServer(name)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {showServerForm ? (
              <form className="form" onSubmit={addServer} aria-label="Add an MCP server">
                <div className="field-row">
                  <div className="field grow">
                    <label htmlFor="server-name">Name</label>
                    <input
                      id="server-name"
                      required
                      pattern="[a-z0-9][a-z0-9\-]*"
                      value={server.name}
                      placeholder="team-kb"
                      onChange={(event) => setServer({ ...server, name: event.target.value })}
                    />
                    <span className="hint">Lowercase letters, digits and dashes. The agent sees its tools as mcp__name__tool.</span>
                  </div>
                  <div className="field grow">
                    <label htmlFor="server-label">Display name</label>
                    <input
                      id="server-label"
                      value={server.label}
                      placeholder="Team KB"
                      onChange={(event) => setServer({ ...server, label: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="server-type">Type</label>
                    <select
                      id="server-type"
                      value={server.type}
                      onChange={(event) => setServer({ ...server, type: event.target.value as ServerType })}
                    >
                      <option value="stdio">Local command</option>
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </div>
                </div>
                {server.type === "stdio" ? (
                  <>
                    <div className="field">
                      <label htmlFor="server-command">Command</label>
                      <input
                        id="server-command"
                        required
                        value={server.command}
                        placeholder="npx"
                        onChange={(event) => setServer({ ...server, command: event.target.value })}
                      />
                    </div>
                    <div className="field-row">
                      <div className="field grow">
                        <label htmlFor="server-args">Arguments</label>
                        <textarea
                          id="server-args"
                          rows={3}
                          value={server.args}
                          placeholder={"tsx\n/path/to/server.ts"}
                          onChange={(event) => setServer({ ...server, args: event.target.value })}
                        />
                        <span className="hint">One per line.</span>
                      </div>
                      <div className="field grow">
                        <label htmlFor="server-env">Environment</label>
                        <textarea
                          id="server-env"
                          rows={3}
                          value={server.env}
                          placeholder="API_TOKEN=..."
                          onChange={(event) => setServer({ ...server, env: event.target.value })}
                        />
                        <span className="hint">KEY=value, one per line. Stored in plain text in the data folder.</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="field">
                    <label htmlFor="server-url">URL</label>
                    <input
                      id="server-url"
                      type="url"
                      required
                      value={server.url}
                      placeholder="https://example.com/mcp"
                      onChange={(event) => setServer({ ...server, url: event.target.value })}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="server-guidance">When should the agent use it?</label>
                  <textarea
                    id="server-guidance"
                    rows={2}
                    value={server.guidance}
                    placeholder="Indexes the old system. When a change claims parity with it, look up what the old code did first."
                    onChange={(event) => setServer({ ...server, guidance: event.target.value })}
                  />
                  <span className="hint">Optional. Added to the agent's instructions.</span>
                </div>
                <div className="button-row">
                  <button type="submit" className="button primary" disabled={save.isPending}>
                    {save.isPending ? "Saving" : "Add server"}
                  </button>
                  <button type="button" className="button quiet" onClick={() => setShowServerForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="button" onClick={() => setShowServerForm(true)}>
                Add an MCP server
              </button>
            )}
          </li>
        </ul>
        {save.isError ? <p className="error-text small">{errorMessage(save.error)}</p> : null}
      </section>

      {anyConnected ? (
        <section className="home-section">
          <h2>Sign in once</h2>
          <p className="muted settings-intro">
            Jira, Figma and other hosted servers need a browser sign-in the first time. Run this in a terminal, type
            <code>/mcp</code>, and sign in to each one. Reviews reuse the sign-in after that.
          </p>
          <div className="command-line">
            <code>{signInCommand}</code>
            <CopyButton text={signInCommand} label="Copy command" />
          </div>
        </section>
      ) : null}
    </Layout>
  );
}
