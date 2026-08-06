import { useEffect } from "react";
import {
  Activity,
  Braces,
  Clock3,
  Cpu,
  Download,
  FileClock,
  Link2,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  buildEventTimeline,
  extractKeyFacts,
  extractProviderTelemetry,
  hasRawTechnicalData,
  timelineItemContains,
  toolDisplayName,
  type AuditFact,
  type EventViewMode,
  type ProviderTelemetry,
} from "../lib/audit-presentation";
import type { PendingActionRow } from "../lib/database.types";
import type { WorkflowEvent } from "../lib/events";
import { formatCentralDateTime, formatDth } from "../lib/format";
import { EventSummary } from "./EventSummary";
import { EventViewToggle } from "./EventViewToggle";

interface AuditDrawerProps {
  open: boolean;
  selectedEvent: WorkflowEvent | null;
  events: WorkflowEvent[];
  actions: PendingActionRow[];
  viewMode: EventViewMode;
  onClose: () => void;
  onSelectEvent: (event: WorkflowEvent) => void;
  onViewModeChange: (mode: EventViewMode) => void;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function AuditDrawer({
  open,
  selectedEvent,
  events,
  actions,
  viewMode,
  onClose,
  onSelectEvent,
  onViewModeChange,
}: AuditDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || !selectedEvent) return null;
  const timeline = buildEventTimeline(events, viewMode);
  const selectedItem = timeline.find((item) => timelineItemContains(item, selectedEvent.id));
  const selectedSummary = selectedItem?.summary ?? selectedEvent.summary;
  const selectedDisplayType = selectedItem?.displayType ??
    (selectedEvent.event_type === "analysis_summary" ? "Assessment" : "Event");
  const facts = extractKeyFacts(selectedEvent);
  const telemetry = extractProviderTelemetry(selectedEvent.detail);
  const showRawTechnicalData = viewMode === "technical"
    ? selectedEvent.detail !== null ||
      selectedEvent.tool_input !== null ||
      selectedEvent.tool_output !== null
    : hasRawTechnicalData(selectedEvent);

