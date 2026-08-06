import {
  AlertTriangle,
  Database,
  Radio,
  RefreshCw,
  Route,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentFeed } from "../components/AgentFeed";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { AuditDrawer } from "../components/AuditDrawer";
import { NoticeBanner } from "../components/NoticeBanner";
import { PhaseRail } from "../components/PhaseRail";
import { PositionTable } from "../components/PositionTable";
import { ReplayPanel } from "../components/ReplayPanel";
import { SegmentBars } from "../components/SegmentBars";
import { SimClock } from "../components/SimClock";
import {
  SimulationPanel,
  type SimulationAction,
} from "../components/SimulationPanel";
import type { EventViewMode } from "../lib/audit-presentation";
import { fetchDeskSnapshot, type DeskSnapshot } from "../lib/desk-data";
import type { PendingActionRow } from "../lib/database.types";
import {
  subscribeDeskChanges,
  subscribeWorkflowEvents,
  type RealtimeState,
  type WorkflowEvent,
} from "../lib/events";
import {
  loadReplayCapture,
  replayFrame,
  replayStages,
  type ReplayFrame,
} from "../lib/replay";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const OPERATOR_ID = "control-room-scheduler";

export function Desk() {
  const replayOnly = import.meta.env.VITE_DESK_MODE === "replay";
  const [mode, setMode] = useState<"live" | "replay">(replayOnly ? "replay" : "live");
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replay, setReplay] = useState<ReplayFrame | null>(null);
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [eventViewMode, setEventViewMode] = useState<EventViewMode>("operator");
  const [selectedEvent, setSelectedEvent] = useState<WorkflowEvent | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>("connecting");
  const [loading, setLoading] = useState(replayOnly || isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [busySimulation, setBusySimulation] = useState<SimulationAction | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    if (refreshInFlight.current) return refreshInFlight.current;

    const request = (async () => {
      try {
        const next = await fetchDeskSnapshot(supabase);
        setSnapshot(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Desk data could not be loaded");
      } finally {
        setLoading(false);
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!replayOnly) {
      void refresh();
      return;
    }
    void loadReplayCapture()
      .then((initial) => {
        setReplay(initial);
        setReplayIndex(0);
        setReplayPlaying(true);
        setLoading(false);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Replay capture could not be loaded");
        setLoading(false);
      });
  }, [refresh, replayOnly]);

  useEffect(() => {
    const client = supabase;
    if (!client || mode === "replay") return;
    let timer: number | null = null;
    const channel = subscribeDeskChanges(
      client,
      () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 120);
      },
      setRealtimeState,
    );
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [mode, refresh]);

  useEffect(() => {
    if (mode === "replay") return;
    if (!supabase || !snapshot?.workflowId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => Promise<unknown>) | null = null;
    const workflowId = snapshot.workflowId;

    void subscribeWorkflowEvents(
      supabase,
      workflowId,
      (next) => {
        if (!cancelled) setEvents(next);
      },
      setRealtimeState,
    )
      .then((cleanup) => {
        if (cancelled) void cleanup();
        else unsubscribe = cleanup;
      })
      .catch((cause) => {
        if (!cancelled) {
          setRealtimeState("degraded");
          setError(cause instanceof Error ? cause.message : "Agent event stream unavailable");
        }
      });

    return () => {
      cancelled = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [mode, snapshot?.workflowId]);

  useEffect(() => {
    if (mode === "replay" && replay) setReplay(replayFrame(replayIndex));
  }, [mode, replayIndex]);

  useEffect(() => {
    if (mode !== "replay" || !replayPlaying) return;
    if (replayIndex >= replayStages.length - 1) {
      setReplayPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setReplayIndex((current) => Math.min(replayStages.length - 1, current + 1));
    }, 2_200);
    return () => window.clearTimeout(timer);
  }, [mode, replayIndex, replayPlaying]);

  const decide = async (
    action: PendingActionRow,
    decision: "approve" | "reject",
  ) => {
    if (!supabase || busyActionId) return;
    if (
      decision === "reject" &&
      !window.confirm(
        "Rejecting this action moves the scenario to Needs Review. Continue?",
      )
    ) {
      return;
    }
    setBusyActionId(action.id);
    setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke("approve-action", {
        body: {
          pending_action_id: action.id,
          decision,
          decided_by: OPERATOR_ID,
        },
      });
      if (invokeError) throw invokeError;
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval could not be executed");
    } finally {
      setBusyActionId(null);
    }
  };

  const simulate = async (action: SimulationAction) => {
    if (!supabase || busySimulation) return;
    if (
      (action === "reset" || action === "new_scenario" || action === "restore_hero") &&
      snapshot?.scenario.phase !== "baseline" &&
      !window.confirm(
        action === "reset"
          ? "Reset the current synthetic incident and clear its audit events?"
          : action === "restore_hero"
            ? "Replace the current synthetic incident with the canonical hero scenario?"
            : "Replace the current synthetic incident with a new deterministic scenario?",
      )
    ) {
      return;
    }
    setBusySimulation(action);
    setError(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke("simulate", {
        body: { action },
      });
      if (invokeError) throw invokeError;
      if (action === "reset" || action === "new_scenario" || action === "restore_hero") {
        setEvents([]);
        setSelectedEvent(null);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Simulation action failed");
    } finally {
      setBusySimulation(null);
    }
  };

  const enterReplay = async () => {
    setError(null);
    try {
      const initial = await loadReplayCapture();
      setSelectedEvent(null);
      setReplay(initial);
      setReplayIndex(0);
      setReplayPlaying(true);
      setMode("replay");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replay capture could not be loaded");
    }
  };

  const exitReplay = () => {
    if (replayOnly) return;
    setReplayPlaying(false);
    setSelectedEvent(null);
    setMode("live");
    void refresh();
  };

  const toggleReplay = () => {
    if (replayIndex >= replayStages.length - 1) {
      setReplayIndex(0);
      setReplayPlaying(true);
      return;
    }
    setReplayPlaying((current) => !current);
  };

  if (!replayOnly && !isSupabaseConfigured) return <ConfigurationRequired />;
  if (
    loading ||
    (mode === "live" && !snapshot) ||
    (mode === "replay" && !replay)
  ) {
    return <DeskLoading />;
  }
  const displayedSnapshot = mode === "replay" ? replay!.snapshot : snapshot!;
  const displayedEvents = mode === "replay" ? replay!.events : events;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[#20352e]/90 bg-[#07110f]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="data-grid flex size-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300">
              <Route size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-[0.08em] text-white uppercase">
                  Nomination Desk
                </h1>
                <span className="hidden rounded border border-[#2d453d] px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-[#799087] uppercase sm:inline">
                  Synthetic
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-[#6e857c]">
                North Texas Corridor · Operator control
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-[#293f38] bg-[#091411] px-2.5 py-1.5 md:flex">
              <Database size={11} className="text-sky-300" />
              <span className="text-[9px] font-semibold tracking-wide text-[#80968e] uppercase">
                {mode === "replay" ? "Captured fixture" : "Supabase SOR"}
              </span>
              <span
                className={`size-1.5 rounded-full ${
                  mode === "replay"
                    ? "bg-sky-300"
                    : realtimeState === "live"
                      ? "bg-emerald-400"
                      : "bg-amber-300"
                }`}
              />
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={mode === "replay"}
              className="flex size-8 items-center justify-center rounded-lg border border-[#2d453d] text-[#82988f] transition hover:bg-white/[0.035] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Refresh desk data"
              title="Refresh desk data"
            >
              <RefreshCw size={13} />
            </button>
            <div className="flex items-center gap-2 border-l border-[#294038] pl-2 sm:pl-3">
              <span className="flex size-8 items-center justify-center rounded-full border border-[#30483f] bg-[#0b1814] text-[#9eb1aa]">
                <UserRound size={13} />
              </span>
              <div className="hidden sm:block">
                <p className="text-[10px] font-semibold text-[#c4d2cd]">Control Room Scheduler</p>
                <p className="text-[8px] tracking-wide text-[#60766e] uppercase">Single operator</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-4 px-3 py-4 sm:px-6 sm:py-5">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3.5 py-3 text-xs text-rose-100"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-300" />
            <p className="flex-1 leading-5">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-200/70 hover:text-rose-100"
              aria-label="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {mode === "replay" && (
          <div className="flex items-center gap-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] px-3.5 py-3 text-xs text-sky-100">
            <Radio size={14} className="shrink-0 text-sky-300" />
            <p className="flex-1 leading-5">
              <strong>Replay mode:</strong> verified captured data is playing locally. No database
              writes, approvals, model calls, or external messages can occur.
            </p>
          </div>
        )}

        <SimClock
          simClock={displayedSnapshot.scenario.sim_clock_ct}
          gasDay={displayedSnapshot.scenario.gas_day}
          phase={displayedSnapshot.scenario.phase}
          openCycle={displayedSnapshot.openCycle}
          cycleMinutesRemaining={displayedSnapshot.cycleMinutesRemaining}
          hasRunningWork={displayedSnapshot.hasRunningWork}
          realtimeState={realtimeState}
          mode={mode}
        />
        <PhaseRail phase={displayedSnapshot.scenario.phase} />
        <NoticeBanner notice={displayedSnapshot.latestNotice} />

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.65fr)]">
          <div className="min-w-0 space-y-4">
            <SegmentBars segments={displayedSnapshot.segments} />
            <PositionTable positions={displayedSnapshot.positions} />
            <AgentFeed
              events={displayedEvents}
              realtimeState={realtimeState}
              mode={mode}
              viewMode={eventViewMode}
              onViewModeChange={setEventViewMode}
              selectedEventId={selectedEvent?.id ?? null}
              onSelect={setSelectedEvent}
            />
          </div>

          <aside className="grid gap-4 md:grid-cols-2 xl:sticky xl:top-[76px] xl:grid-cols-1">
            {mode === "replay" && replay
              ? (
                <ReplayPanel
                  frame={replay}
                  playing={replayPlaying}
                  canExit={!replayOnly}
                  onTogglePlaying={toggleReplay}
                  onPrevious={() => {
                    setReplayPlaying(false);
                    setReplayIndex((current) => Math.max(0, current - 1));
                  }}
                  onNext={() => {
                    setReplayPlaying(false);
                    setReplayIndex((current) => Math.min(replayStages.length - 1, current + 1));
                  }}
                  onRestart={() => {
                    setReplayIndex(0);
                    setReplayPlaying(true);
                  }}
                  onExit={exitReplay}
                />
              )
              : (
                <SimulationPanel
                  phase={displayedSnapshot.scenario.phase}
                  seed={displayedSnapshot.scenario.seed}
                  latestScadaEvent={displayedSnapshot.latestScadaEvent}
                  hasRunningWork={displayedSnapshot.hasRunningWork}
                  busyAction={busySimulation}
                  onAction={(action) => void simulate(action)}
                  onReplay={() => void enterReplay()}
                />
              )}
            <ApprovalQueue
              actions={displayedSnapshot.actions}
              busyActionId={busyActionId}
              readOnly={mode === "replay"}
              onDecision={(action, decision) => void decide(action, decision)}
            />
          </aside>
        </div>

        <footer className="flex flex-col gap-2 border-t border-[#1d302a] px-1 pt-4 pb-2 text-[9px] text-[#5e746c] sm:flex-row sm:items-center sm:justify-between">
          <span>
            {mode === "replay"
              ? "Verified replay · Captured synthetic data · No live writes or model calls"
              : "Synthetic data only · Browser reads are RLS-bound · Writes require a human-gated Edge Function"}
          </span>
          <span className="mono flex items-center gap-1.5">
            <Radio size={9} />
            {displayedEvents.length} append-only events
          </span>
        </footer>
      </main>

      <AuditDrawer
        open={selectedEvent !== null}
        selectedEvent={selectedEvent}
        events={displayedEvents}
        actions={displayedSnapshot.actions}
        viewMode={eventViewMode}
        onClose={() => setSelectedEvent(null)}
        onSelectEvent={setSelectedEvent}
        onViewModeChange={setEventViewMode}
      />
    </div>
  );
}

