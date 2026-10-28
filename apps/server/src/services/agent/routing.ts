import type { ContextChecklist, StepRouting } from "../../db/schema.js";

type Risk = "low" | "medium" | "high";

const sensitivePaths: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /migrat|\.sql$|(^|\/)schema\.(rb|ts|prisma|sql)$/i, reason: "changes the database schema" },
  { pattern: /auth|permission|polic(y|ies)|(^|\/)roles?\b|access[-_]?control|secur/i, reason: "touches authorisation or security" },
  { pattern: /payment|pric(e|ing)|tax|ledger|billing|currency/i, reason: "touches money or pricing" },
];

export const routingForRisk: Record<Risk, StepRouting> = { low: "auto", medium: "findings", high: "full" };

export function sensitiveReason(paths: string[]): string | null {
  for (const { pattern, reason } of sensitivePaths) {
    const hit = paths.find((path) => pattern.test(path));
    if (hit) return `\`${hit}\` ${reason}`;
  }
  return null;
}

export function routeStep(risk: Risk, paths: string[]): { risk: Risk; routing: StepRouting; riskReason: string | null } {
  const reason = risk === "high" ? null : sensitiveReason(paths);
  const effective: Risk = reason ? "high" : risk;
  return { risk: effective, routing: routingForRisk[effective], riskReason: reason };
}

export function checklistQuestions(checklist: ContextChecklist): string[] {
  const labels = { consumers: "what uses the changed code", data: "the data this change touches", legacy: "the legacy behaviour" } as const;
  const questions: string[] = [];
  for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
    const area = checklist[key];
    if (area.status !== "unknown") continue;
    questions.push(area.question?.trim() || `I could not work out ${labels[key]}: ${area.summary}`);
  }
  for (const item of checklist.acceptance) {
    if (item.status !== "unclear") continue;
    questions.push(item.question?.trim() || `Is this acceptance criterion covered, and where? "${item.criterion}"`);
  }
  return questions;
}
