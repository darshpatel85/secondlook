import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findLoginUrl, parseStatus } from "./claude-auth.js";

describe("parseStatus", () => {
  it("reads loggedIn and authMethod", () => {
    assert.deepEqual(parseStatus('{"loggedIn":true,"authMethod":"claude.ai"}'), { loggedIn: true, authMethod: "claude.ai" });
  });

  it("returns undefined for output that is not status json", () => {
    assert.equal(parseStatus("not json"), undefined);
    assert.equal(parseStatus('{"authMethod":"none"}'), undefined);
  });
});

describe("findLoginUrl", () => {
  it("picks the first https link from the login output", () => {
    assert.equal(findLoginUrl("Opening browser...\nOr visit https://claude.ai/oauth/authorize?code=abc\n"), "https://claude.ai/oauth/authorize?code=abc");
  });

  it("returns null when no link was printed", () => {
    assert.equal(findLoginUrl("Opening browser..."), null);
  });
});
