import { useEffect, useRef, useState } from "react";
import { applyTheme, modes, storedMode, storedTheme, themes, type Mode, type ThemeId } from "../lib/theme";

const modeLabels: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(storedTheme);
  const [mode, setMode] = useState<Mode>(storedMode);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => applyTheme(theme, mode), [theme, mode]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = themes.find((item) => item.id === theme) ?? themes[0];

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="theme-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Theme: ${current.name}`}
        onClick={() => setOpen(!open)}
      >
        <span className="theme-swatch" aria-hidden="true">
          <span style={{ background: current.swatch[1] }} />
          <span style={{ background: current.swatch[3] }} />
        </span>
        <span className="visually-hidden">Change theme</span>
      </button>
      {open ? (
        <div className="theme-menu" role="dialog" aria-label="Theme">
          <div role="radiogroup" aria-label="Theme" className="theme-options">
            {themes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === theme}
                className="theme-option"
                onClick={() => setTheme(item.id)}
              >
                <span className="theme-preview" aria-hidden="true">
                  <span style={{ background: item.swatch[0] }}>
                    <i style={{ background: item.swatch[1] }} />
                  </span>
                  <span style={{ background: item.swatch[2] }}>
                    <i style={{ background: item.swatch[3] }} />
                  </span>
                </span>
                <span className="theme-text">
                  <span className="theme-name">{item.name}</span>
                  <span className="theme-hint">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Appearance" className="theme-modes">
            {modes.map((item) => (
              <button key={item} type="button" role="radio" aria-checked={item === mode} onClick={() => setMode(item)}>
                {modeLabels[item]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
