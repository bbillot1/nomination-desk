# Nomination Desk — Engineering Specification (v3.1)

**An agentic gas-control copilot for a natural gas pipeline operator.**

Nomination Desk sits on the **pipeline operator's** scheduling desk. When an operational upset
derates capacity, coordinated AI agents recut affected nominations under tariff priority,
assess every shipper's imbalance exposure against a proposed or active flow order, and draft the EBB
notice and shipper notifications — then stop for human approval. Every step is written to an
append-only audit trail with tariff citations.

Status: reference implementation. All source systems are simulated (§2). All operational data is
synthetic.

---

## 0. Working with this document

Build in the phase order of §13. The order is chosen so a partial build still runs end to end.

**Invariants for the entire codebase:**

1. **The model never performs arithmetic.** Every dollar figure, allocation, and volume is
   produced by a deterministic TypeScript function. The model selects which function to call
   and explains the result.
2. **Every agent step writes an event row.** `console.log` is not a record.
3. **Nothing executes without an approval row.** Drafting is unrestricted; executing is gated.
4. **Numbers in §6 are canonical.** They are the fixtures for unit tests and the hero seed.
   If code produces different numbers, the code is wrong.
5. **No floating point for volumes or money.** Volumes are integer Dth. Money is integer
   cents. See §7.0 for the TypeScript representation rules.
6. **The desk is the operator's.** No code path in this system buys gas, sells gas, or moves a
   shipper's storage. The operator allocates capacity, evaluates compliance, and communicates.
   Cure decisions belong to shippers.

---

## 1. Problem context

Natural gas pipeline scheduling runs on fixed FERC/NAESB nomination deadlines — Timely,
Evening, and three intraday cycles — every day of the year. The **operator's** gas control and
commercial scheduling desk receives nominations from shippers, confirms them with connecting
parties, allocates constrained capacity under tariff priority, monitors physical flows against
schedule, and issues operational notices when system integrity requires it.

Three structural weaknesses in the manual process:

- **Deadline-driven, not condition-driven.** Between cycles, nothing systematically watches. A
  compressor trip at 16:15 is only actionable if the right person sees it and works the full
  consequence chain — derate, recut, compliance assessment, notice — before the next deadline.
- **Expertise is undocumented.** The judgment lives with senior schedulers and is applied
  inconsistently across shifts.
- **No defensible decision record.** When an allocation or penalty assessment is disputed weeks
  later, the justification is reconstructed from memory and email.

An operator that responds slowly to an upset faces escalating consequences: uncured shipper
imbalances drain line pack, forcing escalation from an OFO to an Emergency Flow Order or to
curtailment of firm service — a reliability event with regulatory and commercial fallout. This
system compresses the detect → recut → assess → notify chain from hours to minutes, with a
human approving every externally visible action.

---

## 2. Simulated source systems

In production each system below is an external integration exposed through an MCP server. In
this reference implementation each is a logical domain within one Postgres schema plus a tool
module exposing **MCP-shaped contracts** —
tool definitions in the Anthropic tool-use JSON schema, structured results, no side channels.
Production integration additionally requires MCP discovery, transport, authentication, and
result adapters; the agent-facing contract is what carries over.

### 2.1 SCADA / Historian — physical measurement

Field telemetry and time-series measurement: compressor status, pressures, meter volumes.
Representative products: AVEVA PI System, CygNet, Emerson. In this system it plays two roles:
the **origin of the incident** (a compressor trip event) and the **source of measured flows**
that reveal shipper imbalances.
Simulation: tables `scada_events`, `actual_flows`. Tool module `historian.ts`.

### 2.2 EBB — Electronic Bulletin Board

The pipeline's public site. Direction matters and is operator-correct throughout this spec:
**shippers submit nominations inbound** through the EBB; **the operator posts notices
outbound** (OFOs, capacity constraints, maintenance). An operational event on SCADA leads to a
**drafted** EBB notice that a human approves before posting.
Simulation: tables `notices`, `nominations` (inbound rows). Tool module `ebb.ts`.

### 2.3 Operations system of record

The back-office platform owning contracts, tariff terms, measurement, allocation, and
settlement. Quorum Software is the dominant vendor in the category. **Integration posture:**
this system is not replaced. Agents read contract and tariff data from it and write allocation
recommendations back. No code path here mutates contract or settlement data.
Simulation: tables `contracts`, `tariff_rules`, `shippers`, `points`, `segments`. Tool module
`quorum.ts`.

### 2.4 ETRM — deliberately out of scope

The trading system of record (ETRM) is **excluded** from the current reference scope. Its only conceivable
role in the operator framing was a market price reference inside shipper communications, which
adds integration scope and commercial-advice ambiguity without strengthening the core
workflow. Shipper messages state cure mechanics and deadlines; shippers consult their own
market data. ETRM integration appears on the production roadmap for operator commercial
functions outside this scope.

| System | One line | Module |
|---|---|---|
| SCADA/Historian | Physical events and measured reality. | `historian.ts` |
| EBB | Nominations in from shippers; notices out from the operator. | `ebb.ts` |
| Operations SOR | Contracts, tariff rules, allocation, settlement. | `quorum.ts` |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  WEB CLIENT (React + Vite + TypeScript + Tailwind)                   │
│  Desk: positions · segments · sim clock · agent feed · approvals      │
│  Audit drawer · Skill library · Simulation console                    │
└───────────────▲──────────────────────────────┬───────────────────────┘
                │ Realtime (backlog fetch      │ invoke
                │  + insert subscription)      ▼
┌───────────────┴──────────────────────────────────────────────────────┐
│  EDGE FUNCTIONS (Deno)                                               │
│    agent-run       supervisor loop (EdgeRuntime.waitUntil)           │
│    approve-action  executes one approved pending_action              │
│    simulate        scenario state machine driver                     │
└───────────────┬──────────────────────────────────────────────────────┘
                │
    ┌───────────┴────────────┐
    ▼                        ▼
┌─────────────────┐   ┌──────────────────────────────────────────────┐
│ Anthropic API   │   │  TOOL LAYER (MCP-shaped contracts)           │
│ claude-sonnet-5 │   │  historian.ts · ebb.ts · quorum.ts          │
│ tool use        │   │  engines.ts (deterministic calculation)      │
└─────────────────┘   └───────────────┬──────────────────────────────┘
                                      ▼
                      ┌──────────────────────────────────────────────┐
                      │  POSTGRES (Supabase)                         │
                      │  simulated source systems + scenario state   │
                      │  + agent_events (append-only audit)          │
                      └──────────────────────────────────────────────┘