function ConfigurationRequired() {
  return (
    <main className="data-grid flex min-h-screen items-center justify-center px-5">
      <section className="panel w-full max-w-lg p-6 sm:p-8">
        <div className="flex size-11 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200">
          <Database size={19} />
        </div>
        <p className="eyebrow mt-5">Client configuration</p>
        <h1 className="mt-2 text-xl font-semibold text-white">Connect the read-only desk</h1>
        <p className="mt-3 text-sm leading-6 text-[#94a9a1]">
          Copy <code className="mono text-emerald-200">.env.example</code> to{" "}
          <code className="mono text-emerald-200">.env.local</code> and provide only the
          project URL and browser-safe publishable key.
        </p>
        <div className="mono mt-5 rounded-xl border border-[#2b423a] bg-[#07100e] p-4 text-[11px] leading-6 text-[#8fa49c]">
          VITE_SUPABASE_URL=…<br />
          VITE_SUPABASE_PUBLISHABLE_KEY=…
        </div>
        <p className="mt-4 text-[10px] leading-5 text-[#687f76]">
          Service-role and Anthropic credentials are server-only and must never use a VITE_ prefix.
        </p>
      </section>
    </main>
  );
}

function DeskLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <span className="mx-auto block size-7 animate-spin rounded-full border-2 border-[#294039] border-t-emerald-400" />
        <p className="mt-3 text-xs font-semibold text-[#8ea49c]">Loading operations SOR…</p>
      </div>
    </main>
  );
}
