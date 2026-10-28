import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../theme";
import { Background, FadeUp, usePop } from "../ui";

const items = [
  { icon: "🏠", title: "Self-hosted", text: "Runs on your machine. Nothing goes through our servers." },
  { icon: "🔑", title: "Your own keys", text: "Your GitHub token, your Claude sign-in, your bill." },
  { icon: "🔌", title: "Connect what you use", text: "Jira, Figma or any MCP server. Or nothing at all." },
  { icon: "🧠", title: "Remembers your calls", text: "Each repo keeps the preferences you confirm." },
];

export function Features() {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [225, 240], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Background glow={0.6}>
      <AbsoluteFill style={{ opacity: exit, padding: "120px 160px", alignItems: "center", justifyContent: "center" }}>
        <FadeUp delay={0} style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2, textAlign: "center" }}>
          Built for reviewers, not dashboards.
        </FadeUp>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 72, width: 1500 }}>
          {items.map((item, i) => (
            <Tile key={i} delay={25 + i * 14} {...item} />
          ))}
        </div>
      </AbsoluteFill>
    </Background>
  );
}

function Tile({ icon, title, text, delay }: { icon: string; title: string; text: string; delay: number }) {
  const p = usePop(delay, { damping: 13, stiffness: 130 });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${0.9 + p * 0.1})`, background: colors.surface, border: `1.5px solid ${colors.border}`, borderRadius: 20, padding: "40px 44px", display: "flex", gap: 26, alignItems: "center", boxShadow: "0 30px 80px rgba(0,0,0,0.4)" }}>
      <span style={{ fontSize: 56, width: 90, height: 90, borderRadius: 24, background: colors.brandSoft, display: "grid", placeItems: "center" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 38, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 27, color: colors.muted, marginTop: 6, lineHeight: 1.35 }}>{text}</div>
      </div>
    </div>
  );
}
