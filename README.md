# ai-review

A pair-review dashboard. You paste a GitHub pull request URL, a Claude Code agent reads the diff, the ticket and the design inside a worktree, and the two of you walk through the change step by step. Findings are structured rows you accept, reject or park, and only accepted findings are posted to GitHub.

## Prerequisites

- Node 24 or newer
- pnpm 10 (`corepack enable` picks the version pinned in `package.json`)
- `git` on your PATH
- A GitHub personal access token with repo read and pull-request write, set as `GITHUB_TOKEN` in `.env` at the workspace root (copy `.env.example`). It is used for API calls and for cloning and fetching.
- Claude Code CLI signed in: `claude login`. The CLI's session is separate from the desktop app's.

## Install and run

```sh
git clone https://github.com/darshpatel85/secondlook.git
cd secondlook
cp .env.example .env   # set GITHUB_TOKEN
pnpm install
pnpm dev
```

`pnpm dev` starts all three apps:

- server on `http://127.0.0.1:4100`
- web on `http://localhost:5173`, with `/api` proxied to the server
- landing page on `http://localhost:5175` (the product's public page, in `apps/landing`)

The landing page embeds a 60 second product tour. Its source is a Remotion project in `apps/video`; `pnpm --filter @ai-review/video render` writes `apps/landing/public/secondlook.mp4` (1080p) and `pnpm --filter @ai-review/video poster` the poster frame. `pnpm --filter @ai-review/video studio` opens the scenes in the browser for editing.

The narration is one MP3 per scene in `apps/video/public/voice/`, generated from `apps/video/voice/script.json` by `pnpm --filter @ai-review/video voice`. It uses a Microsoft neural voice through `edge-tts` (run with `uvx`, no key needed); set `engine` to `say` in the script file to use the macOS voice offline instead. To use a better voice, record each line from the script and save it over the file with the same name; the render picks it up.

Check the server is up:

```sh
curl http://127.0.0.1:4100/api/health
```

To run one app on its own use `pnpm --filter @ai-review/server dev` or `pnpm --filter @ai-review/web dev`. The same two commands are in `.claude/launch.json` as the `server` and `web` entries.

## Set up a repository

Each repository you review needs a clone URL and the absolute path to the review skill the agent should follow. The clone runs in the background; poll `GET /api/repos/:id` until `cloneState` is `ready`.

```sh
curl -X POST http://127.0.0.1:4100/api/repos \
  -H 'content-type: application/json' \
  -d '{
    "cloneUrl": "https://github.com/acme/widgets-api",
    "skillPath": "/Users/you/.claude/skills/backend-review",
    "defaultBranch": "dev"
  }'

curl -X POST http://127.0.0.1:4100/api/repos \
  -H 'content-type: application/json' \
  -d '{
    "cloneUrl": "https://github.com/acme/widgets-web",
    "skillPath": "/Users/you/.claude/skills/frontend-review",
    "defaultBranch": "dev"
  }'
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `cloneUrl` | yes | `https://github.com/owner/name` or `git@github.com:owner/name.git` |
| `kind` | no | `backend`, `frontend` or `other`; defaults to `other` |
| `skillPath` | yes | absolute path to a skill file, or a directory containing `SKILL.md` |
| `docsPaths` | no | repo-relative paths fed to the agent as project docs; defaults to `["CLAUDE.md", "docs"]` |
| `defaultBranch` | no | detected from the clone when omitted |

Setting up the same owner/name twice returns `409`.

## Integrations (optional)

Out of the box nothing is connected: the agent reads the repository and the pull request only. Open **Settings** in the web app to connect:

- **Jira and Confluence**, through the Atlassian remote MCP server. Ticket keys like `ABC-123` in the branch, title or body are fetched for context. Add your Jira site to link ticket keys in a review.
- **Figma**, through the Figma remote MCP server. Figma links in the pull request body are opened for context.
- **Any other MCP server**, as a local command or an HTTP/SSE url, with an optional sentence telling the agent when to use it.

When Jira or Figma is not connected, the agent is told the ticket or design exists but cannot be opened, and works from the pull request description.

Settings are saved to `data/integrations.json` (set `AI_REVIEW_INTEGRATIONS` to use another file). `integrations.example.json` shows the format if you prefer to write it by hand.

Hosted servers need a browser login once. The Settings page shows the command to run; inside that session use `/mcp` to sign in. The tokens are stored by the Claude CLI and reused by every review.

## Hosting the landing page

The landing page is static, so it deploys to Vercel as is: import the repository, keep the root directory as the repository root, and the `vercel.json` at the root tells Vercel to install and build only `apps/landing`. The server and web app are not hosted there; they run on each reviewer's machine.

## Where data lives

Everything the server writes goes under `data/` at the workspace root (gitignored). Set `AI_REVIEW_DATA_DIR` to put it somewhere else.

## Context checklist and risk routing

In the context phase the agent records what the tests cannot see: what uses the changed code (including the related repositories), the data it touches, legacy behaviour, and which code covers each acceptance criterion. Anything it cannot answer becomes a question for you. When nothing is unknown, the review moves past the Intent step without waiting.

Each step in the plan is routed by risk: low risk steps are left to the agent and the verifier (their files only appear when something is raised), medium risk steps show you the findings with the diff folded away, and high risk steps get a full read. Steps that touch migrations, authorisation or money are always high risk. You can change a step's routing from the step list.

## Finding verification

Each finding the agent proposes (except questions) is re-checked by a second, read-only Claude run that tries to prove it wrong. Only confirmed findings show in the review; refuted ones sit in a collapsed "dismissed by the verifier" list you can still accept from. Up to three run at once. Set `AI_REVIEW_VERIFIER_MODEL` to use a different model for it (defaults to `AI_REVIEW_MODEL`, then `opus`). Verifier cost is added to each review's cost in Stats.

```
data/integrations.json  connected integrations, managed from Settings
data/ai-review.sqlite   repos, reviews, steps, findings, chat, agent events
data/repos/             one bare-ish clone per repository (owner__name)
data/worktrees/         one detached worktree per review (repoId/pr-<n>)
data/reviews/<id>/      system-prompt.md and mcp.json for that review's agent
data/memory/<repoId>.md what the agent should remember about a repository
data/mcp-template.json  your integrations' MCP servers, for the one-time login
```

Copy `.env.example` to `.env` to change the API port (`PORT`), the web port (`WEB_PORT`), the allowed web origin (`WEB_ORIGIN`), the data directory, or the `claude` binary. The web app reads the same `.env` and proxies `/api` to `PORT`.

## Project layout

```
apps/server   Fastify + TypeScript (ESM). REST API, SSE, SQLite via Drizzle, the agent process, the dashboard MCP server.
apps/web      Vite + React 19. The reviewer's UI.
docs/         CONTRACTS.md is the single source for routes, events, tools and the lifecycle.
tasks/        One brief per unit of work.
```

Useful commands:

```sh
pnpm typecheck                              # every workspace
pnpm --filter @ai-review/server test        # node:test suites
pnpm db:generate                            # regenerate the migration after a schema change
```

## Working on the project

Work is split into self-contained tasks under `tasks/`. Read `docs/CONTRACTS.md` first, then the task brief, and change only the files the brief lists. `tasks/README.md` explains the waves, the dependencies between tasks, and how to hand a task to an agent.

## Licence

MIT. See [LICENSE](LICENSE).
