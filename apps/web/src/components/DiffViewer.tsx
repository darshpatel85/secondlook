import { Fragment, useMemo, type ReactNode } from "react";
import type { Severity } from "../api/types";
import type { DiffHunk } from "../lib/diff";
import { highlightHunks, languageForPath, type CodeLine } from "../lib/highlight";

type DiffViewerProps = {
  path: string;
  hunks: DiffHunk[];
  widgets: Map<number, ReactNode>;
  marks: Map<number, Severity>;
  ranges: Set<number>;
  activeLine: number | null;
  onPickLine: (line: number) => void;
};

export function DiffViewer({ path, hunks, widgets, marks, ranges, activeLine, onPickLine }: DiffViewerProps) {
  const highlighted = useMemo(() => highlightHunks(hunks, languageForPath(path)), [hunks, path]);

  if (hunks.length === 0) {
    return <p className="muted">No textual changes to show for this file.</p>;
  }

  return (
    <table className="diff">
      <colgroup>
        <col className="diff-col-no" />
        <col className="diff-col-no" />
        <col className="diff-col-sign" />
        <col />
      </colgroup>
      <tbody>
        {hunks.map((hunk, hunkIndex) => (
          <Fragment key={hunkIndex}>
            <tr className="diff-hunk">
              <td colSpan={4}>{hunk.header}</td>
            </tr>
            {hunk.lines.map((line, lineIndex) => {
              const newNo = line.newNo;
              const widget = newNo !== null ? widgets.get(newNo) : undefined;
              const mark = newNo !== null ? marks.get(newNo) : undefined;
              const inRange = newNo !== null && ranges.has(newNo);
              return (
                <Fragment key={lineIndex}>
                  <tr
                    className="diff-line"
                    data-kind={line.kind}
                    data-marked={mark ?? undefined}
                    data-range={inRange || undefined}
                    data-active={newNo !== null && newNo === activeLine ? "true" : undefined}
                  >
                    <td className="diff-no">{line.oldNo ?? ""}</td>
                    <td className="diff-no diff-no-new">
                      {newNo !== null ? (
                        <>
                          <button
                            type="button"
                            className="diff-add-comment"
                            aria-label={`Comment on line ${newNo}`}
                            title="Comment on this line"
                            onClick={() => onPickLine(newNo)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="diff-no-button"
                            aria-label={`Comment on line ${newNo}`}
                            title="Comment on this line"
                            onClick={() => onPickLine(newNo)}
                          >
                            {newNo}
                          </button>
                        </>
                      ) : null}
                    </td>
                    <td className="diff-sign">
                      {mark ? <span className="severity-dot" data-severity={mark} aria-hidden="true" /> : null}
                      {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
                    </td>
                    <td className="diff-code">
                      <pre>{renderCode(line.text, highlighted?.[hunkIndex]?.[lineIndex])}</pre>
                    </td>
                  </tr>
                  {widget ? (
                    <tr className="diff-widget">
                      <td colSpan={4}>{widget}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function renderCode(text: string, segments: CodeLine | undefined): ReactNode {
  if (text === "") {
    return " ";
  }
  if (!segments) {
    return text;
  }
  return segments.map((segment, index) =>
    segment.className ? (
      <span key={index} className={segment.className}>
        {segment.text}
      </span>
    ) : (
      segment.text
    ),
  );
}
