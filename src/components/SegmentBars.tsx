import { Activity, ArrowRight, Gauge, TriangleAlert } from "lucide-react";

import type { SegmentView } from "../lib/desk-data";
import { formatDth } from "../lib/format";

interface SegmentBarsProps {
  segments: SegmentView[];
}

const stateStyles: Record<SegmentView["state"], { fill: string; label: string; text: string }> = {
  normal: {
    fill: "bg-emerald-400/75",
    label: "Available",
    text: "text-emerald-300",
  },
  watch: {
    fill: "bg-lime-300/75",
    label: "Tight",
    text: "text-lime-200",
  },
  full: {
    fill: "bg-amber-300/85",
    label: "Fully subscribed",
    text: "text-amber-200",
  },
  oversubscribed: {
    fill: "bg-rose-400",
    label: "Oversubscribed",
    text: "text-rose-300",
  },
};

export function SegmentBars({ segments }: SegmentBarsProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-emerald-300" />
            <h2 className="text-sm font-semibold text-white">Corridor capacity</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">
            Scheduled throughput against current physical capacity
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[#2c443c] bg-[#0a1412] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[#8ca39a] uppercase">
          <Gauge size={11} />
          Live SOR
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-3">
        {segments.map((segment) => {
          const style = stateStyles[segment.state];
          const width = Math.min(100, Math.max(0, segment.utilizationPct));
          return (
            <article
              key={segment.id}
              className={`rounded-xl border p-4 ${
                segment.state === "oversubscribed"
                  ? "border-rose-400/35 bg-rose-400/[0.055]"
                  : "border-[#263c35] bg-[#091411]/75"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="mono text-[10px] font-bold tracking-wider text-[#789087]">
                      {segment.id}
                    </span>
                    {segment.isDerated && (
                      <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-rose-300 uppercase">
                        Derated
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-[#e8f1ed]">{segment.name}</h3>
                </div>
                <span className={`text-[10px] font-bold ${style.text}`}>{style.label}</span>
              </div>

              <div className="mt-4 flex items-center gap-1.5 text-[10px] text-[#71877f]">
                <span className="truncate">{segment.path.split(" → ")[0]}</span>
                <ArrowRight size={11} className="shrink-0" />
                <span className="truncate">{segment.path.split(" → ")[1]}</span>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <span className="mono text-xl font-semibold tracking-tight text-white">
                      {formatDth(segment.scheduledDth)}
                    </span>
                    <span className="ml-1 text-[10px] text-[#71877f]">Dth scheduled</span>
                  </div>
                  <span className="mono text-xs text-[#9bb0a8]">
                    {segment.utilizationPct.toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-[#1c2c27]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${style.fill}`}
                    style={{ width: `${width}%` }}
                  />
                  {segment.state === "oversubscribed" && (
                    <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(255,255,255,.14)_5px,rgba(255,255,255,.14)_7px)]" />
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px]">
                <span className="text-[#71877f]">
                  Operating{" "}
                  <span className="mono text-[#b2c2bc]">
                    {formatDth(segment.operatingCapacityDth)}
                  </span>
                </span>
                <span className={segment.headroomDth < 0 ? "text-rose-300" : "text-[#8ca39a]"}>
                  {segment.headroomDth < 0 && <TriangleAlert size={10} className="mr-1 inline" />}
                  <span className="mono">{formatDth(Math.abs(segment.headroomDth))}</span>{" "}
                  {segment.headroomDth < 0 ? "over" : "headroom"}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
