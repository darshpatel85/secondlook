import type { AgentQuestion, Confidence, Finding, ReviewDetail, Severity, StepFile, StepWithFiles } from "../api/types";

export const severityLabels: Record<Severity, string> = {
  blocking: "blocking",
  should_fix: "should fix",
  nit: "nit",
  question: "question",
};

export const confidenceLabels: Record<Confidence, string> = {
  low: "low confidence",
  medium: "medium confidence",
  high: "high confidence",
};

export const severityOrder: Severity[] = ["blocking", "should_fix", "nit", "question"];

export function isActive(finding: Finding): boolean {
  return finding.status === "accepted" || finding.status === "posted";
}

const testFilePatterns = [
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|specs?|e2e|cypress|playwright)\//i,
  /\.(test|spec|e2e|cy)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /_(test|spec)\.(py|go|rb|exs?)$/i,
  /Tests?\.(java|kt|cs|swift)$/,
  /\.snap$/i,
];

export function isTestFile(path: string): boolean {
  return testFilePatterns.some((pattern) => pattern.test(path));
}

export function withoutTestFiles(steps: StepWithFiles[]): StepWithFiles[] {
  return steps.map((step) => ({ ...step, files: step.files.filter((file) => !isTestFile(file.path)) }));
}

export function onlyUpdatedFiles(steps: StepWithFiles[], updatedPaths: Set<string>): StepWithFiles[] {
  return steps.map((step) => ({ ...step, files: step.files.filter((file) => updatedPaths.has(file.path)) }));
}

export function selectableFiles(steps: StepWithFiles[]): StepFile[] {
  return steps.flatMap((step) => step.files.filter((file) => !file.skipped));
}

export function stepForFile(steps: StepWithFiles[], file: StepFile | null): StepWithFiles | null {
  return file ? (steps.find((step) => step.id === file.stepId) ?? null) : null;
}

export function defaultFile(steps: StepWithFiles[]): StepFile | null {
  const files = selectableFiles(steps);
  return files.find((file) => file.state === "in_progress") ?? files.find((file) => file.state !== "done") ?? files[0] ?? null;
}

export function nextUndoneFile(steps: StepWithFiles[], afterId: string): StepFile | null {
  const files = selectableFiles(steps);
  const index = files.findIndex((file) => file.id === afterId);
  const ordered = index === -1 ? files : [...files.slice(index + 1), ...files.slice(0, index)];
  return ordered.find((file) => file.state !== "done") ?? null;
}

export function neighbourFile(steps: StepWithFiles[], currentId: string | null, direction: 1 | -1): StepFile | null {
  const files = selectableFiles(steps);
  if (files.length === 0) {
    return null;
  }
  const index = files.findIndex((file) => file.id === currentId);
  if (index === -1) {
    return direction === 1 ? (files[0] ?? null) : (files[files.length - 1] ?? null);
  }
  return files[Math.min(files.length - 1, Math.max(0, index + direction))] ?? null;
}

export function fileProgress(steps: StepWithFiles[]): { done: number; total: number } {
  const files = selectableFiles(steps);
  return { done: files.filter((file) => file.state === "done").length, total: files.length };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function rubberStampedFiles(detail: ReviewDetail, step: StepWithFiles): StepFile[] {
  if (step.risk !== "high") {
    return [];
  }
  const reviewerChat = detail.chat.filter((message) => message.role === "reviewer");
  return step.files.filter((file) => {
    if (file.skipped || file.state !== "done") {
      return false;
    }
    const commented = detail.findings.some(
      (finding) =>
        finding.path === file.path &&
        ((finding.origin !== "ai" && finding.status !== "rejected") || (finding.origin === "ai" && isActive(finding))),
    );
    if (commented) {
      return false;
    }
    const name = baseName(file.path);
    return !reviewerChat.some((message) => message.content.includes(name));
  });
}

export function findingsForFile(findings: Finding[], path: string): Finding[] {
  return findings.filter((finding) => finding.path === path).sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.createdAt - b.createdAt);
}

export function aiFindingsHidden(step: StepWithFiles | null, file: StepFile): boolean {
  return step?.routing === "full" && step.reviewMode === "look_first" && file.state !== "done";
}

export function needsReviewer(file: StepFile, findings: Finding[], questions: AgentQuestion[]): boolean {
  const open = findings.some(
    (finding) => finding.path === file.path && finding.origin === "ai" && finding.status === "proposed" && finding.verification !== "refuted",
  );
  return open || questions.some((question) => question.path === file.path && !question.answer);
}

export function splitHandled(step: StepWithFiles, findings: Finding[], questions: AgentQuestion[]): { attention: StepFile[]; handled: StepFile[] } {
  const files = step.files.filter((file) => !file.skipped);
  if (step.routing !== "auto") return { attention: files, handled: [] };
  const attention = files.filter((file) => file.checked === null || file.state !== "not_started" || needsReviewer(file, findings, questions));
  return { attention, handled: files.filter((file) => !attention.includes(file)) };
}

export function withoutHandledFiles(steps: StepWithFiles[], findings: Finding[], questions: AgentQuestion[]): StepWithFiles[] {
  return steps.map((step) => {
    const { handled } = splitHandled(step, findings, questions);
    return handled.length === 0 ? step : { ...step, files: step.files.filter((file) => !handled.includes(file)) };
  });
}

export function awaitingVerifier(finding: Finding): boolean {
  return finding.verification === "pending";
}

export function dismissedByVerifier(finding: Finding): boolean {
  return finding.verification === "refuted" && finding.status === "proposed";
}

export function inReview(finding: Finding): boolean {
  return !awaitingVerifier(finding) && !dismissedByVerifier(finding);
}

export type VisibleFindings = { shown: Finding[]; hidden: Finding[]; checking: Finding[]; dismissed: Finding[] };

export function visibleFindings(findings: Finding[], step: StepWithFiles | null, file: StepFile): VisibleFindings {
  const all = findingsForFile(findings, file.path);
  if (aiFindingsHidden(step, file)) {
    return {
      shown: all.filter((finding) => finding.origin !== "ai"),
      hidden: all.filter((finding) => finding.origin === "ai"),
      checking: [],
      dismissed: [],
    };
  }
  return { shown: all.filter(inReview), hidden: [], checking: all.filter(awaitingVerifier), dismissed: all.filter(dismissedByVerifier) };
}

export function countBySeverity(findings: Finding[]): Array<{ severity: Severity; count: number }> {
  return severityOrder
    .map((severity) => ({ severity, count: findings.filter((finding) => finding.severity === severity).length }))
    .filter((entry) => entry.count > 0);
}
