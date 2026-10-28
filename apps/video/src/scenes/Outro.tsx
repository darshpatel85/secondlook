import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, mono } from "../theme";
import { Background, FadeUp, LogoMark, Wordmark, usePop } from "../ui";

export function Outro() {
  const frame = useCurrentFrame();
  const logo = usePop(5, { damping: 12 });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Background glow={0.9}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 30, opacity: fadeOut }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, transform: `scale(${0.8 + logo * 0.2})`, opacity: logo }}>
          <LogoMark size={150} />
          <Wordmark size={110} />
        </div>
        <FadeUp delay={22} style={{ fontSize: 50, fontWeight: 700, letterSpacing: -1 }}>
          Review the next pull request with a second look.
        </FadeUp>
        <FadeUp delay={40} style={{ display: "flex", gap: 20, marginTop: 14 }}>
          <span style={{ background: colors.brand, color: colors.bg, fontSize: 32, fontWeight: 700, padding: "18px 44px", borderRadius: 16 }}>Run it on your machine</span>
          <span style={{ fontFamily: mono, fontSize: 30, color: colors.muted, padding: "18px 30px", border: `1.5px solid ${colors.border}`, borderRadius: 16 }}>pnpm install && pnpm dev</span>
        </FadeUp>
      </AbsoluteFill>
    </Background>
  );
}
