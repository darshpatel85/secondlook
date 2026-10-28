import { spawn, type ChildProcess } from "node:child_process";
import { config } from "../config.js";
import { childEnv } from "./agent/process.js";

export type LoginState = { running: boolean; url: string | null; error: string | null; startedAt: number | null };
export type ClaudeAuthStatus = { loggedIn: boolean; authMethod: string | null; error?: string; login: LoginState };

const statusTimeoutMs = 15_000;
const loginTimeoutMs = 5 * 60 * 1000;

let login: LoginState = { running: false, url: null, error: null, startedAt: null };
let loginChild: ChildProcess | undefined;

export function parseStatus(stdout: string): { loggedIn: boolean; authMethod: string | null } | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const status = parsed as { loggedIn?: unknown; authMethod?: unknown };
    if (typeof status.loggedIn !== "boolean") return undefined;
    return { loggedIn: status.loggedIn, authMethod: typeof status.authMethod === "string" ? status.authMethod : null };
  } catch {
    return undefined;
  }
}

export function findLoginUrl(output: string): string | null {
  return output.match(/https:\/\/\S+/)?.[0] ?? null;
}

function readStatus(): Promise<{ loggedIn: boolean; authMethod: string | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(config.claudeBin, ["auth", "status", "--json"], { env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const finish = (result: { loggedIn: boolean; authMethod: string | null; error?: string }): void => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => finish({ loggedIn: false, authMethod: null, error: "auth status timed out" }), statusTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => finish({ loggedIn: false, authMethod: null, error: error.message }));
    child.on("close", () => {
      const status = parseStatus(stdout);
      finish(status ?? { loggedIn: false, authMethod: null, error: stderr.trim() || "could not read auth status" });
    });
  });
}

export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const status = await readStatus();
  return { ...status, login };
}

export function startClaudeLogin(): LoginState {
  if (login.running) return login;
  login = { running: true, url: null, error: null, startedAt: Date.now() };
  const child = spawn(config.claudeBin, ["auth", "login"], { env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
  loginChild = child;
  let output = "";
  const onOutput = (chunk: Buffer): void => {
    output += chunk.toString();
    if (!login.url) login = { ...login, url: findLoginUrl(output) };
  };
  const finish = (error: string | null): void => {
    if (loginChild !== child) return;
    clearTimeout(timer);
    loginChild = undefined;
    login = { ...login, running: false, error };
  };
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish("sign-in timed out");
  }, loginTimeoutMs);
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  child.on("error", (error) => finish(error.message));
  child.on("close", (code) => finish(code === 0 ? null : output.trim().split("\n").at(-1) || `claude auth login exited with ${code}`));
  return login;
}
