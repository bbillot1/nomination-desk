import { Code2, Eye } from "lucide-react";

import type { EventViewMode } from "../lib/audit-presentation";

interface EventViewToggleProps {
  mode: EventViewMode;
  onChange: (mode: EventViewMode) => void;
}

export function EventViewToggle({ mode, onChange }: EventViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Event detail level"
      className="inline-flex rounded-lg border border-[#2d443c] bg-[#08120f] p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange("operator")}
        aria-pressed={mode === "operator"}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[9px] font-bold tracking-wide uppercase transition ${
          mode === "operator"
            ? "bg-emerald-400/12 text-emerald-200"
            : "text-[#71877f] hover:text-[#b6c7c1]"
        }`}
      >
        <Eye size={10} />
        Operator
      </button>
      <button
        type="button"
        onClick={() => onChange("technical")}
        aria-pressed={mode === "technical"}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-[9px] font-bold tracking-wide uppercase transition ${
          mode === "technical"
            ? "bg-sky-400/12 text-sky-200"
            : "text-[#71877f] hover:text-[#b6c7c1]"
        }`}
      >
        <Code2 size={10} />
        Technical
      </button>
    </div>
  );
}
