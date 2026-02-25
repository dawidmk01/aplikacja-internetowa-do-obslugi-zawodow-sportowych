import { cn } from "../lib/cn";
import type { AutosaveStatus } from "../hooks/useAutosave";

// Kontrakt: wizualny wskaźnik stanu autosave (kropka) z opisem dla A11Y.

type Props = {
  status: AutosaveStatus;
  error?: string;
  className?: string;
};

function getStatusMeta(status: AutosaveStatus, error?: string) {
  switch (status) {
    case "error":
      return {
        dotClass: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
        label: `Błąd zapisu: ${error || "Spróbuj ponownie"}`,
        title: `Błąd zapisu: ${error || "Spróbuj ponownie"}`,
      } as const;

    case "saving":
      return {
        dotClass: "bg-indigo-400 animate-pulse",
        label: "Zapisywanie",
        title: "Zapisywanie...",
      } as const;

    case "draft":
      return {
        dotClass: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]",
        label: "Niezapisane zmiany",
        title: "Niezapisane zmiany (czeka na autosave)",
      } as const;

    case "success":
      return {
        dotClass: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-500",
        label: "Zapisano",
        title: "Zapisano pomyślnie",
      } as const;

    default:
      return {
        dotClass: "bg-white/10",
        label: "Brak zmian",
        title: "Brak zmian",
      } as const;
  }
}

const AutosaveIndicator = ({ status, error, className }: Props) => {
  const meta = getStatusMeta(status, error);

  return (
    <span
      className={cn(
        "inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
        meta.dotClass,
        className
      )}
      role="img"
      aria-label={meta.label}
      title={meta.title}
      data-status={status}
    >
      <span className="sr-only">{meta.label}</span>
    </span>
  );
};

export { AutosaveIndicator };
export default AutosaveIndicator;