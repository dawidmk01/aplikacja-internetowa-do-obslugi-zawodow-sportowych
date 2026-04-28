// frontend/src/components/ConfirmActionModal.tsx
// Komponent udostępnia prosty wariant wspólnego modala potwierdzającego akcje użytkownika.

import { type ButtonVariant } from "../ui/Button";

import ConfirmChangeModal from "./ConfirmChangeModal";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  question?: string | null;
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
  question = "Czy chcesz kontynuować?",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <ConfirmChangeModal
      open={open}
      title={title}
      description={message}
      question={question}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmVariant={confirmVariant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}