  const exportDisputeFile = () => {
    const payload = {
      file_type: "nomination-desk-dispute-file",
      generated_at: new Date().toISOString(),
      workflow_id: selectedEvent.workflow_id,
      selected_event: selectedEvent,
      ordered_events: events,
      approval_records: actions,
    };
    const blob = new Blob([prettyJson(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nomination-desk-${selectedEvent.workflow_id}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close audit drawer"
        className="absolute inset-0 bg-[#020806]/72 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-title"
        className="drawer-enter absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[#2b423a] bg-[#08120f] shadow-[-28px_0_60px_rgba(0,0,0,.35)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#263b35] px-4 py-3.5 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <FileClock size={16} className="text-emerald-300" />
              <h2 id="audit-title" className="text-sm font-semibold text-white">
                Incident audit
              </h2>
            </div>
            <p className="mono mt-1 max-w-[28rem] truncate text-[9px] text-[#6f867d]">
              workflow {selectedEvent.workflow_id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <EventViewToggle mode={viewMode} onChange={onViewModeChange} />
            <button
              type="button"
              onClick={exportDisputeFile}
              className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-[#344c43] px-2.5 text-[10px] font-semibold text-[#a8bbb4] transition hover:border-emerald-400/35 hover:bg-emerald-400/[0.06] hover:text-emerald-200"
            >
              <Download size={12} />
              Export dispute file
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-lg border border-[#344c43] text-[#8fa49c] transition hover:bg-white/[0.04] hover:text-white"
              aria-label="Close audit drawer"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[230px_minmax(0,1fr)]">
          <nav
            aria-label="Workflow event chain"
            className="max-h-48 overflow-y-auto border-b border-[#263b35] bg-[#07100e] p-2 md:max-h-none md:border-r md:border-b-0"
          >
            <div className="flex items-center justify-between px-2 py-2">
              <span className="eyebrow">Ordered chain</span>
              <span className="mono text-[9px] text-[#60766e]">
                {timeline.length}{viewMode === "operator" ? ` of ${events.length}` : ""} events
              </span>
            </div>
            {timeline.map((item) => {
              const event = item.event;
              return (
              <button
                type="button"
                key={item.key}
                onClick={() => onSelectEvent(event)}
                className={`mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition ${
                  timelineItemContains(item, selectedEvent.id)
                    ? "border-emerald-400/25 bg-emerald-400/[0.07]"
                    : "border-transparent hover:border-[#2d443c] hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold tracking-wide text-[#8fa59d] uppercase">
                    {event.agent_name}
                  </span>
                  <span className="mono text-[8px] text-[#5f756d]">#{event.seq}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#aebfb9]">
                  <EventSummary summary={item.summary} />
                </p>
              </button>
              );
            })}
          </nav>

          <div className="overflow-y-auto">
            <section className="border-b border-[#263b35] p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-1 text-[9px] font-bold tracking-wide text-emerald-200 uppercase">
                  {selectedEvent.agent_name}
                </span>
                <span className="text-[9px] font-semibold tracking-wide text-[#738a82] uppercase">
                  {selectedDisplayType}
                </span>
                <span className="mono ml-auto text-[9px] text-[#627870]">
                  {formatCentralDateTime(selectedEvent.created_at)}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold leading-6 text-[#eef5f2]">
                <EventSummary summary={selectedSummary} />
              </h3>
              {selectedEvent.citation && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#2c443b] bg-[#0a1713] px-3 py-2 text-[10px] text-emerald-200/85">
                  <Link2 size={12} />
                  {selectedEvent.citation}
                </div>
              )}
              {selectedEvent.skill_used && (
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[#839a91]">
                  <ShieldCheck size={12} />
                  Playbook: {selectedEvent.skill_used}
                </div>
              )}
            </section>

            <div className="space-y-3 p-4 sm:p-5">
              {facts.length > 0 && <KeyEvidence facts={facts} />}
              {selectedEvent.tool_name && (
                <div className="rounded-xl border border-[#2a4038] bg-[#091310] p-3">
                  <div className="flex items-center gap-2">
                    <Braces size={12} className="text-sky-300" />
                    <span className="eyebrow">Evidence source</span>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-sky-200">
                    {toolDisplayName(selectedEvent.tool_name)}
                  </p>
                  {viewMode === "technical" && (
                    <p className="mono mt-1 text-[9px] text-[#657b73]">{selectedEvent.tool_name}</p>
                  )}
                </div>
              )}
              {telemetry && <TelemetrySummary telemetry={telemetry} />}
              {showRawTechnicalData && (
                <details
                  open={viewMode === "technical"}
                  className="overflow-hidden rounded-xl border border-[#2a4038] bg-[#091310]"
                >
                  <summary className="cursor-pointer px-3 py-2.5 text-[10px] font-bold tracking-[0.14em] text-[#80968e] uppercase hover:text-[#b6c7c1]">
                    Raw technical data
                  </summary>
                  <div className="space-y-3 border-t border-[#23372f] p-3">
                    {selectedEvent.detail !== null && (
                      <AuditBlock title="Event detail" value={selectedEvent.detail} />
                    )}
                    {selectedEvent.tool_input !== null && (
                      <AuditBlock title="Verified input" value={selectedEvent.tool_input} />
                    )}
                    {selectedEvent.tool_output !== null && (
                      <AuditBlock title="Deterministic result" value={selectedEvent.tool_output} />
                    )}
                  </div>
                </details>
              )}

              <div className="rounded-xl border border-[#2a4038] bg-[#091310] p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Human decisions</span>
                  <span className="mono text-[9px] text-[#60766e]">{actions.length} records</span>
                </div>
                {actions.length === 0 ? (
                  <p className="mt-2 text-[10px] text-[#71877f]">No approval records yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {actions.map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center justify-between gap-3 border-t border-[#20332d] pt-2 first:border-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-medium text-[#afc0ba]">
                            {action.title}
                          </p>
                          <p className="mt-0.5 text-[9px] text-[#657b73]">
                            {action.decided_by ?? "Awaiting operator"}
                          </p>
                        </div>
                        <span
                          className={`text-[9px] font-bold uppercase ${
                            action.status === "executed"
                              ? "text-emerald-300"
                              : action.status === "pending"
                                ? "text-amber-200"
                                : "text-rose-300"
                          }`}
                        >
                          {action.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function KeyEvidence({ facts }: { facts: AuditFact[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-400/[0.035]">
      <header className="flex items-center gap-2 border-b border-emerald-400/15 px-3 py-2.5">
        <Activity size={12} className="text-emerald-300" />
        <span className="eyebrow text-emerald-200/75">Key evidence</span>
      </header>
      <div className="grid gap-px bg-[#20352e] sm:grid-cols-2">
        {facts.map((fact, index) => (
          <div key={`${fact.label}:${index}`} className="bg-[#091511] px-3 py-2.5">
            <p className="text-[9px] font-bold tracking-wide text-[#6f867d] uppercase">
              {fact.label}
            </p>
            <p className="mono mt-1 text-[10px] leading-4 text-[#c2d2cc]">{fact.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TelemetrySummary({ telemetry }: { telemetry: ProviderTelemetry }) {
  const cacheTokens = telemetry.cacheCreationTokens + telemetry.cacheReadTokens;
  return (
    <section className="rounded-xl border border-[#2a4038] bg-[#091310] p-3">
      <div className="flex items-center gap-2">
        <Cpu size={12} className="text-violet-300" />
        <span className="eyebrow">Execution telemetry</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-[#8fa49c]">
        <span className="mono text-violet-200">{telemetry.model}</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 size={10} />
          {(telemetry.durationMs / 1_000).toFixed(1)}s
        </span>
        <span>{formatDth(telemetry.outputTokens)} output tokens</span>
        <span>{cacheTokens > 0 ? `${formatDth(cacheTokens)} cached tokens` : "No prompt cache"}</span>
      </div>
    </section>
  );
}

function AuditBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#2a4038] bg-[#091310]">
      <header className="border-b border-[#23372f] px-3 py-2">
        <span className="eyebrow">{title}</span>
      </header>
      <pre className="mono max-h-72 overflow-auto p-3 text-[10px] leading-5 text-[#9fb2ab]">
        {prettyJson(value)}
      </pre>
    </section>
  );
}
