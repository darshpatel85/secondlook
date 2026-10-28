import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, Caption, Card, Code, FadeUp, Pill, Stage, StepLabel, usePop } from "../ui";

const rows = [
  { sev: "should fix", text: "Export skips the branch check", decision: "accept" },
  { sev: "nit", text: "Prefer `const` for `rows`", decision: "reject" },
  { sev: "question", text: "Should the toast show row counts?", decision: "park" },
] as const;

export function StepPost() {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [225, 240], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fly = usePop(120, { damping: 16, stiffness: 90, mass: 1 });
  const posted = usePop(160, { damping: 12 });
  return (
    <Background>
      <AbsoluteFill style={{ opacity: exit, padding: "100px 140px", display: "flex", flexDirection: "column" }}>
        <StepLabel n={4} title="Post what you accept" />

        <Stage><div style={{ width: "100%" }}><div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
          <div style={{ width: 820, display: "flex", flexDirection: "column", gap: 16 }}>
            {rows.map((r, i) => (
              <Row key={i} delay={20 + i * 12} decideAt={60 + i * 18} {...r} />
            ))}
            <FadeUp delay={100} style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <div style={{ background: colors.brand, color: colors.bg, fontSize: 28, fontWeight: 700, padding: "16px 36px", borderRadius: 14, transform: `scale(${frame > 118 && frame < 128 ? 0.95 : 1})` }}>
                Post 1 finding
              </div>
            </FadeUp>
          </div>

          <div style={{ flex: 1, position: "relative", minHeight: 420 }}>
            <div style={{ position: "absolute", inset: 0, opacity: fly, transform: `translateX(${(1 - fly) * -400}px) scale(${0.7 + fly * 0.3})` }}>
              <Card style={{ padding: 0, overflow: "hidden", borderColor: posted > 0.5 ? colors.success : colors.border }}>
                <div style={{ padding: "16px 24px", background: colors.surfaceMuted, borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 12, fontSize: 22 }}>
                  <GitHubMark />
                  <span style={{ fontWeight: 700 }}>acme/widgets-api</span>
                  <span style={{ color: colors.muted }}>· Pull request #412</span>
                </div>
                <div style={{ padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 21, color: colors.muted, marginBottom: 10 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 14, background: colors.brand }} />
                    <span style={{ fontWeight: 700, color: colors.text }}>darsh</span>
                    <span>reviewed</span>
                    <span style={{ fontFamily: mono, marginLeft: "auto" }}>src/orders/export.ts L42</span>
                  </div>
                  <div style={{ fontSize: 26, lineHeight: 1.45 }}>
                    This export misses the branch check the list endpoint does, so anyone signed in can pull every branch's rows. Could you run it through <Code>scopeToBranch</Code> first?
                  </div>
                </div>
                <div style={{ position: "absolute", top: 14, right: 20, opacity: posted, transform: `scale(${0.6 + posted * 0.4})` }}>
                  <Pill color={colors.success} bg={colors.successSoft} style={{ fontSize: 20 }}>✓ posted</Pill>
                </div>
              </Card>
            </div>
          </div>
        </div>
        </div></Stage>
        <Caption delay={175}>Written like a teammate. Posted under your name, only when you say so.</Caption>
      </AbsoluteFill>
    </Background>
  );
}

function Row({ sev, text, decision, delay, decideAt }: { sev: string; text: string; decision: "accept" | "reject" | "park"; delay: number; decideAt: number }) {
  const p = usePop(delay, { damping: 16 });
  const d = usePop(decideAt, { damping: 12 });
  const colorFor = { accept: [colors.success, colors.successSoft], reject: [colors.error, colors.errorSoft], park: [colors.muted, colors.surfaceMuted] } as const;
  const [c, bg] = colorFor[decision];
  const sevColor = sev === "should fix" ? colors.warning : sev === "question" ? colors.brand : colors.muted;
  return (
    <div style={{ opacity: p * (decision === "accept" || d < 0.5 ? 1 : 0.55), transform: `translateX(${(1 - p) * -40}px)` }}>
      <Card style={{ padding: "18px 24px", display: "flex", alignItems: "center", gap: 18, borderColor: decision === "accept" && d > 0.5 ? colors.success : colors.border }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: sevColor, textTransform: "uppercase", letterSpacing: 1, width: 130 }}>{sev}</span>
        <span style={{ fontSize: 26, flex: 1 }}>{text}</span>
        <div style={{ display: "flex", gap: 8 }}>
          {(["accept", "park", "reject"] as const).map((b) => {
            const chosen = b === decision && d > 0.3;
            return (
              <span key={b} style={{ fontSize: 20, fontWeight: 600, padding: "6px 16px", borderRadius: 10, border: `1.5px solid ${chosen ? c : colors.border}`, background: chosen ? bg : "transparent", color: chosen ? c : colors.muted, transform: chosen ? `scale(${1 + (1 - d) * 0.3})` : undefined, textTransform: "capitalize" }}>
                {b}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function GitHubMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 16 16" fill={colors.text}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
