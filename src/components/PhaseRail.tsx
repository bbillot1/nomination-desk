import { Check, Circle, TriangleAlert } from "lucide-react";

const phases = [
  { id: "baseline", label: "Baseline", short: "Ready" },
  { id: "incident_posted", label: "Incident", short: "Physical derate" },
  { id: "recut_pending", label: "Recut staged", short: "Approval" },
  { id: "recut_applied", label: "Recut applied", short: "Assessment" },
  { id: "comms_pending", label: "Comms staged", short: "Approval" },
  { id: "resolved", label: "Resolved", short: "Complete" },
] as const;

interface PhaseRailProps {
  phase: string;
}

export function PhaseRail({ phase }: PhaseRailProps) {
  const activeIndex = phases.findIndex((step) => step.id === phase);
  const needsReview = phase === "needs_review";

  return (
    <section
      className="panel relative overflow-x-auto px-3 py-3 sm:px-5"
      aria-label="Scenario progress"
    >
      <div className="flex min-w-[720px] items-start">
        {phases.map((step, index) => {
          const complete = !needsReview && activeIndex > index;
          const active = !needsReview && activeIndex === index;
          return (
            <div key={step.id} className="relative flex flex-1 items-start">
              {index > 0 && (
                <div
                  className={`absolute top-3 right-1/2 left-[-50%] h-px ${
                    complete || active ? "bg-emerald-500/65" : "bg-[#294039]"
                  }`}
                />
              )}
              <div className="relative z-10 flex w-full flex-col items-center text-center">
                <div
                  className={`flex size-6 items-center justify-center rounded-full border ${
                    complete
                      ? "border-emerald-400 bg-emerald-400 text-[#07110f]"
                      : active
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-300 shadow-[0_0_16px_rgba(74,222,128,0.2)]"
                        : "border-[#355048] bg-[#0b1714] text-[#6f867e]"
                  }`}
                  aria-current={active ? "step" : undefined}
                >
                  {complete ? <Check size={13} strokeWidth={3} /> : <Circle size={8} fill="currentColor" />}
                </div>
                <span
                  className={`mt-2 text-[11px] font-semibold ${
                    active || complete ? "text-[#e8f1ed]" : "text-[#748b83]"
                  }`}
                >
                  {step.label}
                </span>
                <span className="mt-0.5 text-[9px] tracking-wide text-[#61776f] uppercase">
                  {step.short}
                </span>
              </div>
            </div>
          );
        })}
        {needsReview && (
          <div className="absolute inset-x-3 top-3 flex items-center justify-center sm:inset-x-5">
            <div className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold text-amber-200">
              <TriangleAlert size={14} />
              Needs operator review — reset to recover
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
