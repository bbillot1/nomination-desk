import {
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";

import { replayStages, type ReplayFrame } from "../lib/replay";

interface ReplayPanelProps {
  frame: ReplayFrame;
  playing: boolean;
  canExit?: boolean;
  onTogglePlaying: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRestart: () => void;
  onExit: () => void;
}

export function ReplayPanel({
  frame,
  playing,
  canExit = true,
  onTogglePlaying,
  onPrevious,
  onNext,
  onRestart,
  onExit,
}: ReplayPanelProps) {
  const atStart = frame.index === 0;
  const atEnd = frame.index === replayStages.length - 1;
  const progress = ((frame.index + 1) / replayStages.length) * 100;

  return (
    <section className="panel overflow-hidden border-sky-400/25">
      <header className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <Play size={15} className="text-sky-300" fill="currentColor" />
            <h2 className="text-sm font-semibold text-white">Verified replay</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">Captured run · no live writes or model calls</p>
        </div>
        <span className="rounded border border-sky-400/25 bg-sky-400/10 px-2 py-1 text-[9px] font-bold tracking-wider text-sky-200 uppercase">
          Replay mode
        </span>
      </header>

      <div className="p-3">
        <div className="rounded-xl border border-[#29423a] bg-[#091411] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Current frame</p>
              <p className="mt-1.5 text-sm font-semibold text-[#e7f0ed]">{frame.label}</p>
            </div>
            <span className="mono text-xs text-[#7f968d]">
              {frame.index + 1}/{replayStages.length}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#21352f]">
            <div
              className="h-full rounded-full bg-sky-300 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[auto_1fr_auto] gap-2">
          <button
            type="button"
            disabled={atStart}
            onClick={onPrevious}
            className="flex size-9 items-center justify-center rounded-lg border border-[#334b43] text-[#9fb2ab] transition hover:bg-white/[0.035] disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Previous replay frame"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={onTogglePlaying}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-sky-300 px-3 text-[11px] font-bold text-[#07110f] transition hover:bg-sky-200"
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            {playing ? "Pause replay" : atEnd ? "Play again" : "Play replay"}
          </button>
          <button
            type="button"
            disabled={atEnd}
            onClick={onNext}
            className="flex size-9 items-center justify-center rounded-lg border border-[#334b43] text-[#9fb2ab] transition hover:bg-white/[0.035] disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Next replay frame"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-[#334b43] text-[10px] font-semibold text-[#9fb2ab] transition hover:bg-white/[0.035]"
          >
            <RotateCcw size={11} />
            Restart
          </button>
          <button
            type="button"
            disabled={!canExit}
            onClick={onExit}
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-[#334b43] text-[10px] font-semibold text-[#9fb2ab] transition hover:border-emerald-400/30 hover:bg-emerald-400/[0.055] hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <CircleStop size={11} />
            {canExit ? "Return to live" : "Replay-only build"}
          </button>
        </div>
      </div>
    </section>
  );
}
