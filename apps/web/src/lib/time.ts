const units: Array<[label: string, ms: number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatRelative(epochMs: number, now: number = Date.now()): string {
  const diff = now - epochMs;
  if (diff < 60_000) {
    return "just now";
  }
  for (const [label, ms] of units) {
    const count = Math.floor(diff / ms);
    if (count >= 1) {
      return `${count} ${label}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
