// frontend/src/components/ConfirmIncidentDeleteModal.tsx
// Komponent obsługuje potwierdzenie usunięcia pojedynczego incydentu z meczu.

import { useMemo } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type IncidentSummary = {
  matchId: number;
  incidentId: number;
  incidentType?: string;
  teamLabel?: string;
  minute?: number | null;
  playerLabel?: string | null;
};

type Props = {
  open: boolean;
  incident: IncidentSummary | null;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

function incidentTypeLabel(value?: string): string {
  const normalized = (value ?? "").trim().toUpperCase();

  if (normalized === "GOAL") return "Gol";
  if (normalized === "OWN_GOAL") return "Gol samobójczy";
  if (normalized === "PENALTY_GOAL" || normalized === "PENALTY_SCORED") return "Gol z rzutu karnego";
  if (normalized === "PENALTY_MISSED") return "Niewykorzystany rzut karny";
  if (normalized === "YELLOW_CARD") return "Żółta kartka";
  if (normalized === "RED_CARD") return "Czerwona kartka";
  if (normalized === "FOUL") return "Faul";
  if (normalized === "SUBSTITUTION") return "Zmiana";
  if (normalized === "HANDBALL_TWO_MINUTES") return "Kara dwóch minut";
  if (normalized === "TENNIS_POINT" || normalized === "POINT") return "Punkt";
  if (normalized === "SET_POINT") return "Punkt setowy";
  if (normalized === "TENNIS_CODE_VIOLATION") return "Naruszenie przepisów";
  if (normalized === "TIMEOUT") return "Przerwa na żądanie";
  if (normalized === "WRESTLING_POINT_1") return "Punkt techniczny za 1";
  if (normalized === "WRESTLING_POINT_2") return "Punkty techniczne za 2";
  if (normalized === "WRESTLING_POINT_4") return "Punkty techniczne za 4";
  if (normalized === "WRESTLING_POINT_5") return "Punkty techniczne za 5";
  if (normalized === "WRESTLING_PASSIVITY") return "Pasywność";
  if (normalized === "WRESTLING_CAUTION") return "Ostrzeżenie";
  if (normalized === "WRESTLING_FALL") return "Tusz";
  if (normalized === "WRESTLING_INJURY") return "Kontuzja";
  if (normalized === "WRESTLING_FORFEIT") return "Walkower";
  if (normalized === "WRESTLING_DISQUALIFICATION") return "Dyskwalifikacja";

  return "Incydent";
}

export default function ConfirmIncidentDeleteModal({
  open,
  incident,
  confirmLabel = "Usuń",
  cancelLabel = "Anuluj",
  onConfirm,
  onCancel,
}: Props) {
  // Opis buduje czytelny komunikat bez logiki w JSX.
  const description = useMemo(() => {
    if (!incident) {
      return "Czy na pewno chcesz usunąć ten incydent?";
    }

    const parts: string[] = [];
    const kind = incidentTypeLabel(incident.incidentType);
    const minute = typeof incident.minute === "number" ? `${incident.minute}'` : null;
    const team = (incident.teamLabel ?? "").trim();
    const player = (incident.playerLabel ?? "").trim();

    parts.push(kind);
    if (minute) parts.push(minute);
    if (team) parts.push(team);
    if (player) parts.push(player);

    const subject = parts.join(" - ");
    return `Czy na pewno chcesz usunąć incydent${subject ? `: ${subject}` : ""}?`;
  }, [incident]);

  // Id techniczny pomaga potwierdzić właściwy rekord.
  const meta = useMemo(() => {
    if (!incident) return null;
    return `ID incydentu: ${incident.incidentId}`;
  }, [incident]);

  return (
    <Dialog
      open={open}
      title="Potwierdzenie usunięcia incydentu"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} size="sm" className="h-9 rounded-xl px-4">
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} size="sm" className="h-9 rounded-xl px-4">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-200">{description}</p>
        {meta ? <p className="text-xs text-slate-400">{meta}</p> : null}
      </div>
    </Dialog>
  );
}
