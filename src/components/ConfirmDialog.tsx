interface ConfirmDialogProps {
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onCancel,
  onConfirm,
  testId,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <dialog className="dialog-veil" open aria-labelledby="confirm-title" data-testid={testId}>
      <div className="dialog">
        <h3 id="confirm-title">{title}</h3>
        <p>{body}</p>
        <div className="row">
          <button type="button" className="btn" onClick={onCancel} data-testid="confirm-cancel">
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn danger" : "btn primary"}
            onClick={onConfirm}
            data-testid="confirm-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
