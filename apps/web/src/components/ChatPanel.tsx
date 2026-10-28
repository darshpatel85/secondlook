import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ActivityItem, ChatMessage } from "../api/types";
import type { ActivityEntry } from "../hooks/useReviewEvents";
import { formatClock } from "../lib/time";
import { LogoLoader } from "./AgentPulse";
import { ClaudeSignIn } from "./ClaudeSignIn";
import { Markdown } from "./Markdown";

const AUTH_ERROR = /failed to authenticate|oauth session expired|could not be refreshed|invalid api key|please run \/login|authentication_error/i;

function isAuthError(text: string): boolean {
  return AUTH_ERROR.test(text);
}

function rowText(row: Row): string {
  return row.kind === "message" ? row.message.content : row.entry.text;
}

type Row = { kind: "message"; at: number; message: ChatMessage } | { kind: "activity"; at: number; entry: ActivityEntry };

type Block = Row | { kind: "tools"; id: string; entries: ActivityEntry[] };

function groupTools(rows: Row[]): Block[] {
  const blocks: Block[] = [];
  for (const row of rows) {
    if (row.kind === "activity" && row.entry.kind === "tool") {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "tools") {
        last.entries.push(row.entry);
      } else {
        blocks.push({ kind: "tools", id: row.entry.id, entries: [row.entry] });
      }
    } else {
      blocks.push(row);
    }
  }
  return blocks;
}

type ChatPanelProps = {
  messages: ChatMessage[];
  activity: ActivityEntry[];
  history?: ActivityItem[];
  agentBusy: boolean;
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onMakeComment?: (text: string) => void;
};

export function ChatPanel({ messages, activity, history = [], agentBusy, sending, error, onSend, onMakeComment }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [dismissedAuthKey, setDismissedAuthKey] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const lastPersisted = history.reduce((max, item) => Math.max(max, item.at), 0);
    const merged: Row[] = [
      ...messages.map((message): Row => ({ kind: "message", at: message.createdAt, message })),
      ...history.map((item): Row => ({ kind: "activity", at: item.at, entry: { id: item.id, at: item.at, kind: "tool", text: item.text } })),
      ...activity
        .filter((entry) => entry.kind !== "tool" || entry.at > lastPersisted)
        .map((entry): Row => ({ kind: "activity", at: entry.at, entry })),
    ];
    return merged.sort((a, b) => a.at - b.at);
  }, [messages, activity, history]);
  const authErrorAt = useMemo(() => {
    const lastAuthError = rows.reduce((max, row) => (isAuthError(rowText(row)) ? Math.max(max, row.at) : max), 0);
    const lastAgentReply = rows.reduce(
      (max, row) => (row.kind === "message" && row.message.role === "agent" && !isAuthError(row.message.content) ? Math.max(max, row.at) : max),
      0,
    );
    return lastAuthError > lastAgentReply ? lastAuthError : 0;
  }, [rows]);
  const sendFailedAuth = error !== null && isAuthError(error);
  const authKey = sendFailedAuth ? `send:${error}` : authErrorAt > 0 ? `at:${authErrorAt}` : "";
  const showAuthNotice = authKey !== "" && authKey !== dismissedAuthKey;
  const lastReviewerText = [...rows].reverse().find((row) => row.kind === "message" && row.message.role === "reviewer");
  const visibleRows = useMemo(() => rows.filter((row) => !isAuthError(rowText(row))), [rows]);
  const blocks = useMemo(() => groupTools(visibleRows), [visibleRows]);
  const latestTool = [...rows].reverse().find((row) => row.kind === "activity" && row.entry.kind === "tool");

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [rows.length, agentBusy, showAuthNotice]);

  const disabled = agentBusy || sending;

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) {
      return;
    }
    onSend(text);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat">
      <h2 className="pane-title">Chat</h2>
      <div className="chat-log" ref={listRef} role="log" aria-live="polite">
        {visibleRows.length === 0 && !showAuthNotice ? <p className="muted small">No messages yet.</p> : null}
        {blocks.map((row) =>
          row.kind === "tools" ? (
            <details key={row.id} className="chat-tools">
              <summary className="chat-activity">
                {row.entries.length === 1 ? row.entries[0]?.text : `${row.entries.length} steps · ${row.entries.at(-1)?.text ?? ""}`}
              </summary>
              {row.entries.length > 1
                ? row.entries.map((entry) => (
                    <div key={entry.id} className="chat-activity" data-kind={entry.kind}>
                      {entry.text}
                    </div>
                  ))
                : null}
            </details>
          ) : row.kind === "message" ? (
            <div key={row.message.id} className="chat-message" data-role={row.message.role}>
              <div className="chat-bubble">
                <Markdown text={row.message.content} />
              </div>
              <div className="chat-foot">
                <time className="chat-time" dateTime={new Date(row.at).toISOString()}>
                  {formatClock(row.at)}
                </time>
                {onMakeComment && row.message.role === "agent" ? (
                  <button type="button" className="chat-action" onClick={() => onMakeComment(row.message.content)}>
                    make this a comment
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div key={row.entry.id} className="chat-activity" data-kind={row.entry.kind}>
              {row.entry.text}
            </div>
          ),
        )}
        {agentBusy ? (
          <div className="chat-activity chat-busy">
            <LogoLoader size={13} />
            agent is working{latestTool && latestTool.kind === "activity" ? ` · last: ${latestTool.entry.text}` : ""}
          </div>
        ) : null}
        {showAuthNotice ? (
          <ClaudeSignIn
            canRetry={lastReviewerText?.kind === "message"}
            disabled={disabled}
            onRetry={() => {
              setDismissedAuthKey(authKey);
              if (lastReviewerText?.kind === "message") {
                onSend(lastReviewerText.message.content);
              }
            }}
            onDismiss={() => setDismissedAuthKey(authKey)}
          />
        ) : null}
      </div>
      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="chat-input" className="visually-hidden">
          Message to the agent
        </label>
        <textarea
          id="chat-input"
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={agentBusy ? "Wait for the agent to finish" : "Ask or tell the agent something. Enter sends, Shift+Enter for a new line"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="row-actions">
          <button type="submit" className="button primary" disabled={disabled || draft.trim() === ""}>
            Send
          </button>
          {error && !sendFailedAuth ? <span className="error-text small">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}
