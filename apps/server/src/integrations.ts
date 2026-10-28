import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";

export type StdioServer = { type: "stdio"; command: string; args: string[]; env: Record<string, string> };
export type RemoteServer = { type: "sse" | "http"; url: string };
export type McpServer = StdioServer | RemoteServer;

export type Integration = { name: string; label: string; server: McpServer; guidance: string | null };

export const defaultJiraUrl = "https://mcp.atlassian.com/v2/mcp";
export const defaultFigmaUrl = "https://mcp.figma.com/mcp";

const reservedNames = new Set(["dashboard", "atlassian", "figma"]);

const extras = { label: z.string().min(1).optional(), guidance: z.string().min(1).optional() };

const customServer = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    ...extras,
  }),
  z.object({ type: z.enum(["http", "sse"]), url: z.string().url(), ...extras }),
]);

export const integrationSettings = z
  .object({
    jira: z
      .object({ url: z.string().url().default(defaultJiraUrl), siteUrl: z.string().url().optional() })
      .strict()
      .optional(),
    figma: z.object({ url: z.string().url().default(defaultFigmaUrl) }).strict().optional(),
    servers: z
      .record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"), customServer)
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const name of Object.keys(value.servers)) {
      if (reservedNames.has(name)) ctx.addIssue({ code: "custom", path: ["servers", name], message: `"${name}" is a reserved name` });
    }
  });

export type IntegrationSettings = z.infer<typeof integrationSettings>;

export function readIntegrationSettings(file: string = config.integrationsFile): IntegrationSettings {
  if (!fs.existsSync(file)) return { servers: {} };
  const result = integrationSettings.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`${file} is not valid: ${problems}`);
  }
  return result.data;
}

export function writeIntegrationSettings(input: unknown, file: string = config.integrationsFile): IntegrationSettings {
  const settings = integrationSettings.parse(input);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

export function loadIntegrations(file: string = config.integrationsFile): Integration[] {
  const settings = readIntegrationSettings(file);
  const list: Integration[] = [];
  if (settings.jira) list.push({ name: "atlassian", label: "Jira", server: { type: "http", url: settings.jira.url }, guidance: null });
  if (settings.figma) list.push({ name: "figma", label: "Figma", server: { type: "http", url: settings.figma.url }, guidance: null });
  for (const [name, { label, guidance, ...server }] of Object.entries(settings.servers)) {
    list.push({ name, label: label ?? name, server, guidance: guidance ?? null });
  }
  return list;
}

export function hasIntegration(integrations: Integration[], name: string): boolean {
  return integrations.some((integration) => integration.name === name);
}
