import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, Caption, Card, FadeUp, Pill, Stage, StepLabel, Typewriter, usePop } from "../ui";

export function StepIntent() {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [255, 270], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const answered = usePop(205, { damping: 14 });
  return (
    <Background>
      <AbsoluteFill style={{ opacity: exit, padding: "100px 140px", display: "flex", flexDirection: "column" }}>
        <StepLabel n={2} title="Agree what it's for" />

        <Stage><div style={{ width: "100%" }}><div style={{ display: "flex", gap: 32, }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
            <Source delay={20} label="Ticket" name="WID-412 · CSV export for branch managers" lines={["Managers can download their branch's orders as CSV.", "Only their own branch. Finance can download all."]} />
            <Source delay={45} label="Design" name="Figma · Orders › Export sheet" lines={["Export button next to the date filter.", "Progress toast while the file builds."]} />
          </div>

          <div style={{ flex: 1.15, display: "flex", flexDirection: "column", gap: 24 }}>
            <FadeUp delay={75}>
              <Card accent={colors.brand}>
                <div style={{ fontSize: 22, color: colors.brand, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Intent</div>
                <div style={{ fontSize: 28, lineHeight: 1.4, minHeight: 120 }}>
                  <Typewriter start={85} cps={55} text="Adds a CSV export of orders for a branch. Managers should only see their own branch; finance sees everything. The design adds a progress toast." />
                </div>
              </Card>
            </FadeUp>

            <FadeUp delay={165}>
              <Card accent={colors.warning}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 22, color: colors.warning, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Question for you</div>
                  <Pill color={answered > 0.5 ? colors.success : colors.muted} bg={answered > 0.5 ? colors.successSoft : colors.surfaceMuted} style={{ fontSize: 18 }}>
                    {answered > 0.5 ? "answered" : "open"}
                  </Pill>
                </div>
                <div style={{ fontSize: 28, lineHeight: 1.4 }}>Should regional managers be able to export all branches in their region?</div>
                <div style={{ marginTop: 16, opacity: answered, transform: `translateY(${(1 - answered) * 12}px)`, display: "flex", gap: 14, alignItems: "center" }}>
                  <span style={{ fontFamily: mono, color: colors.muted, fontSize: 22 }}>you ›</span>
                  <span style={{ fontSize: 26, background: colors.surfaceMuted, padding: "10px 18px", borderRadius: 12 }}>No. Own branch only, like the list page.</span>
                </div>
              </Card>
            </FadeUp>
          </div>
        </div>
        </div></Stage>
        <Caption delay={215}>It asks only what the code can't tell it.</Caption>
      </AbsoluteFill>
    </Background>
  );
}

function Source({ delay, label, name, lines }: { delay: number; label: string; name: string; lines: string[] }) {
  return (
    <FadeUp delay={delay} distance={30}>
      <Card style={{ padding: "22px 28px" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
          <Pill color={colors.brand} bg={colors.brandSoft} style={{ fontSize: 18 }}>{label}</Pill>
          <span style={{ fontSize: 24, fontWeight: 700 }}>{name}</span>
        </div>
        {lines.map((line, i) => (
          <div key={i} style={{ fontSize: 23, color: colors.muted, lineHeight: 1.45 }}>
            {line}
          </div>
        ))}
      </Card>
    </FadeUp>
  );
}