```

**Agent topology.** One supervisor loop, four personas. Each specialist is a distinct system
prompt plus a restricted tool subset the supervisor delegates to.

| Agent | Responsibility | Tool access |
|---|---|---|
| **Supervisor** | Routing, sequencing, approval decisions, audit completeness | delegation only |
| **Scheduling** | Derate recuts: capacity, tariff priority, proration | quorum, ebb (read), capacity/priority engines, `stage_allocation` |
| **Exception** | Flow-order compliance: imbalance, exposure, ranking | historian, ebb (read), quorum, imbalance/exposure engines |
| **Communications** | Drafting the EBB notice and per-shipper notifications | quorum (read), `draft_ebb_notice`, `draft_shipper_message` |

Roadmap agents (not implemented in the current scope): Intake (unstructured nomination
requests), Confirmation (mismatch handling), Forecasting, and Compliance/Regulatory.

---

## 4. Repository layout

```
nomination-desk/
├── README.md
├── BUILD_SPEC.md
├── docs/
│   ├── architecture.md
│   └── production-roadmap.md
├── skills/
│   ├── derate-response.md          ← hero flow: recut + compliance + comms
│   ├── capacity-shortfall.md       ← allocation mechanics (used by Scheduling)
│   └── shipper-communication.md    ← used by Communications
├── supabase/
│   ├── migrations/
│   │   ├── 0001_schema.sql
│   │   ├── 0002_rls.sql
│   │   └── 0003_seed.sql           ← hero seed (§6)
│   └── functions/
│       ├── _shared/
│       │   ├── db.ts
│       │   ├── anthropic.ts
│       │   ├── events.ts
│       │   ├── skills.ts
│       │   ├── scenario.ts         ← generator + validator (§12)
│       │   ├── numeric.ts          ← Dth/cents representation helpers (§7.0)
│       │   ├── prompts/
│       │   │   ├── supervisor.ts
│       │   │   ├── scheduling.ts
│       │   │   ├── exception.ts
│       │   │   └── communications.ts
│       │   └── tools/
│       │       ├── index.ts
│       │       ├── historian.ts
│       │       ├── ebb.ts
│       │       ├── quorum.ts
│       │       └── engines.ts
│       ├── agent-run/index.ts
│       ├── approve-action/index.ts
│       └── simulate/index.ts
├── tests/
│   ├── engines.test.ts
│   └── scenario.test.ts
└── src/
    ├── main.tsx
    ├── lib/supabase.ts
    ├── lib/events.ts               ← backlog fetch + subscribe + dedupe
    ├── pages/Desk.tsx
    └── components/
        ├── PositionTable.tsx
        ├── SegmentBars.tsx
        ├── SimClock.tsx
        ├── AgentFeed.tsx
        ├── ApprovalQueue.tsx
        ├── AuditDrawer.tsx
        ├── SkillViewer.tsx
        └── SimulationPanel.tsx
```

---

## 5. Data model

Full DDL for `0001_schema.sql`.

```sql
-- ============ SCENARIO STATE ============

