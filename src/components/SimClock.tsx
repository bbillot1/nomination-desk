import { CalendarDays, Clock3, Radio, TimerReset } from "lucide-react";

import type { CycleRow } from "../lib/database.types";
import type { RealtimeState } from "../lib/events";
import {
  formatCentralTime,
  formatRelativeMinutes,
  titleCase,
} from "../lib/format";

interface SimClockProps {
  simClock: string;
  gasDay: string;
  phase: string;
  openCycle: CycleRow | null;
  cycleMinutesRemaining: number | null;
  hasRunningWork: boolean;
  realtimeState: RealtimeState;
  mode?: "live" | "replay";
}

export function SimClock({
  simClock,
  gasDay,
  phase,
  openCycle,
  cycleMinutesRemaining,
  hasRunningWork,
  realtimeState,
  mode = "live",
}: SimClockProps) {
  const live = realtimeState === "live";
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#263c35] bg-[#263c35] lg:grid-cols-4">
      <div className="bg-[#0b1714] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[#88a097]">
          <Clock3 size={13} />
          <span className="eyebrow">Sim clock</span>
        </div>
        <div className="mono mt-2 text-lg font-semibold tracking-tight text-white">
          {formatCentralTime(simClock)}
        </div>
      </div>
      <div className="bg-[#0b1714] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[#88a097]">
          <CalendarDays size={13} />
          <span className="eyebrow">Gas day</span>
        </div>
        <div className="mono mt-2 text-lg font-semibold tracking-tight text-white">
          {gasDay}
        </div>
      </div>
      <div className="bg-[#0b1714] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[#88a097]">
          <TimerReset size={13} />
          <span className="eyebrow">{openCycle?.cycle_type ?? "Cycle"}</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="mono text-lg font-semibold tracking-tight text-white">
            {cycleMinutesRemaining === null
              ? "Closed"
              : formatRelativeMinutes(cycleMinutesRemaining)}
          </span>
        </div>
      </div>
      <div className="bg-[#0b1714] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[#88a097]">
          <Radio size={13} />
          <span className="eyebrow">Desk state</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${
              mode === "replay"
                ? "bg-sky-300"
                : live
                  ? "live-dot bg-emerald-400"
                  : "bg-amber-400"
            }`}
          />
          <span className="text-sm font-semibold text-white">
            {mode === "replay"
              ? `Replay · ${titleCase(phase)}`
              : hasRunningWork
                ? "Agents working"
                : titleCase(phase)}
          </span>
        </div>
      </div>
    </section>
  );
}
