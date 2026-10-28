export type DiffLineKind = "context" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const rows = patch.split("\n");
  if (rows[rows.length - 1] === "") {
    rows.pop();
  }

  for (const raw of rows) {
    const match = hunkHeader.exec(raw);
    if (match) {
      oldNo = Number(match[1]);
      newNo = Number(match[2]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith("\\")) {
      continue;
    }
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", oldNo: null, newNo, text });
      newNo += 1;
    } else if (marker === "-") {
      current.lines.push({ kind: "del", oldNo, newNo: null, text });
      oldNo += 1;
    } else if (marker === " " || raw === "") {
      current.lines.push({ kind: "context", oldNo, newNo, text });
      oldNo += 1;
      newNo += 1;
    }
  }

  return hunks.filter((hunk) => hunk.lines.length > 0);
}

export function newLinesInPatch(hunks: DiffHunk[]): Set<number> {
  const lines = new Set<number>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.newNo !== null) {
        lines.add(line.newNo);
      }
    }
  }
  return lines;
}
