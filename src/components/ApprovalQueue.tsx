import {
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ShieldCheck,
  X,
} from "lucide-react";

import type { Json, PendingActionRow } from "../lib/database.types";
import { formatCentralTime, formatDth, formatMoneyCents, titleCase } from "../lib/format";

interface ApprovalQueueProps {
  actions: PendingActionRow[];
  busyActionId: string | null;
  readOnly?: boolean;
  onDecision: (action: PendingActionRow, decision: "approve" | "reject") => void;
}

function objectValue(value: Json): Record<string, Json | undefined> | null {
  return !Array.isArray(value) && value !== null && typeof value === "object" ? value : null;
}

function actionFacts(action: PendingActionRow): string[] {
  const payload = objectValue(action.payload);
  if (!payload) return [];
  if (action.action_type === "apply_allocation") {
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    const derated = payload.derated_capacity_dth;
    return [
      `${allocations.length} nominations`,
      typeof derated === "number" ? `${formatDth(derated)} Dth capacity` : "",
    ].filter(Boolean);
  }
  if (action.action_type === "post_ebb_notice") {
    return ["Public EBB", "Effective upon posting"];
  }
  if (action.action_type === "send_shipper_message") {
    const recipients = Array.isArray(payload.recipients) ? payload.recipients.length : 0;
    return [`${recipients} affected shippers`, "Batched delivery"];
  }
  return [];
}

export function ApprovalQueue({
  actions,
  busyActionId,
  readOnly = false,
  onDecision,
}: ApprovalQueueProps) {
  const pending = actions.filter((action) => action.status === "pending");
  const decided = actions.filter((action) => action.status !== "pending");

  return (
    <section className="panel overflow-hidden">
      <header className="panel-header">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-amber-300" />
            <h2 className="text-sm font-semibold text-white">Approval queue</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">
            {readOnly ? "Recorded human gates · controls disabled" : "External and schedule changes stop here"}
          </p>
        </div>
        <span
          className={`mono flex size-7 items-center justify-center rounded-full border text-xs font-bold ${
            pending.length > 0
              ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
              : "border-[#2a4139] bg-[#0a1512] text-[#738a82]"
          }`}
        >
          {pending.length}
        </span>
      </header>

      <div className="max-h-[520px] overflow-y-auto p-3">
        {pending.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-[#2b423a] px-5 py-7 text-center">
            <CheckCircle2 size={20} className="text-emerald-400/70" />
            <p className="mt-2 text-xs font-semibold text-[#b7c8c1]">No action waiting</p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f867e]">
              Agent tools can draft, but only this queue can execute.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((action) => {
              const facts = actionFacts(action);
              const busy = busyActionId === action.id;
              return (
                <article
                  key={action.id}
                  className="rounded-xl border border-amber-300/20 bg-amber-300/[0.045] p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[9px] font-bold tracking-[0.14em] text-amber-200/75 uppercase">
                        {titleCase(action.action_type)}
                      </span>
                      <h3 className="mt-1 text-xs font-semibold leading-5 text-white">
                        {action.title}
                      </h3>
                    </div>
                    {action.dollar_impact_cents !== null && action.dollar_impact_cents > 0 && (
                      <span className="mono shrink-0 rounded-md border border-rose-400/20 bg-rose-400/[0.07] px-2 py-1 text-[10px] font-semibold text-rose-200">
                        {formatMoneyCents(action.dollar_impact_cents)}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-[11px] leading-[1.15rem] text-[#a5b7b0]">
                    {action.rationale}
                  </p>
                  {facts.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {facts.map((fact) => (
                        <span
                          key={fact}
                          className="rounded-md border border-[#31483f] bg-[#0b1714] px-2 py-1 text-[9px] text-[#8fa59d]"
                        >
                          {fact}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 text-[9px] text-[#71877f]">
                    <Clock3 size={10} />
                    <span>{formatCentralTime(action.created_at)}</span>
                    {action.dollar_impact_cents !== null && (
                      <>
                        <span className="text-[#3c534b]">•</span>
                        <CircleDollarSign size={10} />
                        <span>Impact reviewed</span>
                      </>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <button
                      type="button"
                      disabled={readOnly || busyActionId !== null}
                      onClick={() => onDecision(action, "approve")}
                      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 text-[11px] font-bold text-[#07110f] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Check size={13} strokeWidth={3} />
                      {readOnly ? "Recorded approval gate" : busy ? "Executing…" : "Approve action"}
                    </button>
                    <button
                      type="button"
                      disabled={readOnly || busyActionId !== null}
                      onClick={() => onDecision(action, "reject")}
                      className="inline-flex size-9 items-center justify-center rounded-lg border border-[#3a4f48] text-[#91a59e] transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label={`Reject ${action.title}`}
                      title="Reject action"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {decided.length > 0 && (
          <div className="mt-4 border-t border-[#23372f] pt-3">
            <p className="eyebrow px-1">Decision history</p>
            <div className="mt-2 space-y-1">
              {decided.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[10px] hover:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#aebfb9]">{action.title}</p>
                    <p className="mt-0.5 text-[9px] text-[#667d75]">
                      {action.decided_by ?? "system"} · {formatCentralTime(action.decided_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      action.status === "executed"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : action.status === "rejected"
                          ? "bg-rose-400/10 text-rose-300"
                          : "bg-amber-400/10 text-amber-200"
                    }`}
                  >
                    {action.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
