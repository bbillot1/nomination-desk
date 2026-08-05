import {
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleAlert,
  ListChecks,
  MessageSquareText,
  Radio,
  Wrench,
} from "lucide-react";

import type { RealtimeState, WorkflowEvent } from "../lib/events";
import { formatCentralTime, titleCase } from "../lib/format";

interface AgentFeedProps {
  events: WorkflowEvent[];
  realtimeState: RealtimeState;
  mode?: "live" | "replay";
  selectedEventId: number | null;
  onSelect: (event: WorkflowEvent) => void;
}

const agentStyles: Record<string, string> = {
  supervisor: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  scheduling: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  exception: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  communications: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
};

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType === "tool_call" || eventType === "tool_result") return <Wrench size={13} />;
  if (eventType === "decision") return <ListChecks size={13} />;
  if (eventType === "error" || eventType === "escalation") return <CircleAlert size={13} />;
  if (eventType === "analysis_summary") return <BrainCircuit size={13} />;
  return <MessageSquareText size={13} />;
}

export function AgentFeed({
  events,
  realtimeState,
  mode = "live",
  selectedEventId,
  onSelect,
}: AgentFeedProps) {
  const runNumbers = new Map<string, number>();
  for (const event of events) {
    if (!runNumbers.has(event.run_id)) runNumbers.set(event.run_id, runNumbers.size + 1);
  }

  return (
    <section className="panel flex min-h-[420px] flex-col overflow-hidden">
      <header className="panel-header shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Bot size={15} className="text-emerald-300" />
            <h2 className="text-sm font-semibold text-white">Agent working feed</h2>
          </div>
          <p className="mt-1 text-xs text-[#789087]">
            Ordered, append-only notes across the full incident workflow
          </p>
        </div>
        <div
          className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${
            mode === "replay"
              ? "border-sky-400/20 bg-sky-400/[0.07] text-sky-200"
              : realtimeState === "live"
              ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300"
              : "border-amber-400/20 bg-amber-400/[0.07] text-amber-200"
          }`}
        >
          <Radio size={11} />
          {mode === "replay" ? "replay" : realtimeState}
        </div>
      </header>

      <div className="relative max-h-[560px] flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border border-[#294039] bg-[#0a1512] text-[#668078]">
              <BrainCircuit size={20} />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-[#c9d7d2]">No active incident</h3>
            <p className="mt-2 max-w-sm text-xs leading-5 text-[#70877f]">
              Trip the synthetic compressor to start a correlated supervisor workflow. New events
              will stream here without polling.
            </p>
          </div>
        ) : (
          <div className="py-2">
            {events.map((event, index) => {
              const previous = events[index - 1];
              const startsRun = !previous || previous.run_id !== event.run_id;
              const selected = selectedEventId === event.id;
              const runNumber = runNumbers.get(event.run_id) ?? 1;
              return (
                <div key={`${event.run_id}:${event.seq}`}>
                  {startsRun && (
                    <div className="flex items-center gap-3 px-4 py-2">
                      <span className="eyebrow whitespace-nowrap">
                        {runNumber === 1 ? "Initial run" : `Continuation ${runNumber - 1}`}
                      </span>
                      <span className="h-px flex-1 bg-[#21352f]" />
                      <span className="mono max-w-32 truncate text-[9px] text-[#5f756d]">
                        {event.run_id}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onSelect(event)}
                    className={`feed-enter group grid w-full grid-cols-[28px_minmax(0,1fr)_18px] gap-2 border-l-2 px-3 py-3 text-left transition-colors sm:grid-cols-[36px_minmax(0,1fr)_76px_18px] sm:gap-3 sm:px-4 ${
                      selected
                        ? "border-l-emerald-400 bg-emerald-400/[0.06]"
                        : event.event_type === "error"
                          ? "border-l-rose-400/60 bg-rose-400/[0.03] hover:bg-rose-400/[0.055]"
                          : "border-l-transparent hover:bg-white/[0.025]"
                    }`}
                  >
                    <div className="relative flex justify-center">
                      {index < events.length - 1 && (
                        <span className="absolute top-7 bottom-[-18px] w-px bg-[#263b35]" />
                      )}
                      <span
                        className={`relative flex size-7 items-center justify-center rounded-full border ${
                          event.event_type === "error"
                            ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
                            : "border-[#2b423a] bg-[#0a1512] text-[#85a198]"
                        }`}
                      >
                        <EventIcon eventType={event.event_type} />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase ${
                            agentStyles[event.agent_name] ?? "border-[#30483f] text-[#8ca39a]"
                          }`}
                        >
                          {event.agent_name}
                        </span>
                        <span className="text-[9px] font-semibold tracking-wide text-[#6f877e] uppercase">
                          {titleCase(event.event_type)}
                        </span>
                        {event.tool_name && (
                          <span className="mono truncate text-[9px] text-[#6d827a]">
                            {event.tool_name}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-[#c7d5d0]">{event.summary}</p>
                      {(event.citation || event.skill_used) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.citation && (
                            <span className="rounded bg-[#172721] px-1.5 py-0.5 text-[9px] text-emerald-200/75">
                              {event.citation}
                            </span>
                          )}
                          {event.skill_used && (
                            <span className="rounded bg-[#17231f] px-1.5 py-0.5 text-[9px] text-[#8ca39a]">
                              skill: {event.skill_used}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="mono hidden pt-1 text-right text-[9px] text-[#657b73] sm:block">
                      {formatCentralTime(event.created_at)}
                    </span>
                    <ChevronRight
                      size={14}
                      className="mt-1 text-[#526860] transition-transform group-hover:translate-x-0.5 group-hover:text-[#91a79f]"
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
