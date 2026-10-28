export type PulseActivity = { id: string; text: string };

export function LogoLoader({ size = 16 }: { size?: number }) {
  return (
    <svg className="logo-loader" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle className="logo-loader-ring" cx="18" cy="24" r="12" stroke="currentColor" strokeWidth="4" />
      <circle className="logo-loader-ring second" cx="30" cy="24" r="12" stroke="var(--brand)" strokeWidth="4" />
    </svg>
  );
}

export function AgentPulse() {
  return (
    <span className="agent-pulse" role="status">
      <LogoLoader size={18} />
      agent working
    </span>
  );
}

export function WorkingCard({ text, activity = [] }: { text: string; activity?: PulseActivity[] }) {
  const latest = activity.at(-1);
  return (
    <div className="working-card" role="status">
      <LogoLoader size={36} />
      <div className="working-text">
        <span className="working-label">{text}</span>
        {latest ? (
          <span key={latest.id} className="working-ticker" title={latest.text}>
            {latest.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
