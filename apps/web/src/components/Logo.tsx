export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="18" cy="24" r="12" stroke="currentColor" strokeWidth="4" />
      <circle cx="30" cy="24" r="12" stroke="var(--brand)" strokeWidth="4" />
    </svg>
  );
}

export function Logo() {
  return (
    <>
      <LogoMark />
      <span className="logo-word">
        second<span className="logo-accent">look</span>
      </span>
    </>
  );
}
