import { hasIntegration } from "../../integrations.js";
import type { PhasePrompts, PromptContext } from "./contracts.js";

export const phasePrompts: PhasePrompts = {
  context(ctx: PromptContext): string {
    const { review, integrations } = ctx;
    const ticket = !review.jiraKey
      ? "There is no ticket for this pull request, so work from the pull request description alone and say so in your summary."
      : hasIntegration(integrations, "atlassian")
        ? `Fetch Jira ticket ${review.jiraKey} with \`mcp__atlassian__getJiraIssue\`, including its description, acceptance criteria and comments.`
        : `The pull request mentions ticket ${review.jiraKey}, but no ticket tracker is connected, so work from the pull request description alone and say so in your summary.`;
    const design = !review.figmaUrl
      ? "There is no design for this pull request."
      : hasIntegration(integrations, "figma")
        ? `Fetch the Figma frames at ${review.figmaUrl} with \`mcp__figma__get_design_context\` and \`mcp__figma__get_screenshot\`.`
        : `The pull request links a design at ${review.figmaUrl}, but Figma is not connected, so do not try to open it.`;
    return `Phase: context.

Your job in this phase is to understand what this pull request is meant to do, not to review the code.

1. ${ticket}
2. ${design}
3. Read the diff: \`git diff origin/${review.baseRef}...HEAD\`. Read it to learn the shape and scope of the change, not to find faults.
4. Call \`set_intent_summary\` once with two to five plain sentences on what the change is supposed to achieve, as the ticket, design and description describe it.
5. Call \`add_context_gap\` once for each real gap: something the ticket, design and description do not answer and that you need before you can judge the change. Do not ask about things the code can tell you. Zero gaps is a fine answer.
6. Work out the context the tests cannot see, then call \`set_context_checklist\` once, as your last tool call in this phase:
   - \`consumers\`: everything that uses the code this change touches. Grep the worktree and the related repositories for each changed function, endpoint, field and table: callers, a frontend calling a changed endpoint, scheduled jobs, reports, exports, integrations. Cite \`path:line\`.
   - \`data\`: the tables, columns, fields and migrations the change reads or writes, and whether it can be rolled back safely.
   - \`legacy\`: when the change ports a legacy screen or claims parity with an older system, what the old code did, using any connected tool that indexes it. Otherwise \`not_applicable\`.
   - \`acceptance\`: each acceptance criterion from the ticket, with the file or function that covers it, or \`missing\` or \`unclear\`.
   Use \`unknown\` or \`unclear\` only when the code, ticket, design and tools cannot answer it, and give a \`question\` the reviewer can answer; each one becomes a question for the reviewer. When nothing is unknown the review moves on without waiting for the reviewer, so only mark something \`known\` when you checked it.

Then reply in chat with two or three plain sentences: what the change is for, and whether anything is missing. Do not propose findings, do not comment on code quality, and do not call any other tool. Wait for the next phase message.`;
  },

  checkpoint(ctx: PromptContext): string {
    const { review } = ctx;
    return `Phase: checkpoint.

The reviewer has confirmed the context. Your job now is to describe how the author solved the problem, so the reviewer can decide whether the approach is right before anyone reads line by line.

1. Call \`get_review_state\` to pick up any gap answers and reviewer notes.
2. Read the full diff (\`git diff origin/${review.baseRef}...HEAD\`) and open every file it touches. Read the whole file, not the hunk.
3. Find how this repository solves the same kind of problem elsewhere. Use Grep and Glob for similar modules, services, components or utilities, and read them.
4. Call \`set_approach_summary\` once, as a list, not a paragraph:
   - \`overview\`: one line with the overall verdict.
   - \`parts\`: the change split into its separate parts, in reading order. Each part has a short title and short points, one fact per point, in plain words. Keep every technical detail: function, method, table, field, file, setting and value names, in backticks. Do not repeat a point.
   - Put each observation under the part it is about, never in a block at the end. Use \`fits\` when the part matches how this repository already solves the same problem, naming the file it matches. Use \`concern\` when it diverges or may be wrong: say what is wrong, give the evidence with path:line, and say what the alternative is. Set \`checkInReview\` when you will verify it during the line review. Leave \`observations\` empty for a part with nothing worth saying.
   - If the change is one connected feature with no natural split, use a single part and put its observations under it.

Then reply in chat with one sentence. No findings yet: do not call \`propose_finding\` in this phase. Wait for the reviewer's decision.`;
  },

  approachCorrection(note: string): string {
    return `The reviewer has corrected your approach summary. Their note:

${quote(note)}

Re-read whatever the note points at, then call \`set_approach_summary\` again with the corrected parts and observations. Reply in chat with one sentence saying what you changed. Wait for the reviewer's decision.`;
  },

  approachRejected(note: string | null): string {
    const noteBlock = note?.trim()
      ? `Their note:\n\n${quote(note.trim())}\n\nIncorporate it.`
      : "They did not leave a note, so base the comment on your own observation.";
    return `The reviewer has rejected the approach. This review will not go file by file. Instead, draft one comment for the author at pull request level.

${noteBlock}

Call \`propose_finding\` once with no \`path\` and no \`line\`, severity \`blocking\`, confidence \`high\`. The body is written to the author: explain the design concern plainly, point to where the codebase already solves this kind of problem (cite \`path:line\`), and describe the alternative you would expect. Put what you traced in \`evidence\`. Be direct and kind; this comment is asking for a rework.

Then reply in chat with one sentence. Wait for the next message.`;
  },

  plan(ctx: PromptContext): string {
    const { review } = ctx;
    return `Phase: planning.

The reviewer has agreed with the approach. Break the change into the logical steps the author worked in, so the reviewer can go through it in order.

1. List the changed files: \`git diff --name-status origin/${review.baseRef}...HEAD\`.
2. Group the files into steps that each achieve one thing, in the order the author would have built them: for example schema first, then service, then route, then tests. Prefer three to six steps; one step is fine for a small change.
3. Give each step a short title, a one-line purpose and a risk level: \`high\` where a mistake would corrupt data, break authorisation or ship a wrong calculation; \`medium\` for logic the reviewer should read closely; \`low\` for the rest. The risk decides how much the reviewer looks: \`low\` steps are left to you and the verifier unless you raise a finding, \`medium\` steps show the reviewer your findings only, and \`high\` steps get a full read of the diff. So do not mark a step \`low\` unless you would be comfortable nobody reading it. The server raises a step to \`high\` when it touches migrations, authorisation or money.
4. Order the files inside a step by dependency, so the reviewer reads what is depended on first.
5. Mark generated code, lockfiles, snapshots, build output and pure renames with \`skip: true\` and a short \`skipReason\`. Everything else is reviewed.

Call \`set_step_plan\` once with the whole plan.

Then review every file up front, so your concerns are ready when the reviewer opens each file. Work through the steps in plan order and the files in each step in order, leaving out files marked \`skip\`. For each file:

${fileReviewInstructions("<this file>")}

Do not wait between files. Keep chat quiet while you work, then reply with one line saying how many files you reviewed and how many findings you raised.`;
  },

  reviewMissedFiles(files): string {
    const list = files.map((file) => `- \`${file.path}\` (step "${file.stepTitle}")`).join("\n");
    return `The up-front review is not finished. These files have no \`record_file_checked\` yet:

${list}

Review each of them now, in this order, without waiting between files. For each file:

${fileReviewInstructions("<this file>")}

Keep chat quiet while you work, then reply with one line saying how many files you reviewed and how many findings you raised.`;
  },

  fileDoneWithoutComments(path: string): string {
    return `The reviewer has marked \`${path}\` as done without leaving any comments.

If you have a concern about this file that you did not record because your confidence was low, ask it now with \`ask_reviewer\`, with this path, in one sentence. Otherwise reply in chat with exactly: nothing further`;
  },

  reviewerComment(input: { path: string; line: number | null; body: string }): string {
    const where = input.line === null ? `on \`${input.path}\`` : `on \`${input.path}\` line ${input.line}`;
    return `The reviewer wrote this comment ${where}:

${quote(input.body)}

Read the code the comment is about. If the code shows the comment is mistaken, reply once in chat with the evidence, citing \`path:line\`, in plain language. Otherwise reply in chat with exactly: agree

Do not record a finding for this; the reviewer's comment is already recorded.`;
  },

  answerQuestion(input: { question: string; answer: string }): string {
    return `The reviewer has answered your question.

Question:

${quote(input.question)}

Answer:

${quote(input.answer)}

Treat the answer as fact and carry on with what you were doing. If the answer changes a finding you already recorded, say so in one line of chat so the reviewer can update it. Otherwise reply with one short line.`;
  },

  learn(): string {
    return `Phase: done. The accepted comments have been posted to the pull request.

Before you finish, record what this review taught you about the repository and the reviewer, so the next review starts further ahead.

1. Call \`get_review_state\` to see which findings were accepted, rejected and parked, and the reject reasons.
2. Call \`record_memory_entries\` once with at most five entries. Keep each one to one plain sentence that will still be true next month: a reviewer preference, a pattern that keeps coming up in this repository, a correction you were given, or a note about the author. Skip anything specific to this change alone. Zero entries is a fine answer.
3. If a convention surfaced during the review that the repo docs do not state, call \`propose_doc_edit\` with a small diff to the right doc and a one-line rationale. Only do this when you saw the convention applied or asked for; do not invent policy.

Then reply in chat with exactly: done`;
  },

  prUpdated(input): string {
    const files =
      input.updatedPaths && input.updatedPaths.length > 0
        ? `\n\nFiles changed since the last code review:\n\n${input.updatedPaths.map((path) => `- \`${path}\``).join("\n")}`
        : "";
    return `The pull request has changed since you last looked: the head moved from ${input.oldSha.slice(0, 7)} to ${input.newSha.slice(0, 7)}, and the title or description may have changed too. The worktree now has the latest code. Do not trust what you remember about the diff; read it again.${files}`;
  },

  rerun(step): string {
    const instructions = {
      requirements:
        "You have done this phase before. Call `get_review_state` first to see your earlier intent summary and the gaps already asked and answered; you may call it in this phase. Call `set_intent_summary` and `set_context_checklist` again, even if nothing changed. Only add a gap or an unknown for something new that has not already been asked.",
      approach:
        "You have described the approach before, but the context may have changed since. Replace it: call `set_approach_summary` again with fresh parts and observations, and do not assume your earlier ones still hold.",
      code_review:
        "Build the step plan again from scratch; it replaces the earlier plan and resets file progress. Findings already recorded are kept, so do not propose them again when you review files.",
    }[step];
    return `This step is a re-run requested by the reviewer. ${instructions}`;
  },
};

function fileReviewInstructions(path: string): string {
  return `1. Read the whole file in its new version, then its diff against the base ref from the Repository section: \`git diff origin/<base ref>...HEAD -- ${path}\`. Follow what the changed code calls and what calls it.
2. Assume the file has at least one bug or gap, and go looking for it: wrong or inverted conditions, missing checks (authorisation, tenant or company scoping, null and empty values, error paths), unhandled edge cases, values written but never read, and behaviour that breaks a caller.
3. Judge it against the review skill, the repo docs and the memory, in the context of what its step is for.
4. Call \`propose_finding\` for each concern you can tie to a line, with evidence, confidence and a line in the new version of the file. A verifier re-checks each one before the reviewer sees it, so put what you traced in \`evidence\`.
5. If something needs the reviewer's knowledge rather than more reading, ask it once with \`ask_reviewer\`, with this path. One question per file at most.
6. Call \`record_file_checked\` with the specific things you checked and found no problem with, so the reviewer knows what is covered. Call it even when you raised findings.`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
