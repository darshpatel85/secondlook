import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, font, mono } from "./theme";

export function usePop(delay = 0, opts: { damping?: number; stiffness?: number; mass?: number } = {}): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: opts.damping ?? 14, stiffness: opts.stiffness ?? 120, mass: opts.mass ?? 0.8 },
  });
}

export function useFade(from: number, to: number, reverse = false): number {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return reverse ? 1 - value : value;
}

export function Background({ children, glow = 0.5 }: { children: ReactNode; glow?: number }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 60;
  return (
    <AbsoluteFill style={{ background: colors.bg, color: colors.text, fontFamily: font, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: -200,
          background: `radial-gradient(ellipse 45% 55% at ${62 + drift / 20}% 30%, rgba(143,136,232,${glow * 0.5}), transparent 70%), radial-gradient(ellipse 35% 45% at 15% 85%, rgba(63,179,127,${glow * 0.18}), transparent 70%)`,
          filter: "blur(10px)",
        }}
      />
      <Grid />
      {children}
    </AbsoluteFill>
  );
}

function Grid() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
        maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black 30%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black 30%, transparent 100%)",
      }}
    />
  );
}

export function FadeUp({ delay = 0, children, style, distance = 40, exitAt }: { delay?: number; children: ReactNode; style?: CSSProperties; distance?: number; exitAt?: number }) {
  const frame = useCurrentFrame();
  const p = usePop(delay);
  const exit = exitAt === undefined ? 1 : interpolate(frame, [exitAt, exitAt + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ opacity: p * exit, transform: `translateY(${(1 - p) * distance - (1 - exit) * 20}px)`, ...style }}>{children}</div>
  );
}

export function Scale({ delay = 0, children, style, from = 0.85 }: { delay?: number; children: ReactNode; style?: CSSProperties; from?: number }) {
  const p = usePop(delay);
  return <div style={{ opacity: p, transform: `scale(${from + (1 - from) * p})`, ...style }}>{children}</div>;
}

export function LogoMark({ size = 120, progress = 1 }: { size?: number; progress?: number }) {
  const circ = 2 * Math.PI * 12;
  const dash = circ * Math.min(1, progress);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="18" cy="24" r="12" stroke={colors.text} strokeWidth="4" strokeDasharray={circ} strokeDashoffset={circ - dash} strokeLinecap="round" transform="rotate(-90 18 24)" />
      <circle cx="30" cy="24" r="12" stroke={colors.brand} strokeWidth="4" strokeDasharray={circ} strokeDashoffset={circ - dash} strokeLinecap="round" transform="rotate(90 30 24)" />
    </svg>
  );
}

export function Wordmark({ size = 72 }: { size?: number }) {
  return (
    <span style={{ fontSize: size, fontWeight: 800, letterSpacing: -size * 0.03 }}>
      second<span style={{ color: colors.brand }}>look</span>
    </span>
  );
}

export function StepLabel({ n, title, delay = 0 }: { n: number; title: string; delay?: number }) {
  return (
    <FadeUp delay={delay} style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <span
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          background: colors.brandSoft,
          color: colors.brand,
          display: "grid",
          placeItems: "center",
          fontSize: 36,
          fontWeight: 800,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1.5 }}>{title}</span>
    </FadeUp>
  );
}

export function Card({ children, style, accent }: { children: ReactNode; style?: CSSProperties; accent?: string }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1.5px solid ${colors.border}`,
        borderLeft: accent ? `6px solid ${accent}` : undefined,
        borderRadius: 18,
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        padding: 32,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ children, color, bg, style }: { children: ReactNode; color: string; bg: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontSize: 22,
        fontWeight: 700,
        padding: "6px 18px",
        borderRadius: 999,
        color,
        background: bg,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Typewriter({ text, start, cps = 40, style, cursor = true }: { text: string; start: number; cps?: number; style?: CSSProperties; cursor?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chars = Math.max(0, Math.floor(((frame - start) / fps) * cps));
  const shown = text.slice(0, chars);
  const done = chars >= text.length;
  const blink = Math.floor(frame / 15) % 2 === 0;
  return (
    <span style={style}>
      {shown}
      {cursor && (!done || blink) ? <span style={{ color: colors.brand }}>▍</span> : null}
    </span>
  );
}

export function Code({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontFamily: mono, background: colors.brandSoft, padding: "2px 10px", borderRadius: 8, ...style }}>{children}</span>;
}

export function Caption({ children, delay = 0, exitAt }: { children: ReactNode; delay?: number; exitAt?: number }) {
  return (
    <FadeUp delay={delay} exitAt={exitAt} style={{ position: "absolute", left: 0, right: 0, bottom: 96, textAlign: "center", fontSize: 40, color: colors.muted, fontWeight: 500 }}>
      {children}
    </FadeUp>
  );
}

export function Stage({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, display: "flex", alignItems: "center", paddingBottom: 110 }}>{children}</div>;
}
