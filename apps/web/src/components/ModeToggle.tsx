import type { ReviewMode } from "../api/types";

const modes: Array<{ value: ReviewMode; label: string; hint: string }> = [
  { value: "as_you_go", label: "show now", hint: "Show the agent's concerns on the diff straight away" },
  { value: "look_first", label: "look first", hint: "AI findings stay hidden until you mark each file done" },
];

type ModeToggleProps = {
  value: ReviewMode;
  stepTitle: string;
  disabled?: boolean;
  onChange: (mode: ReviewMode) => void;
};

export function ModeToggle({ value, stepTitle, disabled = false, onChange }: ModeToggleProps) {
  return (
    <div className="mode-toggle" role="group" aria-label={`When to show the agent's concerns for ${stepTitle}`}>
      {modes.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className="mode-option"
          aria-pressed={mode.value === value}
          title={mode.hint}
          disabled={disabled}
          onClick={() => {
            if (mode.value !== value) {
              onChange(mode.value);
            }
          }}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
