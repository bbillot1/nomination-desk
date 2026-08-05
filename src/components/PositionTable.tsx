import { ArrowDownRight, ArrowUpRight, ClipboardList, ShieldCheck } from "lucide-react";

import type { PositionView } from "../lib/desk-data";
import { formatDth, formatMoneyCents } from "../lib/format";

interface PositionTableProps {
  positions: PositionView[];
}

const priorityLabels: Record<number, string> = {
  1: "Firm primary",
  2: "Firm secondary",
  3: "Interruptible",
};

function signedDth(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatDth(Math.abs(value))}`;
}

export function PositionTable({ positions }: PositionTableProps) {
  const aggregateExposure = positions.reduce(
    (total, position) => total + (position.exposureCents ?? 0),
    0,
  );
  const atRiskCount = positions.filter((position) => (position.exposureCents ?? 0) > 0).length;

  return (
    <section className="panel overflow-hidden">
      <header className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={15} className="text-emerald-300" />
            <h2 className="text-sm font-semibold text-white">Shipper positions</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">
            Operations SOR schedule with deterministic run-rate exposure
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <ShieldCheck size={13} className="text-[#759087]" />
          <span className="text-[10px] font-semibold tracking-wide text-[#789087] uppercase">
            Read-only browser view
          </span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-[#263b35] bg-[#091310]/65 text-left">
              {[
                "Shipper / service",
                "Nominated",
                "Scheduled",
                "Projected",
                "Variance",
                "Tolerance",
                "Potential exposure",
              ].map((label, index) => (
                <th
                  key={label}
                  className={`px-4 py-2.5 text-[9px] font-bold tracking-[0.14em] text-[#70877f] uppercase ${
                    index > 0 ? "text-right" : ""
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const atRisk = position.status === "at_risk";
              return (
                <tr
                  key={position.nominationId}
                  className={`border-b border-[#21352f] transition-colors last:border-0 hover:bg-white/[0.018] ${
                    atRisk ? "bg-rose-400/[0.025]" : ""
                  }`}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          atRisk
                            ? "bg-rose-400 shadow-[0_0_9px_rgba(251,113,133,.55)]"
                            : position.status === "pending_recut"
                              ? "bg-amber-300"
                              : position.status === "cut"
                                ? "bg-sky-300"
                                : "bg-emerald-400"
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#e9f1ee]">
                            {position.shipperName}
                          </span>
                          <span className="mono text-[9px] text-[#687e76]">
                            {position.shipperId}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[9px] tracking-wide text-[#728980] uppercase">
                          <span>{position.serviceType}</span>
                          <span className="text-[#3e554d]">/</span>
                          <span>{priorityLabels[position.priorityRank] ?? `Rank ${position.priorityRank}`}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono px-4 py-3.5 text-right text-xs text-[#b5c6c0]">
                    {formatDth(position.nominatedDth)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="mono text-xs font-semibold text-white">
                      {formatDth(position.scheduledDth)}
                    </div>
                    {position.proposedScheduledDth !== null && (
                      <div className="mono mt-1 text-[9px] text-amber-200">
                        → {formatDth(position.proposedScheduledDth)} pending
                      </div>
                    )}
                    {position.recutDeltaDth !== null && (
                      <div className="mono mt-1 text-[9px] text-sky-300">
                        {signedDth(position.recutDeltaDth)} recut
                      </div>
                    )}
                  </td>
                  <td className="mono px-4 py-3.5 text-right text-xs text-[#b5c6c0]">
                    {formatDth(position.projectedDth)}
                  </td>
                  <td
                    className={`mono px-4 py-3.5 text-right text-xs ${
                      (position.varianceDth ?? 0) > 0 ? "text-rose-300" : "text-emerald-300"
                    }`}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      {position.varianceDth !== null &&
                        (position.varianceDth > 0
                          ? <ArrowUpRight size={11} />
                          : position.varianceDth < 0
                            ? <ArrowDownRight size={11} />
                            : null)}
                      {signedDth(position.varianceDth)}
                    </span>
                  </td>
                  <td className="mono px-4 py-3.5 text-right text-xs text-[#8ea49c]">
                    {formatDth(position.toleranceDth)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div
                      className={`mono text-xs font-semibold ${
                        (position.exposureCents ?? 0) > 0 ? "text-rose-300" : "text-[#91a69f]"
                      }`}
                    >
                      {formatMoneyCents(position.exposureCents)}
                    </div>
                    {(position.excessDth ?? 0) > 0 && (
                      <div className="mono mt-1 text-[9px] text-[#758a83]">
                        {formatDth(position.excessDth)} Dth excess
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#263b35] bg-[#091310]/55 px-4 py-3">
        <p className="text-[10px] text-[#71877f]">
          Projected exposure appears only after the approved recut changes the authoritative schedule.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-wide text-[#80968e] uppercase">
            {atRiskCount} at risk
          </span>
          <span className="h-4 w-px bg-[#31473f]" />
          <span className="mono text-sm font-semibold text-rose-300">
            {aggregateExposure > 0 ? `${formatMoneyCents(aggregateExposure)} / gas day` : "No active exposure"}
          </span>
        </div>
      </footer>
    </section>
  );
}
