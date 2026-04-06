// frontend/src/components/DivisionSwitcher.tsx
// Komponent udostępnia kompaktowy przełącznik aktywnej dywizji do ponownego użycia w ekranach panelu turnieju.

import { useMemo } from "react";

import { Layers3 } from "lucide-react";

import { Select, type SelectOption } from "../ui/Select";

type DivisionStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";

export type DivisionSwitcherItem = {
  id: number;
  name: string;
  slug: string;
  order: number;
  is_default?: boolean;
  is_archived?: boolean;
  status?: DivisionStatus;
};

type DivisionSwitcherProps = {
  divisions: DivisionSwitcherItem[];
  activeDivisionId: number | null;
  disabled?: boolean;
  onChange: (divisionId: number) => void | Promise<void>;
  label?: string;
};

function getDivisionStatusLabel(status: DivisionStatus | null | undefined) {
  if (status === "RUNNING") return "W trakcie";
  if (status === "FINISHED") return "Zakończona";
  if (status === "CONFIGURED") return "Skonfigurowana";
  return "Szkic";
}

function buildDivisionOptionLabel(item: DivisionSwitcherItem): string {
  const parts = [getDivisionStatusLabel(item.status)];
  if (item.is_default) parts.push("podstawowa");
  return `${item.name} - ${parts.join(" - ")}`;
}

export default function DivisionSwitcher({
  divisions,
  activeDivisionId,
  disabled = false,
  onChange,
  label = "Dywizje",
}: DivisionSwitcherProps) {
  const options = useMemo<SelectOption<number>[]>(() => {
    return divisions
      .filter((item) => !item.is_archived)
      .sort((left, right) => {
        const orderDiff = (left.order ?? 0) - (right.order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return left.id - right.id;
      })
      .map((item) => ({
        value: item.id,
        label: buildDivisionOptionLabel(item),
      }));
  }, [divisions]);

  if (options.length <= 1) return null;

  const fallbackValue = options[0]?.value ?? 0;
  const value = activeDivisionId ?? fallbackValue;

  return (
    <div className="inline-flex min-w-[220px] flex-col gap-1">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <Layers3 className="h-4 w-4 text-white/70" />
        <span>{label}</span>
      </div>

      <Select<number>
        value={value}
        onChange={(nextId) => {
          if (!nextId || nextId === value) return;
          void onChange(nextId);
        }}
        options={options}
        disabled={disabled}
        ariaLabel={label}
        size="md"
        align="start"
        buttonClassName="min-h-[42px] rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-left text-sm text-slate-100 transition hover:border-white/20"
        menuClassName="rounded-2xl"
      />
    </div>
  );
}
