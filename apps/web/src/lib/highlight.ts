import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-erb";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import type { DiffHunk } from "./diff";

export type CodeSegment = { text: string; className: string | null };
export type CodeLine = CodeSegment[];

const languageByExtension: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "scss",
  html: "markup",
  xml: "markup",
  svg: "markup",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  rb: "ruby",
  rake: "ruby",
  erb: "erb",
  py: "python",
  java: "java",
  cs: "csharp",
  go: "go",
};

export function languageForPath(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (name === "Gemfile" || name === "Rakefile") {
    return "ruby";
  }
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const language = languageByExtension[extension];
  return language && Prism.languages[language] ? language : null;
}

function tokenClass(token: Prism.Token): string {
  const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  return ["token", token.type, ...aliases].join(" ");
}

function flatten(stream: Prism.TokenStream, parent: string | null, out: CodeSegment[]) {
  if (typeof stream === "string") {
    out.push({ text: stream, className: parent });
    return;
  }
  if (Array.isArray(stream)) {
    for (const item of stream) {
      flatten(item, parent, out);
    }
    return;
  }
  const own = tokenClass(stream);
  flatten(stream.content, parent ? `${parent} ${own}` : own, out);
}

export function highlightLines(code: string, language: string): CodeLine[] {
  const grammar = Prism.languages[language];
  const segments: CodeSegment[] = [];
  if (grammar) {
    flatten(Prism.tokenize(code, grammar), null, segments);
  } else {
    segments.push({ text: code, className: null });
  }

  let current: CodeLine = [];
  const lines: CodeLine[] = [current];
  for (const segment of segments) {
    segment.text.split("\n").forEach((part, index) => {
      if (index > 0) {
        current = [];
        lines.push(current);
      }
      if (part !== "") {
        current.push({ text: part, className: segment.className });
      }
    });
  }
  return lines;
}

export function highlightHunks(hunks: DiffHunk[], language: string | null): CodeLine[][] | null {
  if (!language) {
    return null;
  }
  return hunks.map((hunk) => {
    const oldSide = hunk.lines.filter((line) => line.kind !== "add");
    const newSide = hunk.lines.filter((line) => line.kind !== "del");
    const oldLines = highlightLines(oldSide.map((line) => line.text).join("\n"), language);
    const newLines = highlightLines(newSide.map((line) => line.text).join("\n"), language);

    let oldIndex = 0;
    let newIndex = 0;
    return hunk.lines.map((line) => {
      if (line.kind === "del") {
        return oldLines[oldIndex++] ?? [];
      }
      oldIndex += line.kind === "context" ? 1 : 0;
      return newLines[newIndex++] ?? [];
    });
  });
}
