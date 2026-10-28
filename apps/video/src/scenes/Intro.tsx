import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../theme";
import { Background, FadeUp, LogoMark, Wordmark, usePop } from "../ui";

export function Intro() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [5, 45], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const settle = usePop(40, { damping: 12 });
  const exit = interpolate(frame, [125, 145], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Background glow={0.8}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 28, opacity: exit, transform: `scale(${1 + (1 - exit) * 0.06})` }}>
        <div style={{ transform: `translateY(${(1 - settle) * 40}px) scale(${0.9 + settle * 0.1})` }}>
          <LogoMark size={220} progress={draw} />
        </div>
        <FadeUp delay={45}>
          <Wordmark size={120} />
        </FadeUp>
        <FadeUp delay={62} style={{ fontSize: 44, color: colors.muted, fontWeight: 500 }}>
          A second pair of eyes that shows its working.
        </FadeUp>
      </AbsoluteFill>
    </Background>
  );
}
