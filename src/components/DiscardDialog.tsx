interface DiscardDialogProps {
  currentTitle: string;
  targetTitle: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveAndOpen: () => void;
}

export function DiscardDialog({
  currentTitle,
  targetTitle,
  onCancel,
  onDiscard,
  onSaveAndOpen,
}: DiscardDialogProps): React.JSX.Element {
  return (
    <dialog
      className="dialog-veil"
      open
      aria-labelledby="discard-title"
      data-testid="discard-dialog"
    >
      <div className="dialog">
        <h3 id="discard-title">
          Discard <em>unsaved</em> edits?
        </h3>
        <p>
          You have edits on <b>"{currentTitle}"</b> that don't match the saved recording yet.
          Opening <b>"{targetTitle}"</b> will throw them away.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={onCancel} data-testid="discard-cancel">
            Cancel
          </button>
          <button type="button" className="btn" onClick={onDiscard} data-testid="discard-confirm">
            Discard &amp; open
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={onSaveAndOpen}
            data-testid="discard-save"
          >
            Save &amp; open
          </button>
        </div>
      </div>
    </dialog>
  );
}
