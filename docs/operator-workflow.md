# Operator Workflow

This reference workflow uses the synthetic canonical hero seed to verify deterministic arithmetic,
human approval boundaries, Realtime state updates, and append-only audit evidence.

## Preconditions

1. Confirm the desk header says `Supabase SOR` and the connection indicator is live.
2. Confirm the active seed is `hero` and the phase is `Baseline`.
3. Confirm SEG-2 is scheduled at its 900,000 Dth operating capacity.
4. Confirm no agent run is active and the approval queue is empty.
5. Keep the disconnected **Verified replay** available for provider-independent validation.

For time-sensitive validation, execute one nonproduction workflow in advance to warm provider
strict-tool schema compilation, verify it reaches `comms_pending`, and restore the canonical hero.

## 1. Establish the baseline

Verify:

- simulated clock at 16:00 CT
- ID3 as the open cycle with a 19:00 CT deadline
- five shipper positions
- SEG-2 fully subscribed at 900,000 Dth
- phase rail at `Baseline`

The browser is read-only. Operational changes can occur only through Edge Functions and the human
approval queue.

## 2. Inject physical reality

Select **Trip compressor**.

SEG-2 operating capacity must immediately fall to 820,000 Dth while the published schedule remains
900,000 Dth. The segment becomes oversubscribed before any agent action because physical telemetry
is authoritative and is not approval-gated.

## 3. Review the deterministic recut

The Supervisor and Scheduling events must produce:

- firm service unchanged at 730,000 Dth
- interruptible factor 0.3600
- CEMK scheduled at 54,000 Dth, cut 48,000 Dth
- SABT scheduled at 36,000 Dth, cut 32,000 Dth
- GT&C §12.6 (synthetic)

Before approval, the position table must retain the authoritative schedule and display the recut as
a pending proposal.

Approve the allocation. The CEMK and SABT schedules must then update, and SEG-2 must return to
820,000 / 820,000 Dth. This transition verifies that the model cannot write schedules directly.

## 4. Review compliance and communications

The approval continuation uses the same workflow ID and must report:

- LSPP: 25,000 Dth beyond tolerance and $625,000.00 projected exposure
- ABCL: 6,000 Dth beyond tolerance and $150,000.00 projected exposure
- NTGU, CEMK, and SABT as compliant
- $775,000.00 aggregate projected exposure per gas day
- line-pack degradation and potential EFO escalation if over-takes remain uncured

Communications then stages one public EBB notice and four affected-shipper messages. Neither action
is externally effective while pending.

## 5. Execute communication approvals

Review and approve the shipper-message action, followed by the EBB notice.

Verify:

- four messages delivered
- no message sent to NTGU
- EBB notice posted and effective upon posting
- phase `Resolved`

## 6. Inspect audit evidence

Open the exposure decision in the agent feed. Keep **Operator** view selected for the walkthrough;
switch to **Technical** only if a reviewer asks for raw tool payloads or provider detail.

The audit drawer must contain:

- both correlated runs under one workflow
- operator-readable evidence steps (tool noise collapsed; planning prose hidden)
- key capacity, allocation, compliance, and exposure facts above raw JSON
- tariff citations and loaded playbooks
- human decision records
- dispute-file export (unchanged raw event payload)

The complete chain demonstrates the operating model: agents route, investigate, and draft; engines
calculate; humans authorize; the operations SOR and append-only audit remain authoritative.

## Disconnected replay

When external providers or networks are unavailable:

1. Select **Play verified replay**.
2. Confirm the visible `Replay mode` banner.
3. Use Play, Pause, or frame controls to inspect the workflow.
4. Verify that approval controls remain disabled.

Replay performs no database writes and makes no model calls. Build the disconnected artifact with
`npm run build:replay`; it contains no Supabase project URL or publishable key.

## Recovery

- **Reset current** replays the active seed to its baseline.
- **Restore canonical hero** returns the system to the frozen §6 fixture after a generated scenario.
- Reset and scenario replacement are blocked while a run is active.
- Reloading during a workflow reconstructs the feed from the workflow backlog and Realtime inserts.
