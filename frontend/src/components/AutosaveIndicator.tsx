import { cn } from "../lib/cn";
// UWAGA: import type naprawia błąd w Vite
import type { AutosaveStatus } from "../hooks/useAutosave";

type Props = {
  status: AutosaveStatus;
  error?: string;
  className?: string;
};

export function AutosaveIndicator({ status, error, className }: Props) {
  let dotClass = "";
  let title = "";

  switch (status) {
    case "error":
      dotClass = "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]";
      title = "Błąd zapisu: " + (error || "Spróbuj ponownie");
      break;
    case "saving":
      dotClass = "bg-indigo-400 animate-pulse";
      title = "Zapisywanie...";
      break;
    case "draft":
      dotClass = "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]";
      title = "Niezapisane zmiany (czeka na autosave)";
      break;
    case "success":
      dotClass = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-500";
      title = "Zapisano pomyślnie";
      break;
    default:
      dotClass = "bg-white/10";
      title = "Brak zmian";
      break;
  }

  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-300",
        dotClass,
        className
      )}
      title={title}
    />
  );
}