import { z } from "zod";
import { checklistStatuses, confidences, coverageStatuses, memorySections, observationVerdicts, riskLevels, severities } from "../../db/schema.js";

const checklistArea = (what: string) =>
  z
    .object({
      status: z.enum(checklistStatuses).describe("known: you checked and can show it. unknown: the code, ticket, design and tools cannot answer it. not_applicable: does not apply to this change"),
      summary: z.string().min(1).describe(`One or two plain sentences on ${what}`),
      evidence: z.array(z.string().min(1)).default([]).describe("path:line references, repo names or tool results that back the summary"),
      question: z.string().optional().describe("Required when status is unknown: one question the reviewer can answer"),
    })
    .describe(what);

export const toolShapes = {
  set_intent_summary: {
    summary: z.string().min(1).describe("Plain-language statement of what this PR is supposed to do, 2 to 5 sentences"),
  },
  add_context_gap: {
    question: z.string().min(1).describe("One specific question the ticket, design and PR do not answer"),
  },
  set_context_checklist: {
    consumers: checklistArea("everything that uses the code this change touches: callers, other repositories, scheduled jobs, reports, exports, integrations"),
    data: checklistArea("the tables, columns, fields and migrations the change reads or writes, and whether it can be rolled back safely"),
    legacy: checklistArea("what the legacy system did, when the change ports or claims parity with legacy behaviour"),
    acceptance: z
      .array(
        z.object({
          criterion: z.string().min(1).describe("One acceptance criterion from the ticket, in short"),
          status: z.enum(coverageStatuses).describe("covered: code implements it. missing: nothing implements it. unclear: you cannot tell"),
          coveredBy: z.string().optional().describe("The file, function or path:line that covers it"),
          question: z.string().optional().describe("For unclear: one question the reviewer can answer"),
        }),
      )
      .default([])
      .describe("Each acceptance criterion mapped to the code. Empty when there is no ticket or no criteria"),
  },
  set_approach_summary: {
    overview: z.string().min(1).describe("One line: the overall verdict, e.g. 'Follows existing patterns; one concern in the time helper (part 7)'"),
    parts: z
      .array(
        z.object({
          title: z.string().min(1).describe("Short name for this part of the change, e.g. 'New WorkflowService lookups'"),
          points: z
            .array(z.string().min(1))
            .min(1)
            .describe("One fact per point, short. Keep every function, table, file, setting and value name, in backticks"),
          observations: z
            .array(
              z.object({
                verdict: z.enum(observationVerdicts).describe("fits: matches how the repo already does this. concern: diverges or may be wrong"),
                title: z.string().min(1).describe("A few words, e.g. 'Matches LockCleanerConfigService', 'Wrong place', 'Possible bug'"),
                points: z
                  .array(z.string().min(1))
                  .min(1)
                  .describe("For a concern: what is wrong, the evidence with path:line, and the alternative. For fits: the pattern it matches, with a path"),
                checkInReview: z.boolean().optional().describe("True when you will verify this concern during the line review"),
              }),
            )
            .default([])
            .describe("Observations about this part only. Empty when there is nothing to say"),
        }),
      )
      .min(1)
      .describe("The change split into its separate parts, in reading order. Use a single part when the change is one connected feature"),
  },
  set_step_plan: {
    steps: z
      .array(
        z.object({
          title: z.string().min(1),
          purpose: z.string().min(1).describe("One line on what this step achieves"),
          risk: z.enum(riskLevels),
          files: z
            .array(
              z.object({
                path: z.string().min(1),
                skip: z.boolean().optional().describe("True for generated code, lockfiles, snapshots, pure renames"),
                skipReason: z.string().optional(),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  },
  propose_finding: {
    path: z.string().optional().describe("Omit for a PR-level comment"),
    line: z.number().int().positive().optional().describe("Line in the new version of the file"),
    endLine: z.number().int().positive().optional(),
    severity: z.enum(severities),
    title: z.string().min(1),
    body: z
      .string()
      .min(1)
      .describe(
        "The comment as posted to the author, on its own: one to three short, friendly sentences like a teammate's GitHub review comment, saying the problem and the fix. No headings, labels or lists",
      ),
    evidence: z
      .string()
      .optional()
      .describe("What you traced or read to confirm this, with path:line. Only the reviewer sees it. Required for blocking and should_fix"),
    confidence: z.enum(confidences),
  },
  record_file_checked: {
    path: z.string().min(1),
    checked: z.array(z.string().min(1)).min(1).describe("Each thing you checked in this file and found nothing wrong with"),
  },
  ask_reviewer: {
    question: z.string().min(1),
    path: z.string().optional(),
  },
  propose_doc_edit: {
    path: z.string().min(1).describe("Repo-relative path of the markdown doc"),
    diff: z.string().min(1).describe("Unified diff against the current file"),
    rationale: z.string().min(1),
  },
  record_memory_entries: {
    entries: z
      .array(
        z.object({
          section: z.enum(memorySections),
          text: z.string().min(1).describe("One line, specific, no more than 30 words"),
        }),
      )
      .min(1),
  },
  get_review_state: {},
} as const;

export type ToolName = keyof typeof toolShapes;

export const toolDescriptions: Record<ToolName, string> = {
  set_intent_summary: "Record what this PR is supposed to do, derived from the ticket, design and PR description. Call once in the context phase.",
  add_context_gap: "Record one question the reviewer must answer before review can start. Call once per gap.",
  set_context_checklist:
    "Record the context the tests cannot see: what uses the changed code, the data it touches, legacy behaviour and acceptance coverage. Each unknown becomes a question for the reviewer. Call once, last, in the context phase.",
  set_approach_summary: "Record how the author approached the problem as a list of parts, each with short points and its own observations.",
  set_step_plan: "Record the ordered logical steps of the change, each with a risk level and its files in dependency order.",
  propose_finding: "Propose one review comment on a file and line, with evidence and confidence. The reviewer decides whether it ships.",
  record_file_checked: "After reviewing a file, record what you checked and found nothing wrong with, so the reviewer knows your coverage.",
  ask_reviewer: "Ask the reviewer one question you cannot answer from the code, ticket or design. Use sparingly.",
  propose_doc_edit: "Propose an edit to a repo markdown doc when a review reveals an unwritten or outdated rule. Needs reviewer approval.",
  record_memory_entries: "At the end of a review, record what you learned about this reviewer, this repo and this author. Shown to the reviewer as a diff.",
  get_review_state: "Fetch the current review state: gap answers, reviewer notes, step plan, finding statuses and unanswered questions.",
};

export const toolNames = Object.keys(toolShapes) as ToolName[];

export const toolInputSchemas = Object.fromEntries(
  toolNames.map((name) => [name, z.object(toolShapes[name])]),
) as { [K in ToolName]: z.ZodObject<(typeof toolShapes)[K]> };

export type ToolInput<K extends ToolName> = z.infer<(typeof toolInputSchemas)[K]>;
