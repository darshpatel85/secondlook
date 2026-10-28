import assert from "node:assert/strict";
import { test } from "node:test";
import { eventTypeName, parseLine, summariseAssistant, summariseResult } from "./stream.js";

const initLine =
  '{"type":"system","subtype":"init","cwd":"/x","session_id":"abc","tools":[],"mcp_servers":[],"model":"claude-opus-5-5"}';
const assistantLine =
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"},{"type":"tool_use","id":"t1","name":"mcp__dashboard__set_intent_summary","input":{"summary":"x"}}]}}';
const resultLine =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":1200,"total_cost_usd":0.01,"result":"ok","session_id":"abc"}';

function parsed(line: string) {
  const event = parseLine(line);
  assert.ok(event, `expected a parsed event for ${line}`);
  return event;
}

test("parseLine returns the event for valid lines", () => {
  assert.equal(parsed(initLine).type, "system");
  assert.equal(parsed(initLine).session_id, "abc");
  assert.equal(parsed(assistantLine).type, "assistant");
  assert.equal(parsed(resultLine).type, "result");
});

test("parseLine tolerates surrounding whitespace", () => {
  assert.equal(parsed(`  ${resultLine}\r`).type, "result");
});

test("parseLine returns null for blank, invalid, or untyped lines", () => {
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("   "), null);
  assert.equal(parseLine("not json"), null);
  assert.equal(parseLine('"a string"'), null);
  assert.equal(parseLine("[1,2]"), null);
  assert.equal(parseLine("null"), null);
  assert.equal(parseLine('{"subtype":"init"}'), null);
  assert.equal(parseLine('{"type":42}'), null);
});

test("eventTypeName appends the subtype with a dot", () => {
  assert.equal(eventTypeName(parsed(initLine)), "system.init");
  assert.equal(eventTypeName(parsed(assistantLine)), "assistant");
  assert.equal(eventTypeName(parsed(resultLine)), "result.success");
  assert.equal(eventTypeName({ type: "x", subtype: "" }), "x");
});

test("summariseAssistant splits text and tool_use blocks", () => {
  const summary = summariseAssistant(parsed(assistantLine));
  assert.deepEqual(summary.texts, ["ok"]);
  assert.deepEqual(summary.tools, [{ name: "mcp__dashboard__set_intent_summary", summary: "recorded set intent summary" }]);
});

test("summariseAssistant skips empty text blocks and unknown blocks", () => {
  const summary = summariseAssistant({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "" },
        { type: "text", text: "   \n" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "visible" },
        "junk",
      ],
    },
  });
  assert.deepEqual(summary.texts, ["visible"]);
  assert.deepEqual(summary.tools, []);
});

test("summariseAssistant truncates unknown tool input to 120 characters", () => {
  const summary = summariseAssistant({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Mystery", input: { path: "a".repeat(500) } }] },
  });
  assert.equal(summary.tools.length, 1);
  assert.equal(summary.tools[0]?.summary.length, "Mystery ".length + 120);
  assert.ok(summary.tools[0]?.summary.startsWith('Mystery {"path":"aaa'));
});

test("summariseAssistant handles events with no message or content", () => {
  assert.deepEqual(summariseAssistant({ type: "assistant" }), { texts: [], tools: [] });
  assert.deepEqual(summariseAssistant({ type: "assistant", message: { content: "nope" } }), { texts: [], tools: [] });
  assert.deepEqual(summariseAssistant({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Glob" }] } }), {
    texts: [],
    tools: [{ name: "Glob", summary: "listed files matching {}" }],
  });
});

test("summariseResult extracts cost, duration, and error state", () => {
  assert.deepEqual(summariseResult(parsed(resultLine)), { costUsd: 0.01, durationMs: 1200, isError: false, text: "ok" });
});

test("summariseResult reports errors and stringifies non-text results", () => {
  const errored = summariseResult({ type: "result", subtype: "error_during_execution", is_error: true, result: "Not logged in" });
  assert.equal(errored.isError, true);
  assert.equal(errored.text, "Not logged in");
  assert.equal(errored.costUsd, undefined);
  assert.equal(errored.durationMs, undefined);

  const noText = summariseResult({ type: "result", is_error: true, result: { code: 1 } });
  assert.equal(noText.text, '{"code":1}');
  assert.equal(summariseResult({ type: "result" }).text, "null");
});
