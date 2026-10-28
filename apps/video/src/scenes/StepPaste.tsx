import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, Caption, Card, FadeUp, Pill, Scale, Stage, StepLabel, Typewriter, usePop } from "../ui";

const diff = [
  { t: "@@ -38,6 +38,14 @@ export async function exportOrders(req, res) {", k: "hunk" },
  { t: "   const branch = req.query.branch;", k: " " },
  { t: "+  const rows = await db.orders.findMany({", k: "+" },
  { t: "+    where: { branchId: branch },", k: "+" },
  { t: "+  });", k: "+" },
  { t: "+  res.setHeader('content-type', 'text/csv');", k: "+" },
  { t: "+  res.send(toCsv(rows));", k: "+" },
  { t: "-  res.status(501).end();", k: "-" },
];

export function StepPaste() {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [225, 240], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const go = usePop(95, { damping: 12 });
  return (
    <Background>
      <AbsoluteFill style={{ opacity: exit, padding: "100px 140px", display: "flex", flexDirection: "column" }}>
        <StepLabel n={1} title="Paste a pull request" />

        <Stage><div style={{ width: "100%" }}><Scale delay={20}>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ flex: 1, background: colors.surface, border: `2px solid ${frame > 30 && frame < 100 ? colors.brand : colors.border}`, borderRadius: 16, padding: "22px 30px", fontSize: 34, fontFamily: mono, color: colors.text, boxShadow: frame > 30 && frame < 100 ? "0 0 0 6px rgba(143,136,232,0.18)" : undefined }}>
              <Typewriter text="https://github.com/acme/widgets-api/pull/412" start={30} cps={32} />
            </div>
            <div style={{ background: colors.brand, color: colors.bg, fontSize: 30, fontWeight: 700, padding: "22px 40px", borderRadius: 16, transform: `scale(${1 + Math.max(0, 1 - go) * -0.1 + (go > 0 && go < 1 ? 0.04 : 0)})` }}>
              Start review
            </div>
          </div>
        </Scale>

        <div style={{ display: "flex", gap: 32, marginTop: 56 }}>
          <FadeUp delay={110} style={{ flex: 1.2 }}>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "18px 28px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: colors.muted }}>
                <span style={{ fontFamily: mono, color: colors.text }}>src/orders/export.ts</span>
                <Pill color={colors.success} bg={colors.successSoft} style={{ fontSize: 18 }}>+6</Pill>
                <Pill color={colors.error} bg={colors.errorSoft} style={{ fontSize: 18 }}>−1</Pill>
              </div>
              <div style={{ fontFamily: mono, fontSize: 24, lineHeight: 1.65, padding: "16px 0" }}>
                {diff.map((line, i) => (
                  <DiffLine key={i} delay={125 + i * 5} {...line} />
                ))}
              </div>
            </Card>
          </FadeUp>

          <div style={{ flex: 0.8, display: "flex", flexDirection: "column", gap: 20 }}>
            <SideCard delay={140} icon="⎇" title="Own worktree" text="Checked out at the PR head, away from your working copy." />
            <SideCard delay={155} icon="📄" title="Repo docs" text="CLAUDE.md, docs/, and your review guide are read first." />
            <SideCard delay={170} icon="🔒" title="Read only" text="The agent can't edit, build or post. Ever." />
          </div>
        </div>
        </div></Stage>
        <Caption delay={180}>Runs on your machine, with your own GitHub token.</Caption>
      </AbsoluteFill>
    </Background>
  );
}

function DiffLine({ t, k, delay }: { t: string; k: string; delay: number }) {
  const p = usePop(delay, { damping: 20 });
  const bg = k === "+" ? "rgba(63,179,127,0.14)" : k === "-" ? "rgba(240,106,128,0.14)" : k === "hunk" ? colors.brandSoft : "transparent";
  const color = k === "hunk" ? colors.brand : colors.text;
  return (
    <div style={{ background: bg, color, padding: "0 28px", opacity: p, transform: `translateX(${(1 - p) * -30}px)`, whiteSpace: "pre" }}>
      {k === "hunk" ? t : t}
    </div>
  );
}

function SideCard({ delay, icon, title, text }: { delay: number; icon: string; title: string; text: string }) {
  return (
    <FadeUp delay={delay} distance={24}>
      <Card style={{ padding: "20px 26px", display: "flex", gap: 18, alignItems: "flex-start" }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 22, color: colors.muted, marginTop: 4, lineHeight: 1.35 }}>{text}</div>
        </div>
      </Card>
    </FadeUp>
  );
}
