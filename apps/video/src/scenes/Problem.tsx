import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, Card, FadeUp, usePop } from "../ui";

const comments = [
  { bot: "ai-review-bot", text: "Consider renaming `rows` to `exportRows` for clarity." },
  { bot: "ai-review-bot", text: "This function could be split into smaller functions." },
  { bot: "ai-review-bot", text: "Missing semicolon on line 12." },
  { bot: "ai-review-bot", text: "Nit: prefer `const` here." },
  { bot: "ai-review-bot", text: "Possible null reference? Please double check." },
  { bot: "ai-review-bot", text: "Consider adding a comment explaining this loop." },
  { bot: "ai-review-bot", text: "The export skips the branch check that the list endpoint does." },
  { bot: "ai-review-bot", text: "Style: line exceeds 100 characters." },
];

export function Problem() {
  const frame = useCurrentFrame();
  const dim = interpolate(frame, [130, 160], [1, 0.22], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(frame, [225, 240], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Background glow={0.25}>
      <AbsoluteFill style={{ opacity: exit }}>
        <FadeUp delay={0} style={{ position: "absolute", top: 110, left: 0, right: 0, textAlign: "center", fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>
          Most AI reviewers leave a pile of comments.
        </FadeUp>

        <div style={{ position: "absolute", top: 260, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ width: 1180, position: "relative", height: 620 }}>
            {comments.map((c, i) => (
              <Comment key={i} index={i} delay={18 + i * 9} dim={i === 6 ? 1 : dim} highlight={i === 6 && frame > 160} {...c} />
            ))}
          </div>
        </div>

        <FadeUp delay={165} style={{ position: "absolute", bottom: 90, left: 0, right: 0, textAlign: "center", fontSize: 46, color: colors.muted, fontWeight: 500 }}>
          One of these matters. <span style={{ color: colors.text }}>Which one?</span>
        </FadeUp>
      </AbsoluteFill>
    </Background>
  );
}

function Comment({ index, delay, text, bot, dim, highlight }: { index: number; delay: number; text: string; bot: string; dim: number; highlight: boolean }) {
  const p = usePop(delay, { damping: 11, stiffness: 140 });
  const glow = usePop(160, { damping: 16 });
  const x = (index % 2) * 600 + (index % 3) * 10;
  const y = Math.floor(index / 2) * 150 + (index % 2) * 10;
  const rot = ((index * 7) % 5) - 2;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 560, opacity: p * dim, transform: `translateY(${(1 - p) * -60}px) rotate(${rot * (1 - p * 0.6)}deg) scale(${highlight ? 1 + glow * 0.06 : 1})` }}>
      <Card style={{ padding: "18px 22px", borderColor: highlight ? colors.brand : colors.border, boxShadow: highlight ? `0 0 ${glow * 60}px rgba(143,136,232,0.5)` : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, color: colors.muted, marginBottom: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: 11, background: colors.brandSoft }} />
          <span style={{ fontFamily: mono }}>{bot}</span>
          <span>commented</span>
        </div>
        <div style={{ fontSize: 23, lineHeight: 1.3 }}>{text}</div>
      </Card>
    </div>
  );
}