-- Exactly one row. The simulated clock and lifecycle for the active scenario.
create table scenario_state (
  id             int primary key default 1 check (id = 1),
  seed           text not null,              -- 'hero' or a generated seed string
  gas_day        date not null,
  sim_clock_ct   timestamptz not null,       -- current simulated time
  phase          text not null default 'baseline',
      -- baseline | incident_posted | recut_pending | recut_applied
      -- | comms_pending | resolved | needs_review
  params         jsonb not null,   -- scenario parameters (§12.1): derate value, incident
                                   -- time, notice stage/tolerance/rate, IT noms, deviations
  answer_key     jsonb not null,   -- engine-computed expected outcomes (§12.2)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ============ OPERATIONS SOR DOMAIN ============

create table pipelines (
  id          text primary key,
  name        text not null,
  kind        text not null check (kind in ('interstate','intrastate')),
  operator    text not null,
  tariff_ref  text
);

create table points (
  id          text primary key,
  pipeline_id text not null references pipelines(id),
  name        text not null,
  point_type  text not null check (point_type in ('receipt','delivery','storage')),
  meter_id    text
);

create table segments (
  id                     text primary key,
  pipeline_id            text not null references pipelines(id),
  name                   text not null,
  from_point             text not null references points(id),
  to_point               text not null references points(id),
  design_capacity_dth    bigint not null,
  operating_capacity_dth bigint not null,     -- mutated by trip_compressor at incident time
                                              -- (physical reality; not gated on approval)
  seq                    int not null
);

create table shippers (
  id            text primary key,
  name          text not null,
  duns          text,
  shipper_type  text not null,   -- producer | ldc | power_gen | data_center | marketer
  contact_email text
);

create table contracts (
  id                     text primary key,
  shipper_id             text not null references shippers(id),
  pipeline_id            text not null references pipelines(id),
  contract_number        text not null,
  service_type           text not null check (service_type in ('FT','IT')),
  mdq_dth                bigint,              -- null for IT
  primary_receipt_point  text references points(id),
  primary_delivery_point text references points(id),
  storage_rights_dth     bigint default 0,
  storage_point          text references points(id),
  effective_start        date not null,
  effective_end          date not null
);

create table tariff_rules (
  id            text primary key,
  pipeline_id   text not null references pipelines(id),
  rule_type     text not null,  -- scheduling_priority | ofo_penalty | tolerance | proration_method
  rule_key      text not null,
  value_numeric numeric,
  value_text    text,
  citation      text not null   -- synthetic, e.g. 'GT&C §52.3 (synthetic)'
);

-- ============ EBB DOMAIN ============

create table cycles (
  id          text primary key,
  pipeline_id text not null references pipelines(id),
  gas_day     date not null,
  cycle_type  text not null check (cycle_type in ('timely','evening','id1','id2','id3')),
  deadline_ct timestamptz not null,
  status      text not null default 'closed'   -- open | closed | scheduled
);

create table nominations (
  id             text primary key,
  cycle_id       text not null references cycles(id),
  contract_id    text not null references contracts(id),
  shipper_id     text not null references shippers(id),
  receipt_point  text not null references points(id),
  delivery_point text not null references points(id),
  -- priority is nomination-level: a firm shipper nominating a non-primary point is rank 2.
  priority_rank  int  not null check (priority_rank in (1,2,3)),
      -- 1 firm primary | 2 firm secondary | 3 interruptible
  nominated_dth  bigint not null,
  scheduled_dth  bigint,          -- written ONLY by approve-action executing an allocation
  status         text not null default 'scheduled',
      -- submitted | scheduled | cut | superseded
  cut_reason     text,
  created_at     timestamptz default now()
);

create table notices (
  id               text primary key,
  pipeline_id      text not null references pipelines(id),
  notice_type      text not null,  -- ofo | efo | capacity_constraint | maintenance
  headline         text not null,
  body_text        text not null,
  stage            text,
  tolerance_pct    numeric,
  penalty_rate_cents_dth bigint,   -- integer cents per Dth
  affected_segment text references segments(id),
  derate_to_dth    bigint,
  effective_start  timestamptz,      -- NULL while status='draft'; set equal to posted_at
                                     -- in the posting transaction (effective upon posting)
  effective_end    timestamptz,
  status           text not null default 'draft',  -- draft | posted
  posted_at        timestamptz,
  created_at       timestamptz default now()
);

-- ============ SCADA / HISTORIAN DOMAIN ============

create table scada_events (
  id          text primary key,
  pipeline_id text not null references pipelines(id),
  event_type  text not null,   -- compressor_trip | compressor_restore | pressure_alarm
  asset       text not null,   -- e.g. 'Midland Station Unit 2'
  segment_id  text references segments(id),
  detail      jsonb not null,  -- { derated_capacity_dth: ... }
  occurred_at timestamptz not null,
  acknowledged boolean default false
);

-- Gas-day aligned: flow_hour 0 = 09:00 CT on gas_day, flow_hour 23 = 08:00 CT next day.
-- Measured at DELIVERY meters: rows record each shipper's takes at its delivery point.
-- Takes above scheduled deliveries drain line pack — the physical basis of the incident.
create table actual_flows (
  id         bigserial primary key,
  point_id   text not null references points(id),
  shipper_id text not null references shippers(id),
  gas_day    date not null,
  flow_hour  int  not null check (flow_hour between 0 and 23),
  volume_dth bigint not null
);
create index on actual_flows (gas_day, shipper_id, point_id);

-- ============ AGENT DOMAIN ============

create table agent_runs (
  id            text primary key,
  workflow_id   text not null,   -- shared by all runs of one incident (initial + continuation)
  parent_run_id text references agent_runs(id),
  trigger_type  text not null,  -- scada_event | approval_continuation | manual
  trigger_ref   text,
  status        text not null default 'running',
      -- queued | running | awaiting_approval | complete | failed
      -- 'queued' is used only for continuation runs written inside the approval
      -- transaction (outbox pattern, §10.2); the loop claims queued → running
  gas_day       date,
  started_at    timestamptz default now(),
  ended_at      timestamptz,
  error_text    text
);
create index on agent_runs (workflow_id);
-- at most one NON-FAILED run per trigger type within a workflow: makes continuation
-- invocation idempotent while still allowing a failed continuation to be retried
create unique index agent_runs_workflow_trigger on agent_runs (workflow_id, trigger_type)
  where status <> 'failed';

-- APPEND ONLY. No updates, no deletes.
create table agent_events (
  id          bigserial primary key,
  run_id      text not null references agent_runs(id),
  workflow_id text not null,   -- denormalized from the run: lets the client fetch and
                               -- subscribe to a whole incident without run discovery
  seq         int not null,
  agent_name  text not null,   -- supervisor | scheduling | exception | communications
  event_type  text not null,
      -- analysis_summary | tool_call | tool_result | decision | escalation | error
  summary     text not null,   -- one plain-English sentence; the user-facing record
  detail      jsonb,           -- evidence: figures used, options considered. NOT raw model text.
  tool_name   text,
  tool_input  jsonb,
  tool_output jsonb,
  citation    text,
  skill_used  text,
  created_at  timestamptz default now(),
  unique (run_id, seq)
);
create index on agent_events (workflow_id);

create table pending_actions (
  id            text primary key,
  run_id        text not null references agent_runs(id),
  action_type   text not null,
      -- apply_allocation | post_ebb_notice | send_shipper_message | acknowledge_escalation
  title         text not null,
  rationale     text not null,
  payload       jsonb not null,          -- schema per action_type, §10.2
  dollar_impact_cents bigint,
  status        text not null default 'pending',
      -- pending | executing | executed | rejected | failed
  decided_by    text,
  decided_at    timestamptz,
  executed_at   timestamptz,
  result        jsonb,                   -- written by approve-action
  created_at    timestamptz default now()
);

create table skills (
  id                  text primary key,
  name                text not null,
  trigger_description text not null,
  body_md             text not null,
  version             text not null,
  author              text
);
```

`0002_rls.sql`: enable RLS on every table; grant `select` to `anon`; all writes restricted to
`service_role`. Edge functions hold the service-role key. The browser can read everything and
write nothing.

`0002_rls.sql` also adds every client-rendered table to the Realtime publication:
`alter publication supabase_realtime add table agent_runs, agent_events, pending_actions,
notices, nominations, segments, scenario_state;`. The client subscribes to INSERT **and
UPDATE** on the mutable tables (including `agent_runs`, so the continuation run and status
changes are discovered live); `agent_events` is append-only, so INSERT alone suffices there.

**Time convention.** All simulated timestamps are stored as `timestamptz` and rendered in CT.
`actual_flows.flow_hour` is **gas-day aligned**: hour 0 begins 09:00 CT on `gas_day`, hour 23
ends 09:00 CT the following calendar day. Every tool that returns flow data states this
convention in its output so the agents describe time correctly.

---

## 6. Hero seed — canonical fixture

Seed `0003_seed.sql` loads this exact state. It is also the `seed='hero'` scenario for the
generator (§12). All names, volumes, and tariff citations are synthetic; citations are
suffixed "(synthetic)" in the data to make this unambiguous.

### 6.1 Simulated clock at load

`scenario_state`: `gas_day = D`, `sim_clock_ct = D 16:00 CT`, `phase = 'baseline'`,
`seed = 'hero'`.

Timeline already in the past at load (all timestamps seeded accordingly):

| Sim time | Event |
|---|---|
| D−1 13:00 | Timely cycle closed; allocations published (§6.4) |
| D−1 18:00 | Evening cycle closed; no changes |
| D 09:00 | Gas day D begins (flow_hour 0) |
| D 14:00 | ID2 closed; no changes |
| D 16:00 | **Now.** Complete measured flows exist for flow_hours 0–5 (09:00–15:00); flow_hour 6 is in progress and not yet posted |

The only cycle still open for gas day D: **ID3, deadline D 19:00 CT** (`status='open'`).

### 6.2 Network

Pipeline `ETX-NTX` — "North Texas Corridor", intrastate.

| Segment | Path | Design | Operating (at load) |
|---|---|---|---|
| SEG-1 | Waha Hub → Midland Junction | 1,200,000 | 1,200,000 |
| **SEG-2** | **Midland Junction → Abilene Junction** | **900,000** | **900,000** |
| SEG-3 | Abilene Junction → DFW South | 1,400,000 | 1,400,000 |

Points: `RP-WAHA` (receipt), `RP-MIDL` (receipt), `RP-BETH` (storage, downstream of SEG-2),
`DP-LSPP-GEN`, `DP-ABIL-DC`, `DP-DFW-LDC`, `DP-INDL` (deliveries).

### 6.3 Shippers, contracts, and Timely nominations

| Shipper | Type | Service | MDQ | Path | Storage rights | Nominated | priority_rank |
|---|---|---|---|---|---|---|---|
| Lone Star Power Partners (LSPP) | power_gen | FT | 250,000 | RP-WAHA → DP-LSPP-GEN | 40,000 @ RP-BETH | 250,000 | 1 |
| Abilene Compute LLC (ABCL) | data_center | FT | 300,000 | RP-WAHA → DP-ABIL-DC | 0 | 300,000 | 1 |
| North Texas Gas Utility (NTGU) | ldc | FT | 180,000 | RP-MIDL → DP-DFW-LDC | 0 | 180,000 | 1 |
| Cardinal Energy Marketing (CEMK) | marketer | IT | — | RP-WAHA → DP-INDL | 0 | 150,000 | 3 |
| Sabine Trading Co (SABT) | marketer | IT | — | RP-MIDL → DP-INDL | 0 | 100,000 | 3 |

All five nominations traverse SEG-2. Firm total on SEG-2 = **730,000 Dth**.

### 6.4 Published Timely allocation (already applied at load)

Capacity 900,000. Firm scheduled in full (730,000). IT headroom = 170,000 against 250,000
nominated → factor **0.68** → CEMK **102,000**, SABT **68,000**. All rows `status='scheduled'`
with these `scheduled_dth` values. Total scheduled = 900,000.

### 6.5 Tariff rules

| rule_type | rule_key | value | citation |
|---|---|---|---|
| scheduling_priority | firm_primary | 1 | GT&C §12.1 (synthetic) |
| scheduling_priority | firm_secondary | 2 | GT&C §12.2 (synthetic) |
| scheduling_priority | interruptible | 3 | GT&C §12.4 (synthetic) |
| proration_method | it_prorata | pro_rata_by_nomination | GT&C §12.6 (synthetic) |
| tolerance | stage_2_pct | 5.0 | GT&C §52.3 (synthetic) |
| tolerance | stage_3_pct | 3.0 | GT&C §52.4 (synthetic) |
| ofo_penalty | stage_2_rate_cents_dth | 2500 | GT&C §52.3 (synthetic) |
| ofo_penalty | stage_3_rate_cents_dth | 5000 | GT&C §52.4 (synthetic) |

### 6.6 The incident (injected by `simulate`, not present at load)

`scada_events` row inserted when the operator clicks **Trip Compressor** (values read from
`scenario_state.params`; hero values shown):

```
event_type  : compressor_trip
asset       : Midland Station Unit 2
segment_id  : SEG-2
detail      : { "derated_capacity_dth": 820000 }
occurred_at : D 16:15 CT
```

### 6.7 Expected recut (Scheduling agent output)

At derated capacity 820,000: firm untouched (730,000). IT headroom = **90,000** against
250,000 nominated → factor **0.36** → CEMK **54,000**, SABT **36,000**. Cuts: CEMK −48,000,
SABT −32,000. Staged as a `pending_actions` row (`apply_allocation`); **`scheduled_dth` does
not change until approval** (§10.2).

### 6.8 Measured flows and expected compliance assessment

The draft OFO carries `tolerance_pct = 5.0`, `penalty_rate_cents_dth = 2500` (Stage 2).
Imbalance basis, stated synthetically and precisely: **a shipper's projected full-gas-day
deliveries (takes, measured at its delivery meter) versus its post-recut full-day scheduled
delivery quantity.** Takes above schedule drain line pack — that is the physical mechanism
that makes the derated system unstable and is why the correct cures are reducing takes or
adding supply downstream of the constraint. All figures are presented as **projected
potential exposure under the proposed OFO** — a forecast that lets shippers act before a
violation crystallizes, not an assessed penalty. The OFO itself is effective **upon posting**
(no retroactive application). (Real tariffs define several imbalance constructions; this
reference implementation uses this one, and the notice text states it.)

Seeded hourly flows (flow_hours 0–5 measured; projection = measured total × 24 ÷ 6, an exact
×4 that keeps every figure an integer) are engineered so full-day projections come out
exactly:

| Shipper | Post-recut sched | Projected actual | Δ | Δ% | Tol (5%) | Excess | Exposure @ $25.00 |
|---|---|---|---|---|---|---|---|
| LSPP | 250,000 | 287,500 | +37,500 | +15.0% | 12,500 | **25,000** | **$625,000.00** |
| ABCL | 300,000 | 321,000 | +21,000 | +7.0% | 15,000 | **6,000** | **$150,000.00** |
| NTGU | 180,000 | 178,200 | −1,800 | −1.0% | 9,000 | 0 | $0 |
| CEMK | 54,000 | 54,000 | 0 | 0.0% | 2,700 | 0 | $0 |
| SABT | 36,000 | 35,500 | −500 | −1.4% | 1,800 | 0 | $0 |

Aggregate shipper exposure: **$775,000.00 per gas day**. This is the affected shippers'
potential non-compliance exposure — not operator savings. The operator's stake, which the
Exception agent must state in an event: if these positions stay uncured, system line pack
continues to degrade and the desk faces escalation to an EFO or curtailment of firm service.

Flow shapes: LSPP rises across the six measured flow_hours (power dispatch); ABCL climbs
steadily (compute load ramping); NTGU flat; CEMK/SABT flat at their recut rates. Hourly values
are integers summing exactly to each shipper's measured six-hour total (projected ÷ 4:
LSPP 71,875 · ABCL 80,250 · NTGU 44,550 · CEMK 13,500 · SABT 8,875). `project_daily_total`
returns its method string ("run-rate extrapolation over 6 measured hours") so agents state the
method rather than assert the number.

### 6.9 Expected communications (Communications agent output)

Two pending actions:

1. **`post_ebb_notice`** — Stage 2 OFO draft: headline, affected segment, derate to 820,000,
   tolerance ±5% on the imbalance basis above, penalty rate $25.00/Dth, **effective upon
   posting**, first actionable cycle ID3 with deadline D 19:00. Citations attached.
2. **`send_shipper_message`** (batched payload, one message per affected party):
   - **LSPP** — projected exposure $625,000/day; notes LSPP's own 40,000 Dth of storage
     rights at RP-BETH, downstream of the constraint, as a cure path **available to LSPP**
     via an ID3 renomination before 19:00. Framed as information, not instruction.
   - **ABCL** — projected exposure $150,000/day; states cure options (reduce take, or
     self-supply from a source downstream of the constraint) and the ID3 deadline. Written in
     plain language for a customer without a gas scheduling desk; defines any tariff term it
     uses in one clause. No market prices and no commercial recommendations.
   - **CEMK / SABT** — cut notifications: volume cut, reason (capacity derate), tier applied,
     proration factor 0.36, citation.
   - **NTGU** — no message. Inside tolerance and uncut; the skill forbids noise.

---

## 7. Tool catalog

### 7.0 Numeric representation (`numeric.ts`)

- **Volumes:** integer Dth end to end (`bigint` columns, `number` in TS — all values far below
  2^53). Helper `dth(n)` asserts integer.
- **Money:** integer cents in storage and computation (`bigint` columns). Formatting to
  `"$625,000.00"` happens only at the presentation edge (`formatUsd(cents)`), and inside
  `formula_string`.
- **Rates and factors:** proration factors and percentages are computed in integer arithmetic
  where possible (e.g., `scheduled = floor(nominated * headroom / tier_total)`) and reported
  as decimal strings rounded to 4 places, never used as floats in further math.
- Division rounds **down** (floor). Remainder assignment per §7.5.

### 7.1 `historian.ts`

| Tool | Input | Returns |
|---|---|---|
| `get_scada_events` | `pipeline_id`, `unacknowledged_only?` | events with asset, segment, detail, occurred_at |
| `get_actual_flows` | `gas_day`, `shipper_id?` | hourly series (gas-day aligned; convention stated in output) + measured total |
| `project_daily_total` | `gas_day`, `shipper_id` | measured total, hours elapsed, projection, method string |

### 7.2 `ebb.ts`

| Tool | Input | Returns |
|---|---|---|
| `get_nominations` | `gas_day`, `status?`, `shipper_id?` | nomination rows incl. priority_rank, scheduled_dth |
| `get_open_cycles` | `gas_day` | open cycles with deadline and sim-minutes remaining |
| `get_notices` | `pipeline_id`, `status?` | notice rows |
| `get_proposed_notice_terms` | — | the incident's flow-order terms from `scenario_state.params.notice`, joined to `tariff_rules` by stage so tolerance and penalty each return value **and citation** — the source of truth **before** any draft notice row exists |
| `get_segment_state` | `segment_id` | operating capacity, scheduled totals by tier, headroom |

### 7.3 `quorum.ts` (read-only)

| Tool | Input | Returns |
|---|---|---|
| `get_contract` | `shipper_id` | terms, MDQ, primary points, storage rights + storage point |
| `get_shipper` | `shipper_id` | name, type, contact |
| `get_network_topology` | `pipeline_id` | ordered segments; `segments_traversed(receipt, delivery)`; `is_downstream_of(point, segment)` |
| `get_tariff_rule` | `rule_type`, `rule_key` | value + citation |

`is_downstream_of` is explicit so the Communications agent verifies RP-BETH's position rather
than inferring it.

### 7.4 `engines.ts` — deterministic calculation

Pure functions, unit-tested against §6. No DB writes, no model involvement.

```ts
check_segment_capacity(segment_id, gas_day)
  → { operating_capacity_dth, scheduled_by_tier, headroom_dth }

apply_scheduling_priority(nominations[], operating_capacity_dth, tariff_rules)
  → { allocations: [{ nomination_id, nominated_dth, scheduled_dth, cut_dth,
        cut_reason, priority_rank }],
      proration_factor_str, binding_tier, citation }
  // Rank 1 in full unless capacity < rank-1 total (then pro-rata within rank 1 and
  // ranks 2–3 get zero — escalation required per skill). Rank 2 from remainder.
  // Rank 3 pro-rata from remaining headroom: floor(nominated * headroom / tier_total),
  // remainder Dth assigned to the largest nomination in the tier so totals tie exactly.
  // An allocation that does not tie to capacity is an error.

calculate_imbalance(scheduled_dth, projected_dth, tolerance_pct)
  → { imbalance_dth, imbalance_pct_str, tolerance_dth, excess_dth, in_violation }
  // tolerance_dth = floor(scheduled * tolerance_pct / 100)

calculate_exposure(excess_dth, penalty_rate_cents_dth, days = 1)
  → { exposure_cents, formula_string, citation }
  // formula_string e.g. "25,000 Dth × $25.00/Dth × 1 day = $625,000.00"

assess_system_impact(segment_id)
  → { uncured_excess_dth, linepack_commentary_inputs }
  // deterministic inputs the Exception agent uses to state the EFO/curtailment risk
```

### 7.5 Staging tools (write `pending_actions` only)

| Tool | action_type | Notes |
|---|---|---|
| `stage_allocation` | `apply_allocation` | payload = full allocation array from the engine, verbatim |
| `draft_ebb_notice` | `post_ebb_notice` | inserts the `notices` row with `status='draft'` in the same call and writes a pending action referencing its id; approval flips the row to `posted` |
| `draft_shipper_message` | `send_shipper_message` | payload = recipients[], each with body + evidence refs |
| `escalate_to_human` | `acknowledge_escalation` | writes an `escalation` event + a pending action carrying options and trade-offs. Approval semantics (§10.2): approve = acknowledgment recorded; reject = declined; **either decision** sets `scenario_state.phase='needs_review'` — an escalation is a stop-the-line marker, not a fork back into the normal flow |

**No model-facing tool mutates `segments`, `nominations.scheduled_dth`, or `notices.status`.**
Those transitions happen only in `approve-action` (§10.2).

---

## 8. Agent skills

Versioned markdown playbooks in `/skills`, loaded to the `skills` table at seed. The
supervisor matches the trigger against `trigger_description` and injects the matching body
into the specialist's system prompt in `<skill>` tags. Events record `skill_used`. A skill
change is a behaviour change: it does not merge without a passing evaluation run (§15).

### `skills/derate-response.md`

```markdown
---
name: Derate Response Playbook
version: 2.0
author: Senior Scheduler, Gas Control
trigger: A SCADA event derates operating capacity on a segment with scheduled
         volumes, or a capacity-constraint condition is detected on such a segment.
---

# Derate Response Playbook (Operator Desk)

You are the pipeline operator. Your obligations in a derate are, in order: system
integrity, correct tariff administration, and timely communication. You do not make
cure decisions for shippers; you give every affected shipper what it needs to make
its own decision before the deadline.

## Phase 1 — Confirm and quantify the constraint
Read the SCADA event. Identify the affected segment, the derated operating capacity,
and the effective time. Compare against currently scheduled totals by priority tier.
State the shortfall in Dth. Identify the first nomination cycle that can still act
and its deadline; state sim-minutes remaining.

## Phase 2 — Recut under tariff priority
Run the allocation engine at the derated capacity for all nominations traversing the
segment. The tariff ladder is absolute: firm primary, then firm secondary, then
interruptible. Never reorder it, never protect a commercially important shipper out
of order, never cut firm to spare interruptible.

- If the derate reaches into firm: STOP after staging. This is a material event —
  mark the escalation URGENT regardless of dollar figures, because firm proration
  triggers notification obligations and probable disputes.
- Report the proration factor and the per-shipper cuts, with the citation.
- Stage the allocation for approval. Scheduled quantities do not change until a
  human applies them.

## Phase 3 — Assess flow-order compliance
For every shipper with scheduled volume on the segment, using post-recut scheduled
quantities: pull measured flows, project the gas-day total (state the projection
method), compute imbalance against the proposed notice terms, and
compute exposure at the proposed penalty rate.

- Rank violators by exposure, largest first.
- Shippers inside tolerance are NOT actionable. Do not message them, do not
  renominate them, do not mention them in the notice. Silence toward compliant
  shippers is a feature of a well-run desk.
- State the operator's stake explicitly: what happens to line pack and system
  integrity if the largest exposures go uncured, and what the desk's next
  escalation step would be (EFO, curtailment) if they do.

## Phase 4 — Communicate before the deadline
Hand off to the shipper-communication playbook for drafting. Two artifacts are
required: the EBB notice, and individual messages to every affected shipper
(violators and cut shippers). Both are drafts; neither is sent without approval.

## Phase 5 — Document
Every figure cites its engine output; every rule cites its tariff row. The record
must let a reviewer reconstruct the entire chain from SCADA event to approved
action without access to anyone's memory.
```

### `skills/capacity-shortfall.md`

```markdown
---
name: Capacity Shortfall and Allocation Playbook
version: 1.3
author: Senior Scheduler, Gas Control
trigger: Nominations exceed available operating capacity on a segment, or a derate
         reduces capacity below currently scheduled totals.
---

# Capacity Shortfall and Allocation Playbook

## Step 1 — Establish the true constraint
A nomination is limited by the smallest headroom on any segment it traverses. Find
the binding segment with the topology tool; never assume it is the segment nearest
the delivery point. Use derated operating capacity when a derate is in effect, and
confirm the derate's effective time against the allocation being run — a derate
effective mid-day does not retroactively govern a cycle that already scheduled.

## Step 2 — Apply the priority ladder in tariff order
1. Firm primary (rank 1): allocated in full. This is what the reservation charge buys.
2. Firm secondary (rank 2): from what remains. Flag any scheduled secondary volume
   as bump-exposed to later primary nominations.
3. Interruptible (rank 3): from remaining headroom only.

Priority is a property of the nomination, not the shipper: a firm shipper nominating
a non-primary point is rank 2 for that nomination.

## Step 3 — Prorate only the constrained tier
Tiers above the constrained one are untouched; tiers below receive zero.
scheduled = floor(nominated × headroom ÷ tier_total), whole Dth. The rounding
remainder is assigned to the largest nomination in the tier so the scheduled total
ties exactly to capacity. An allocation that does not tie is an error, not an
artifact. Report the factor itself — shippers verify it against their own numbers.

## Step 4 — Firm proration is an escalation
If capacity falls below the firm total, prorate pro rata within firm, zero to
everything below, and escalate URGENT before anything is published.

## Step 5 — Notify cut shippers, and only cut shippers
Each cut shipper is told: volume cut, reason, binding segment, tier applied,
proration factor, citation. Shippers scheduled in full receive nothing.

## Step 6 — Document
Binding segment, capacity used, tier totals, factor, citation.
```

### `skills/shipper-communication.md`

```markdown
---
name: Shipper Communication Playbook
version: 1.0
author: Manager, Commercial Scheduling
trigger: A recut, notice, or compliance assessment requires outbound communication
         to shippers or a public EBB posting.
---

# Shipper Communication Playbook (Operator Desk)

## Principle
The operator informs; the shipper decides. Every message gives the recipient exactly
what it needs to act before the deadline: its numbers, its options, the clock, and
where the rules come from. No message tells a shipper what to do with its own gas,
storage, or money.

## The EBB notice
One public posting, addressed to all shippers. Must contain: what happened
(plain-language cause), the affected segment, the derated capacity, the flow-order
stage and tolerance WITH the imbalance basis stated precisely, the penalty rate, the
effective time, the first actionable cycle and its deadline, and citations. No
shipper names, no shipper-specific figures — the EBB is public.

## Individual shipper messages

### To a shipper in violation
- Its scheduled quantity, projected total, imbalance, tolerance, and exposure — with
  the formula, so the shipper can verify.
- Its available cure paths, stated as options with mechanics and deadline:
  renominate in the named cycle; reduce takes; use its own storage or alternate
  supply IF the contract shows those rights — name the specific right and where it
  sits relative to the constraint (a downstream source does not consume constrained
  capacity; say so, because it is the option most often missed under time pressure).
- No market prices and no commercial recommendations. Cure mechanics and the
  deadline only; the shipper consults its own market data.

### To a cut shipper
Volume cut, reason, tier, factor, citation, and what a later cycle could restore if
capacity returns.

### To everyone else
Nothing. A compliant shipper's reward is an empty inbox.

## Register
Match the recipient. A marketer's scheduler gets terse gas-desk language. A customer
without a scheduling desk (a data center, a new power load) gets plain English: one
clause defining any tariff term used, the deadline stated as a clock time, and the
single most important action first. Do not simplify the numbers — simplify the words.

## Always
Every message is a draft pending approval. Every figure traces to an engine output.
Every rule cites its tariff row.
```

### Roadmap agent concepts (not wired)

Intake and Confirmation remain roadmap concepts rather than runtime agents or skill files.
Adding either requires an explicit objective, restricted tool subset, versioned playbook,
scenario-specific evaluations, and the same human-approval boundaries as the current agents.

---

## 9. Agent runtime

### 9.1 Model configuration

`claude-sonnet-5` via env `AGENT_MODEL`.

- **Do not send `temperature`, `top_p`, or `top_k`.** Non-default sampling values return a
  400 on this model. Determinism comes from the engines, not sampling.
- Thinking is adaptive-on by default. For this workload, disable it on routine dispatch turns
  (`thinking: {type: "disabled"}`) and enable per-agent only if dry runs show reasoning
  quality needs it; latency budget in §16 governs.
- Reference: https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5

```bash
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set AGENT_MODEL=claude-sonnet-5
```

### 9.2 Run lifecycle

```
POST /agent-run { trigger_type, trigger_ref, gas_day, workflow_id?, parent_run_id?,
                  resume_run_id? }
  1. resume_run_id present (continuation): claim the queued row —
     UPDATE agent_runs SET status='running' WHERE id=$1 AND status='queued';
     zero rows → already claimed or terminal → respond 200 and exit quietly.
     Otherwise (fresh scada_event run): insert agent_runs (status='running';
     a NEW workflow_id is minted).
  2. EdgeRuntime.waitUntil(runLoop(run_id))   ← registered BEFORE the response is
     returned; only then respond 202 { run_id, workflow_id }
     runLoop:
       load scenario_state, matching skill, system prompt
       turn loop (max_turns = 12, wall-clock guard 100s checked before each turn):
         call Anthropic (messages + tool defs for the active specialist)
         for each text block  → write analysis_summary event
             (the model is instructed to emit one-sentence summaries; detail carries
              the evidence — figures and options — never raw deliberation)
         for each tool_use    → write tool_call event
                                dispatch handler
                                write tool_result event (+ citation)
                                append tool_result to messages
         delegation marker    → swap prompt + tool subset, continue
       on loop end:
         status = pending_actions exist ? 'awaiting_approval' : 'complete'
         update scenario_state.phase per §11
       on error/cap: write error event, status='failed', phase unchanged
```

Notes:
- Local dev: set `edge_runtime.policy = "per_worker"` in `supabase/config.toml` so background
  work survives the response; hosted functions enforce a hard wall-clock limit — the 100s
  guard keeps runs inside it.
- One retry with 1s backoff on 429/5xx.
- `seq` is a per-run counter guaranteed by `unique(run_id, seq)`; the writer increments in
  memory and retries on conflict.

### 9.3 System prompts

Prompt shape for all agents: role → injected `<skill>` → hard rules → output requirements.

Shared hard rules (all agents):

```
- You never perform arithmetic. Every figure comes from a tool. Quote formula_string
  verbatim where one is returned. If no tool provides a figure you need, say so.
- You never claim an action was taken. You stage drafts; a human executes.
- Every tariff-dependent statement carries the citation the tool returned.
- Each summary you emit is ONE plain-English sentence a non-technical reader
  understands. Put evidence in detail, not prose in summary.
```

Supervisor adds: the routing table, which mirrors the phase machine exactly. A
`scada_event` run is **Scheduling only** — confirm the constraint, stage the allocation, stop
for approval. An `approval_continuation` run is **Exception, then Communications**. The
supervisor never runs Exception against unapplied scheduled quantities; the human approval is
the boundary between the two runs, not a step inside one. Approval policy: anything mutating
schedules, posting publicly, or messaging a shipper requires approval. Completion criteria are
stated per run type.

Exception adds: "Your FIRST tool call is `get_proposed_notice_terms` — tolerance and penalty
rate come from the incident parameters, never from memory and never from a notice row that
does not yet exist. Shippers inside tolerance are not actionable — say so once and leave them
alone. State the operator's stake: what uncured excess does to line pack and what the desk's
next escalation would be."

Communications adds: "Verify any storage or alternate-supply right you mention against the
contract tool, and verify its position relative to the constraint with is_downstream_of.
Frame cure paths as the shipper's options, never as instructions."

### 9.4 Event summary examples (include in prompts)

- `Compressor trip at Midland Station Unit 2 derates SEG-2 to 820,000 Dth effective 16:15.`
- `Recut at derated capacity: firm unchanged, interruptible prorated to 0.36 — Cardinal cut 48,000, Sabine cut 32,000 (GT&C §12.6, synthetic).`
- `Lone Star projects 15.0% over schedule — 25,000 Dth beyond tolerance, $625,000.00 exposure for the gas day (GT&C §52.3, synthetic).`
- `North Texas Gas Utility is inside tolerance and requires no action.`
- `If the two violations go uncured, SEG-2 line pack continues to fall and the desk's next step is an EFO — the notice and shipper messages are staged for approval.`
- `Lone Star's contract shows 40,000 Dth of storage at Bethel, downstream of the constraint — flagged in its message as a cure option that does not consume SEG-2 capacity.`

---

## 10. Edge functions

### 10.1 `agent-run`
As §9.2. `202 { run_id, workflow_id }`; work continues under `waitUntil`.

### 10.2 `approve-action`

`POST { pending_action_id, decision: 'approve' | 'reject', decided_by }`

Execution is one transactional Postgres RPC — `execute_approval(pending_action_id, decision,
decided_by)` — so the state transition, all domain mutations, the decision event, and the
phase update commit or roll back together. Crash-safe by construction:

```
pending ──approve──▶ executing ─(same txn)─▶ executed (result written)
   │                     └── txn rollback on error ──▶ pending  (retry-safe)
   └────reject───▶ rejected  (terminal; decision event written; no execution)
```

The RPC's first statement is
`UPDATE pending_actions SET status='executing' WHERE id=$1 AND status='pending' RETURNING *`.
Zero rows returned means another caller won the race or the action is already terminal —
return the stored `result` without re-executing. Because every domain mutation happens inside
the same transaction, a crash mid-execution rolls the row back to `pending`, and a retry is
safe.

**Continuation invocation is exactly-once via an outbox written inside the approval
transaction.** When executing `apply_allocation`, the same transaction that mutates the
nominations also **inserts the continuation `agent_runs` row with `status='queued'`**
(protected by the partial unique index). There is no commit-then-invoke gap: if the
transaction commits, the queued run exists; if it rolls back, nothing exists. After commit,
the function invokes `agent-run` with `{ resume_run_id }`, whose loop **claims** the run via
`UPDATE agent_runs SET status='running' WHERE id=$1 AND status='queued'` — zero rows means
another worker already claimed it; exit quietly. The zero-row retry path of the RPC checks
for a continuation still in `queued` and re-invokes the claim — so a crash at any point after
commit is healed by simply retrying the approval. A `failed` continuation does not block a
fresh one, because the unique index excludes `status='failed'`. In the reference implementation, an
abandoned `queued` row is recovered only by the approval-retry path; a production deployment
completes the outbox with a periodic sweeper that claims any `queued` run older than a
threshold.

**Run completion.** When the last pending action belonging to a run reaches a terminal state
(`executed` or `rejected`), the same transaction transitions that run
`awaiting_approval → complete`, so run status always reflects reality on the desk.

**Rejection recovery.** Rejecting `apply_allocation`, either communications action, or an
escalation sets `scenario_state.phase='needs_review'` — a terminal phase for the current scope,
rendered as such on the progress rail. The desk state remains true (segment derated, schedule
stale or communications unsent); recovery is `reset`. In production this phase routes to a
supervisor escalation queue rather than a dead end.

Execution per `action_type`:

| action_type | payload schema | effect on approve |
|---|---|---|
| `apply_allocation` | `{ segment_id, derated_capacity_dth, allocations: [{nomination_id, scheduled_dth, cut_dth, cut_reason}] }` | UPDATE each `nominations.scheduled_dth` + `status` (`scheduled` or `cut`); write `decision` event; set `scenario_state.phase='recut_applied'`; after commit, invoke the continuation run (`trigger_type='approval_continuation'`, same `workflow_id`, `parent_run_id` = staging run). **Segment capacity is NOT touched here — the physical derate already happened at trip time (§10.3).** Rejecting the allocation leaves the segment derated and the schedule oversubscribed, which is the true state of the world; the supervisor's escalation path applies |
| `post_ebb_notice` | complete `notices` field set | UPDATE the draft notice row → `status='posted'`, `posted_at=sim_clock`; write `decision` event; phase → `resolved` when both comms actions are executed |
| `send_shipper_message` | `{ recipients: [{shipper_id, subject, body, evidence_refs}] }` | mark payload delivered in `result`; write `decision` event; phase per above |
| `acknowledge_escalation` | `{ options: [...], context }` | no domain mutation; record the decision in `result`, write `decision` event; **either** approve or reject sets `scenario_state.phase='needs_review'` (escalations stop the line; they do not fork back into the normal flow) |

**Visible-state rule.** The UI recomputes the position table and exposure figures from the
database after every executed action. Exposure changes on screen only when applied scheduled
quantities or posted notices change the underlying computation — never merely because a
pending row was created. (Approving the allocation genuinely changes CEMK/SABT scheduled
quantities and therefore their positions; LSPP/ABCL exposure remains until, in the narrative,
the shippers act — which is outside this system's authority and stated as such.)

### 10.3 `simulate`

Scenario state machine driver. `POST { action, seed? }`. Every action validates the current
`phase`, mutates state, and returns the new phase. Actions map 1:1 to Simulation panel
buttons:

| action | precondition | effect | invokes agent-run? |
|---|---|---|---|
| `reset` | no run `status='running'` | if runs are `awaiting_approval`, the same transaction first rejects their pending actions and marks those runs `complete` (teardown), so no stale action can ever execute against the new state; then replay the **current** seed to its baseline; truncate agent tables | no |
| `new_scenario` | no run `status='running'` | same teardown rule; generate + validate a new seed (§12); load it to baseline | no |
| `trip_compressor` | phase `baseline` | read `scenario_state.params`; insert the scada_event with the scenario's derate value and incident time; **UPDATE `segments.operating_capacity_dth` to the derated value in the same call — physical reality does not await approval**; advance sim_clock to the incident time; phase → `incident_posted` | **yes** (`trigger_type='scada_event'`, new workflow) |
| `advance_clock` | any | +15 sim-minutes; no other effect | no |

`reset` and `new_scenario` return 409 while any run is `running`, and the panel disables those
buttons in that state. All other transitions are driven by agent completion and approvals, not
by simulate — the console injects reality; the agents and the human do the rest.

**Approval gating governs operator outputs only.** The compressor trip and the capacity
derate it causes are simulated telemetry — physical inputs, not operator actions — and are
never approval-gated. Approvals gate what the desk *does*: applying allocations, posting
notices (at which point `effective_start` is set equal to `posted_at` in the posting
transaction), and messaging shippers.

### 10.4 Client event handling (`src/lib/events.ts`)

On mount / on new `workflow_id` (the audit unit is the incident, not the run):
1. backlog spanning both runs, ordered by run start then sequence (UUID order is not
   chronological):
   `select e.* from agent_events e join agent_runs r on r.id = e.run_id
    where e.workflow_id = W order by r.started_at, e.seq`
2. subscribe to Realtime INSERTs on `agent_events` filtered by `workflow_id = W`
3. merge by `(run_id, seq)`, dropping duplicates — events arriving during step 1 are neither
   lost nor doubled
4. subscribe to `agent_runs` (INSERT + UPDATE) so the continuation run and every status
   change are discovered live without polling

Same pattern for `pending_actions`, `notices`, `nominations`, `segments`, and
`scenario_state` — subscribing to INSERT **and UPDATE** on these mutable tables so approval
effects and the trip-time derate render without a refresh. Only `agent_events` is
INSERT-only.

---

## 11. Scenario phase machine

```
baseline
   │ trip_compressor (simulate)
   ▼
incident_posted ── agent-run: Supervisor → Scheduling stages allocation
   ▼
recut_pending  ── human approves apply_allocation
   ▼
recut_applied  ── continuation run: Exception assesses → Communications drafts
   ▼
comms_pending  ── human approves post_ebb_notice + send_shipper_message
   ▼
resolved
```

`scenario_state.phase` is updated only by the actors below — every legal transition is in
this table, and any other write to `phase` is a bug:

| From | To | Actor |
|---|---|---|
| baseline | incident_posted | `simulate.trip_compressor` |
| incident_posted | recut_pending | `agent-run` (scada_event run reaches awaiting_approval) |
| recut_pending | recut_applied | `execute_approval` (apply_allocation approved) |
| recut_pending | needs_review | `execute_approval` (apply_allocation rejected) |
| recut_applied | comms_pending | `agent-run` (continuation reaches awaiting_approval) |
| comms_pending | resolved | `execute_approval` (both comms actions executed) |
| comms_pending | needs_review | `execute_approval` (either comms action rejected) |
| any | baseline | `simulate.reset` / `simulate.new_scenario` (after teardown) |

The UI renders the phase as a progress rail so the current position in the incident is always
visible; `needs_review` renders as an explicit terminal state, not an error.

---

## 12. Scenario generator (`scenario.ts`)

Purpose: verify the system is computing, not replaying. `new_scenario` produces a
different-but-valid incident; `reset` replays the current seed identically.

**Seeded PRNG** (mulberry32 or equivalent) keyed by a short human-readable seed string
displayed in the UI (e.g., `SCN-4F7A`). `seed='hero'` bypasses generation and loads §6.

**Randomized within bounds (everything else fixed):**

| Parameter | Range |
|---|---|
| SEG-2 derated capacity | 780,000 – 860,000 (step 10,000) |
| CEMK / SABT IT nominations | 80,000 – 180,000 each (step 10,000) |
| Per-shipper flow deviation vs schedule | LSPP +8% to +18%; ABCL +4% to +10%; NTGU −3% to +3%; IT ±1% |
| Notice stage | Stage 2 (tol 5%, $25.00) or Stage 3 (tol 3%, $50.00) |

**Timing is fixed, not randomized:** every scenario uses incident time 16:15, baseline clock
16:00, six measured flow_hours, and the ID3 deadline at 19:00 (165 sim-minutes to act).
Variable incident timing would make the measured-hour count and the integer projection
multiplier conditional for no operational value; `params.incident_time_ct` remains in the
contract for forward compatibility but is constant in this phase.

**Validation gates — a generated scenario is discarded and regenerated unless all hold:**

1. Firm total ≤ derated capacity (firm proration is out of scope for generated scenarios —
   the generator never produces it; it remains an eval-set edge case per §15)
2. IT tier is genuinely constrained: at least one IT cut ≥ 5,000 Dth
3. At least one shipper in violation beyond tolerance after recut
4. At least one shipper inside tolerance (the discrimination check)
5. All expected outputs computed by the engines tie: allocations sum to derated capacity;
   exposure figures are exact integers of cents
6. Timing invariant holds: incident 16:15, baseline 16:00, six measured hours, ID3 at 19:00

### 12.1 `scenario_state.params` contract

```json
{
  "derated_capacity_dth": 820000,
  "incident_time_ct": "16:15",
  "notice": { "stage": "Stage 2", "tolerance_pct": 5.0, "penalty_rate_cents_dth": 2500 },
  "it_nominations_dth": { "CEMK": 150000, "SABT": 100000 },
  "flow_deviation_bps": { "LSPP": 1500, "ABCL": 700, "NTGU": -100, "CEMK": 0, "SABT": -140 }
}
```

Deviations are **integer basis points** (1500 = +15.00%), applied as
`projected = scheduled × (10000 + bps) ÷ 10000` in integer arithmetic — no floats anywhere in
generation.

The seed loader and `trip_compressor` read exclusively from this object. The hero seed stores
the §6 values here, so the hero path and generated paths share one code path — nothing about
the incident is hardcoded in `simulate`.

### 12.2 Baseline generation and `answer_key` contract

Generation order — the recut runs **before** flow derivation, so deviation bases are
unambiguous: (1) apply the drawn IT nominations to the fixed firm set; (2) run the allocation
engine at 900,000 to produce the Timely baseline and write those `scheduled_dth` rows;
(3) run the allocation engine at the derated capacity to obtain **post-recut** scheduled
quantities; (4) derive each shipper's projected daily takes in integer bps arithmetic — firm
shippers from their scheduled quantity (identical pre/post recut), IT shippers from their
**post-recut** scheduled quantity, matching the hero fixture — adjusted by ≤ 3 Dth so every
projected total is divisible by 4 (the ×4 projection stays integer); (5) seed six integer
measured hours summing to projected ÷ 4, using the fixed flow shapes; (6) run the imbalance
and exposure engines and write the results as the answer key:

```json
{
  "timely": { "proration_factor": "0.6800", "scheduled_dth": { "CEMK": 102000, "SABT": 68000 } },
  "recut":  { "proration_factor": "0.3600", "scheduled_dth": { "CEMK": 54000, "SABT": 36000 },
              "cuts_dth": { "CEMK": 48000, "SABT": 32000 } },
  "exposure_cents": { "LSPP": 62500000, "ABCL": 15000000, "NTGU": 0, "CEMK": 0, "SABT": 0 },
  "violators": ["LSPP", "ABCL"],
  "compliant": ["NTGU", "CEMK", "SABT"]
}
```

Every figure in the key is engine-computed — the model never invents scenario data — and
tests compare agent-cited figures against this key.

`tests/scenario.test.ts`: generate 25 seeds; assert every one passes gates 1–6 and its answer
key ties. These are engine-level tests with **no LLM calls**.

---

## 13. Implementation phases

**Phase 1 — Foundation (no model calls)**
1. Scaffold; apply `0001_schema.sql`, `0002_rls.sql`
2. `numeric.ts`; `0003_seed.sql` (hero). Verify: SEG-2 firm total 730,000; Timely allocation
   rows match §6.4
3. `engines.ts` complete; `tests/engines.test.ts` asserting §6.4 (0.68 → 102,000/68,000),
   §6.7 (0.36 → 54,000/36,000), §6.8 (25,000 → $625,000.00; 6,000 → $150,000.00; NTGU/CEMK/
   SABT zero)

**Gate: engine tests green before any agent code.**

**Phase 2 — Tool layer**
4. Three system modules + registry/dispatcher; exercise every handler directly
5. Confirm `is_downstream_of('RP-BETH','SEG-2')` returns true

**Phase 3 — Runtime, hero flow**
6. `anthropic.ts` (no sampling params), `events.ts` (seq + unique retry), `skills.ts`
7. `agent-run` with `waitUntil`, turn/wall-clock guards
8. Supervisor + Scheduling through `stage_allocation`
9. `approve-action` full state machine; verify `apply_allocation` mutates scheduled_dth and
   fires the continuation
10. Exception + Communications through both staged comms actions

**Gate: from `trip_compressor` via curl, the full chain reaches `comms_pending` with events
that read as a scheduler's working notes and every figure matching §6.**

**Phase 4 — Client**
11. Desk page: position table, segment bars, sim clock, phase rail
12. `events.ts` backlog+subscribe+dedupe; agent feed
13. Approval queue; verify approving the allocation visibly updates positions
14. Notice banner, audit drawer, simulation panel (skill library UI deferred — skills remain
    reviewable as files in the repo)

**Phase 5 — Hardening**
15. Full runs from `reset`; latency measurement against §16
16. Fallback capture: record one complete successful run (clearly labeled replay mode in the
    client, distinct from live mode)

**Phase 6 — Scenario generator (only after Phase 5 passes)**
17. `scenario.ts` + gates; `new_scenario` wiring; `tests/scenario.test.ts` (25 seeds,
    engine-level, no LLM calls)
18. **One** generated seed run live end-to-end as the randomized validation; additional live
    seed runs are optional hardening, not a gate

---

## 14. Reference workflow (hero seed)

1. **Baseline.** D 16:00. Positions show the Timely allocation; SEG-2 at 900,000; no
   exposure; ID3 open with 180 sim-minutes remaining.
2. **Incident.** `trip_compressor`. SCADA event at 16:15: Unit 2 down; SEG-2 operating
   capacity drops to 820,000 **immediately** — the segment bar goes red and oversubscribed
   the moment the trip lands, before any agent acts. Supervisor routes to Scheduling only.
3. **Recut staged.** Scheduling reports firm unchanged, IT prorated to 0.36, cuts of 48,000
   and 32,000, citation attached; stages `apply_allocation` and stops. Phase `recut_pending`.
4. **Approval 1.** Scheduler approves. Scheduled quantities update on screen; the segment bar
   returns to fully-subscribed at 820,000. The continuation run begins under the same
   `workflow_id`. Phase `recut_applied`.
5. **Assessment.** Exception projects all five shippers, finds LSPP $625,000.00 and ABCL
   $150,000.00 beyond tolerance, states NTGU requires no action, and states the operator's
   stake — uncured excess degrades line pack; next step would be an EFO.
6. **Comms staged.** Communications drafts the EBB notice and four shipper messages — LSPP's
   citing its own downstream storage as an available cure, ABCL's in plain English, cut
   notices to CEMK and SABT, nothing to NTGU. Phase `comms_pending`.
7. **Approval 2.** Scheduler approves both. Notice posts; messages marked delivered; phase
   `resolved`.
8. **Audit.** Any event opens the full ordered chain for the incident's `workflow_id` — both
   runs, SCADA trigger, every tool call and result, citations, approvers, timestamps —
   exportable as a dispute file.

---

## 15. Path to production

**Evaluation.** Golden set of 50 derate/compliance scenarios (generator seeds + hand-built
edge cases including firm proration) with engine-computed answer keys. Score tool selection,
numerical citation accuracy (exact match), playbook adherence, and communication constraints
(no messages to compliant shippers; no cure instructions). CI-gated: no prompt or skill change
merges without a green run.

**Observability.** Per-run tracing of latency and token cost per turn; alerts on turn-cap,
tool error, and escalation rates; a recommendation acceptance dashboard — the human rejection
rate is the trust metric governing autonomy expansion.

**Shadow mode.** Parallel operation against the live desk with no write access; daily
agreement-rate comparison by scenario class; autonomy earned per class, never globally.

**Integration.** Replace each simulated module with a real MCP integration (SCADA/historian,
EBB/EDI, operations SOR) — discovery, transport, authentication, and result adapters per
system — with contract tests so vendor API changes fail in CI. ETRM integration is added at
this stage for operator commercial functions, having been deliberately excluded from the
reference implementation.

**Governance.** SSO; role-based approval limits scaled to dollar impact; immutable audit
export; human accountability on every externally visible action; read-only telemetry access.

**Phased autonomy.** Assist (everything approved) → semi-autonomous (routine recuts within
bounds auto-apply; all external communications still approved) → exception-based supervision.
Promotion gated on shadow agreement and eval scores per scenario class.

---

## 16. End-to-end acceptance criteria

From `reset` on the hero seed, one operator at the desk must complete the live workflow in at most
**8 minutes** under reference deployment conditions:

1. `trip_compressor` → recut staged with correct §6.7 figures
2. Approve allocation → positions visibly update; continuation runs
3. Assessment completes with correct §6.8 figures; NTGU explicitly excluded
4. Comms staged; approve both → notice posted, messages delivered, phase `resolved`
5. Open the audit drawer on the exposure decision and show the full chain

Additional assertions before the build is done:
- 25 generated seeds pass the engine-level scenario tests; at least **one** generated seed
  completes the full flow live
- `execute_approval` called twice with the same id executes once — including across a
  simulated crash between the `executing` transition and completion (transaction rollback
  verified), and across a crash after commit but before the continuation is claimed
  (retrying the approval finds the `queued` run and claims it)
- Killing and reloading the client mid-run shows a complete, gapless feed spanning **both
  runs of the workflow**, correlated by `workflow_id`
- A clearly labeled replay mode can play back the captured run if live execution is
  unavailable

---

## 17. Non-goals and constraints

- No model-computed arithmetic; no floating-point volumes or money.
- Operator desk only: no code path transacts gas, moves shipper storage, or instructs a
  shipper's commercial decision.
- Gas only; no crude or refined products.
- No settlement or month-end allocation module; the operations SOR remains authoritative.
- No authentication this phase; single scheduler identity.
- No model-facing tool mutates schedules, capacities, or notice status.
- All data is synthetic; tariff citations are marked "(synthetic)" in the data itself.
- Intake and Confirmation agents are documented skills, not wired code, this phase.