import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checklistQuestions, routeStep } from "./routing.js";

describe("routeStep", () => {
  it("maps risk to how much the reviewer looks", () => {
    assert.deepEqual(routeStep("low", ["src/utils/format.ts"]), { risk: "low", routing: "auto", riskReason: null });
    assert.deepEqual(routeStep("medium", ["src/widgets/list.ts"]), { risk: "medium", routing: "findings", riskReason: null });
    assert.deepEqual(routeStep("high", ["db/migrate/001_add.rb"]), { risk: "high", routing: "full", riskReason: null });
  });

  it("raises sensitive paths to a full review whatever the agent said", () => {
    const cases = ["db/migrate/20260101_add_tax.rb", "src/auth/session.ts", "app/policies/invoice_policy.rb", "src/pricing/discount.ts", "sql/fix.sql"];
    for (const path of cases) {
      const routed = routeStep("low", ["README.md", path]);
      assert.equal(routed.routing, "full", path);
      assert.equal(routed.risk, "high", path);
      assert.match(routed.riskReason ?? "", new RegExp(path.replace(/[.]/g, "\\.")));
    }
  });
});

describe("checklistQuestions", () => {
  const known = { status: "known" as const, summary: "Checked.", evidence: [] };

  it("asks one question per unknown area and unclear criterion", () => {
    const questions = checklistQuestions({
      consumers: { status: "unknown", summary: "Could not find the report job.", evidence: [], question: "Does the nightly report read this column?" },
      data: { status: "unknown", summary: "No migration found.", evidence: [] },
      legacy: { status: "not_applicable", summary: "New feature.", evidence: [] },
      acceptance: [
        { criterion: "Cap at 50k rows", status: "covered", coveredBy: "export.ts:40" },
        { criterion: "Email when ready", status: "missing" },
        { criterion: "Admins only", status: "unclear" },
      ],
    });
    assert.deepEqual(questions, [
      "Does the nightly report read this column?",
      "I could not work out the data this change touches: No migration found.",
      'Is this acceptance criterion covered, and where? "Admins only"',
    ]);
  });

  it("asks nothing when everything is known", () => {
    assert.deepEqual(checklistQuestions({ consumers: known, data: known, legacy: known, acceptance: [] }), []);
  });
});
