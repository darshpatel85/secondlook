import type { StepRouting } from "../api/types";

export const routings: Array<{ value: StepRouting; label: string; hint: string }> = [
  { value: "auto", label: "agent", hint: "Left to the agent and the verifier. Files only show here when they raise something" },
  { value: "findings", label: "findings", hint: "You see the agent's findings; the diff stays folded away" },
  { value: "full", label: "full", hint: "You read the whole diff" },
];

type RoutingToggleProps = {
  value: StepRouting;
  stepTitle: string;
  onChange: (routing: StepRouting) => void;
};

export function RoutingToggle({ value, stepTitle, onChange }: RoutingToggleProps) {
  return (
    <div className="mode-toggle" role="group" aria-label={`How closely you review ${stepTitle}`}>
      {routings.map((routing) => (
        <button
          key={routing.value}
          type="button"
          className="mode-option"
          aria-pressed={routing.value === value}
          title={routing.hint}
          onClick={() => {
            if (routing.value !== value) {
              onChange(routing.value);
            }
          }}
        >
          {routing.label}
        </button>
      ))}
    </div>
  );
}
