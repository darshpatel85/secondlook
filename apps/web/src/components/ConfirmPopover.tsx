import { useEffect, useRef } from "react";

type Props = {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmPopover({ message, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="confirm-pop" role="alertdialog" aria-label={message}>
      <p className="small">{message}</p>
      <div className="confirm-pop-actions">
        <button type="button" className="button quiet" onClick={onCancel}>
          Cancel
        </button>
        <button ref={confirmRef} type="button" className="button primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
