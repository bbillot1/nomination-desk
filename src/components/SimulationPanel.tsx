import {
  FastForward,
  FlaskConical,
  PlayCircle,
  RotateCcw,
  Shuffle,
  Zap,
} from "lucide-react";

import type { Json, ScadaEventRow } from "../lib/database.types";
import { formatCentralTime, formatDth, titleCase } from "../lib/format";

export type SimulationAction =
  | "reset"
  | "trip_compressor"
  | "advance_clock"
  | "new_scenario"
  | "restore_hero";

interface SimulationPanelProps {
  phase: string;
  seed: string;
  latestScadaEvent: ScadaEventRow | null;
  hasRunningWork: boolean;
  busyAction: SimulationAction | null;
  onAction: (action: SimulationAction) => void;
  onReplay: () => void;
}

function objectValue(value: Json): Record<string, Json | undefined> | null {
  return !Array.isArray(value) && value !== null && typeof value === "object" ? value : null;
}

export function SimulationPanel({
  phase,
  seed,
  latestScadaEvent,
  hasRunningWork,
  busyAction,
  onAction,
  onReplay,
}: SimulationPanelProps) {
  const eventDetail = latestScadaEvent ? objectValue(latestScadaEvent.detail) : null;
  const deratedCapacity = eventDetail?.derated_capacity_dth;

  return (
    <section className="panel overflow-hidden">
      <header className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={15} className="text-sky-300" />
            <h2 className="text-sm font-semibold text-white">Simulation console</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">Inject reality; approvals govern response</p>
        </div>
        <span className="mono rounded border border-[#2d453d] bg-[#091411] px-2 py-1 text-[9px] text-[#80968e]">
          seed:{seed}
        </span>
      </header>

      <div className="p-3">
        {latestScadaEvent ? (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.045] p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-400/10 text-rose-300">
                <Zap size={13} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wide text-rose-200 uppercase">
                    {titleCase(latestScadaEvent.event_type)}
                  </span>
                  <span className="mono text-[9px] text-[#788d85]">
                    {formatCentralTime(latestScadaEvent.occurred_at)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-[#dae5e1]">
                  {latestScadaEvent.asset}
                </p>
                {typeof deratedCapacity === "number" && (
                  <p className="mono mt-1 text-[10px] text-[#8fa39c]">
                    Operating limit {formatDth(deratedCapacity)} Dth
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#293f38] bg-[#091411] p-3 text-[10px] leading-4 text-[#7f958d]">
            Hero telemetry is staged at baseline. Trip the compressor to apply the physical derate
            and start the agent workflow.
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busyAction !== null || phase !== "baseline"}
            onClick={() => onAction("trip_compressor")}
            className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-400 px-3 text-[11px] font-bold text-[#20080d] transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Zap size={14} fill="currentColor" />
            {busyAction === "trip_compressor" ? "Injecting incident…" : "Trip compressor"}
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onAction("advance_clock")}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#334b43] bg-[#0a1512] px-3 text-[10px] font-semibold text-[#abc0b8] transition hover:border-sky-400/35 hover:bg-sky-400/[0.06] hover:text-sky-200 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <FastForward size={12} />
            {busyAction === "advance_clock" ? "Advancing…" : "+15 minutes"}
          </button>
          <button
            type="button"
            disabled={busyAction !== null || hasRunningWork}
            onClick={() => onAction("reset")}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#334b43] bg-[#0a1512] px-3 text-[10px] font-semibold text-[#abc0b8] transition hover:border-amber-400/35 hover:bg-amber-400/[0.06] hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-35"
            title={hasRunningWork ? "Reset is locked while an agent run is active" : "Reset current seed"}
          >
            <RotateCcw size={12} />
            {busyAction === "reset" ? "Resetting…" : "Reset current"}
          </button>
          <button
            type="button"
            disabled={busyAction !== null || hasRunningWork}
            onClick={onReplay}
            className="col-span-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-3 text-[10px] font-semibold text-sky-200 transition hover:border-sky-300/40 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-35"
            title={hasRunningWork ? "Replay is locked while an agent run is active" : "Play the verified replay"}
          >
            <PlayCircle size={12} />
            Play verified replay
          </button>
          <button
            type="button"
            disabled={busyAction !== null || hasRunningWork}
            onClick={() => onAction("new_scenario")}
            className="col-span-2 inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-[#334b43] px-3 text-[9px] font-semibold tracking-wide text-[#8ca39a] uppercase transition hover:border-violet-400/35 hover:bg-violet-400/[0.06] hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-35"
            title={hasRunningWork ? "New scenario is locked while an agent run is active" : "Generate a deterministic scenario"}
          >
            <Shuffle size={11} />
            {busyAction === "new_scenario" ? "Generating scenario…" : "Generate new scenario"}
          </button>
          {seed !== "hero" && (
            <button
              type="button"
              disabled={busyAction !== null || hasRunningWork}
              onClick={() => onAction("restore_hero")}
              className="col-span-2 inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-emerald-400/20 px-3 text-[9px] font-semibold tracking-wide text-emerald-200/80 uppercase transition hover:border-emerald-400/35 hover:bg-emerald-400/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <RotateCcw size={11} />
              {busyAction === "restore_hero" ? "Restoring hero…" : "Restore canonical hero"}
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-[#23372f] px-1 pt-3 text-[9px] text-[#677e75]">
          <span>Current phase</span>
          <span className="mono font-semibold text-[#93a79f]">{titleCase(phase)}</span>
        </div>
      </div>
    </section>
  );
}
