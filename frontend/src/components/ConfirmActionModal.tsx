import { ConfirmDialog } from "../ui/ConfirmDialog";

type Props = {
  open: boolean;
  title: string;
  message: string;

  confirmLabel?: string;
  cancelLabel?: string;

  confirmVariant?: "primary" | "danger";

  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmVariant = "danger",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmVariant={confirmVariant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
