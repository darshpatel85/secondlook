export const themes = [
  { id: "violet", name: "Violet lens", hint: "The default, in the logo's violet", swatch: ["#ffffff", "#6b62d6", "#121218", "#8f88e8"] },
  { id: "graphite", name: "Graphite", hint: "Neutral greys for long sessions", swatch: ["#fafafa", "#5a52c8", "#0b0b0c", "#9b94f0"] },
  { id: "clearsight", name: "Clear sight", hint: "High contrast, colour-blind safe diffs", swatch: ["#ffffff", "#0057b8", "#000000", "#ffb454"] },
  { id: "nightshade", name: "Nightshade", hint: "Vivid plum, pink and mint", swatch: ["#fbf8ff", "#7c4ddb", "#1e1a2b", "#ff79c6"] },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

export const modes = ["system", "light", "dark"] as const;
export type Mode = (typeof modes)[number];

const themeKey = "secondlook:theme";
const modeKey = "secondlook:mode";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function storedTheme(): ThemeId {
  const value = read(themeKey);
  return themes.some((theme) => theme.id === value) ? (value as ThemeId) : "violet";
}

export function storedMode(): Mode {
  const value = read(modeKey);
  return (modes as readonly string[]).includes(value ?? "") ? (value as Mode) : "system";
}

export function applyTheme(theme: ThemeId, mode: Mode): void {
  const root = document.documentElement;
  if (theme === "violet") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
  if (mode === "system") root.removeAttribute("data-mode");
  else root.dataset.mode = mode;
  write(themeKey, theme);
  write(modeKey, mode);
}
