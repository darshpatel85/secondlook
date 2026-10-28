import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, Caption, Card, Code, FadeUp, Pill, Stage, StepLabel, usePop } from "../ui";

const steps = [
  { title: "Rename export helpers", risk: "low", files: 2 },
  { title: "Add export endpoint and permissions", risk: "high", files: 3 },
  { title: "Stream rows to the client", risk: "medium", files: 1 },
  { title: "Progress toast", risk: "low", files: 2 },
] as const;

const riskColor = { low: [colors.success, colors.successSoft], medium: [colors.warning, colors.warningSoft], high: [colors.error, colors.errorSoft] } as const;

export function StepReview() {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [315, 330], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const active = frame > 70;
  const verifyStart = 185;
  const verified = usePop(verifyStart + 55, { damping: 10, stiffness: 160 });
  const checking = frame >= verifyStart && frame < verifyStart + 55;
  return (
    <Background>
      <AbsoluteFill style={{ opacity: exit, padding: "100px 140px", display: "flex", flexDirection: "column" }}>
        <StepLabel n={3} title="Walk the change together" />

        <Stage><div style={{ width: "100%" }}><div style={{ display: "flex", gap: 32, }}>
          <div style={{ width: 700, display: "flex", flexDirection: "column", gap: 14 }}>
            {steps.map((s, i) => (
              <StepRow key={i} delay={20 + i * 10} isActive={active && i === 1} done={i === 0 && frame > 60} {...s} />
            ))}
            <FadeUp delay={70} style={{ fontSize: 22, color: colors.muted, marginTop: 10, lineHeight: 1.4 }}>
              Routed by risk. Auth, migrations and money always get a full read.
            </FadeUp>
          </div>

          <div style={{ flex: 1 }}>
            <FadeUp delay={100} distance={30}>
              <Card accent={colors.warning} style={{ position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <Pill color={colors.warning} bg={colors.warningSoft} style={{ fontSize: 20, letterSpacing: 1, textTransform: "uppercase" }}>should fix</Pill>
                  <span style={{ fontFamily: mono, fontSize: 22, color: colors.muted }}>src/orders/export.ts:42</span>
                </div>
                <div style={{ fontSize: 29, lineHeight: 1.4 }}>
                  The export skips the branch check that the list endpoint does, so any signed-in user can download every branch's rows. Reuse <Code>scopeToBranch</Code> before the query.
                </div>
                <FadeUp delay={135} style={{ marginTop: 18, fontFamily: mono, fontSize: 21, color: colors.muted, lineHeight: 1.5 }}>
                  Evidence: export.ts:42 builds the query from <span style={{ color: colors.text }}>req.query.branch</span> with no auth; orders/list.ts:18 calls <span style={{ color: colors.text }}>scopeToBranch(req.user)</span> first.
                </FadeUp>

                <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 16, minHeight: 56 }}>
                  {checking ? (
                    <>
                      <Spinner />
                      <span style={{ fontSize: 24, color: colors.muted }}>A second agent is trying to prove this wrong…</span>
                    </>
                  ) : frame >= verifyStart + 55 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 14, transform: `scale(${0.8 + verified * 0.2})`, opacity: verified }}>
                      <span style={{ width: 40, height: 40, borderRadius: 20, background: colors.success, color: colors.bg, display: "grid", placeItems: "center", fontSize: 26, fontWeight: 800 }}>✓</span>
                      <span style={{ fontSize: 26, fontWeight: 700, color: colors.success }}>Verified</span>
                      <span style={{ fontSize: 23, color: colors.muted }}>Read the auth middleware. The gap is real.</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 24, color: colors.muted, opacity: 0.5 }}>Queued for verification</span>
                  )}
                </div>
              </Card>
            </FadeUp>
          </div>
        </div>
        </div></Stage>
        <Caption delay={260}>Every finding is challenged before you see it.</Caption>
      </AbsoluteFill>
    </Background>
  );
}

function StepRow({ title, risk, files, delay, isActive, done }: { title: string; risk: keyof typeof riskColor; files: number; delay: number; isActive: boolean; done: boolean }) {
  const p = usePop(delay, { damping: 16 });
  const a = usePop(isActive ? 70 : 0, { damping: 14 });
  const [c, bg] = riskColor[risk];
  return (
    <div
      style={{
        opacity: p * (done ? 0.5 : 1),
        transform: `translateX(${(1 - p) * -40}px)`,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 24px",
        borderRadius: 14,
        background: isActive ? colors.brandSoft : colors.surface,
        border: `1.5px solid ${isActive ? colors.brand : colors.border}`,
        boxShadow: isActive ? `0 0 ${a * 40}px rgba(143,136,232,0.35)` : undefined,
      }}
    >
      <Pill color={c} bg={bg} style={{ fontSize: 18, width: 108, justifyContent: "center" }}>{risk}</Pill>
      <span style={{ fontSize: 27, fontWeight: isActive ? 700 : 500, flex: 1, textDecoration: done ? "line-through" : undefined }}>{title}</span>
      <span style={{ fontSize: 20, color: colors.muted }}>{done ? "✓" : `${files} files`}</span>
    </div>
  );
}

function Spinner() {
  const frame = useCurrentFrame();
  return (
    <span style={{ width: 34, height: 34, borderRadius: 17, border: `4px solid ${colors.border}`, borderTopColor: colors.brand, transform: `rotate(${frame * 14}deg)`, display: "inline-block" }} />
  );
}
