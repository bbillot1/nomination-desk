import {
  formatDth,
  formatUsd,
  sumExact,
} from "../numeric.ts";
import {
  asJson,
  requiredActionContext,
  requiredArray,
  requiredIdentifier,
  requiredInteger,
  requiredObject,
  requiredString,
  ToolFailure,
  type JsonValue,
  type NoticeDraft,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
} from "./types.ts";

function allocationRows(value: unknown): JsonValue[] {
  return requiredArray({ allocations: value }, "allocations").map((entry, index) => {
    const row = requiredObject(entry, `allocations[${index}]`);
    const cutReason = row.cut_reason;
    if (cutReason !== null && typeof cutReason !== "string") {
      throw new ToolFailure("INVALID_INPUT", `allocations[${index}].cut_reason is invalid`);
    }
    return {
      nomination_id: requiredIdentifier(row, "nomination_id"),
      scheduled_dth: requiredInteger(row, "scheduled_dth"),
      cut_dth: requiredInteger(row, "cut_dth"),
      cut_reason: cutReason,
    };
  });
}

interface ScenarioExpectations {
  deratedCapacityDth: number;
  stage: string;
  tolerancePct: number;
  penaltyRateCentsDth: number;
  prorationFactor: string;
  scheduledDth: Record<string, number>;
  cutsDth: Record<string, number>;
  exposureCents: Record<string, number>;
  violators: string[];
  affectedShippers: string[];
  aggregateExposureCents: number;
}

async function loadScenarioExpectations(context: ToolContext): Promise<ScenarioExpectations> {
  const rows = await context.db.select<{ params: unknown; answer_key: unknown }>({
    table: "scenario_state",
    columns: "params,answer_key",
    filters: [{ op: "eq", column: "id", value: 1 }],
    limit: 1,
  });
  const row = rows[0];
  if (!row) throw new ToolFailure("SCENARIO_NOT_FOUND", "active scenario is missing");

  const params = requiredObject(row.params, "scenario params");
  const notice = requiredObject(params.notice, "scenario notice");
  const answerKey = requiredObject(row.answer_key, "scenario answer key");
  const recut = requiredObject(answerKey.recut, "scenario recut answer");
  const scheduled = requiredObject(recut.scheduled_dth, "scenario recut schedules");
  const cuts = requiredObject(recut.cuts_dth, "scenario recut cuts");
  const exposure = requiredObject(answerKey.exposure_cents, "scenario exposure answer");
  const violators = requiredArray(answerKey, "violators").map((value, index) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
      throw new ToolFailure("INVALID_SCENARIO", `violators[${index}] is invalid`);
    }
    return value;
  });
  const scheduledDth: Record<string, number> = {
    LSPP: 250_000,
    ABCL: 300_000,
    NTGU: 180_000,
  };
  const cutsDth: Record<string, number> = {
    LSPP: 0,
    ABCL: 0,
    NTGU: 0,
  };
  const exposureCents: Record<string, number> = {};
  for (const shipperId of ["LSPP", "ABCL", "NTGU", "CEMK", "SABT"]) {
    exposureCents[shipperId] = requiredInteger(exposure, shipperId);
  }
  for (const shipperId of ["CEMK", "SABT"]) {
    scheduledDth[shipperId] = requiredInteger(scheduled, shipperId);
    cutsDth[shipperId] = requiredInteger(cuts, shipperId);
  }
  const cutShippers = Object.entries(cutsDth)
    .filter(([, cut]) => cut > 0)
    .map(([shipperId]) => shipperId);
  const affectedShippers = [...new Set([...violators, ...cutShippers])].sort();

  return {
    deratedCapacityDth: requiredInteger(params, "derated_capacity_dth"),
    stage: requiredString(notice, "stage"),
    tolerancePct: requiredInteger(notice, "tolerance_pct"),
    penaltyRateCentsDth: requiredInteger(notice, "penalty_rate_cents_dth"),
    prorationFactor: requiredString(recut, "proration_factor"),
    scheduledDth,
    cutsDth,
    exposureCents,
    violators,
    affectedShippers,
    aggregateExposureCents: sumExact(Object.values(exposureCents)),
  };
}

const stageAllocation: ToolHandler = async (input, context) => {
  const action = requiredActionContext(context);
  const segmentId = requiredIdentifier(input, "segment_id");
  const deratedCapacity = requiredInteger(input, "derated_capacity_dth");
  const allocations = allocationRows(input.allocations);
  if (allocations.length === 0) {
    throw new ToolFailure("INVALID_INPUT", "allocations cannot be empty");
  }
  const factor = requiredString(input, "proration_factor_str");
  const citation = requiredString(input, "citation");
  const expected = await loadScenarioExpectations(context);
  if (deratedCapacity !== expected.deratedCapacityDth || factor !== expected.prorationFactor) {
    throw new ToolFailure(
      "ALLOCATION_MISMATCH",
      "staged allocation does not match the active scenario answer key",
    );
  }
  const allocationShippers = new Set<string>();
  for (const [index, value] of allocations.entries()) {
    const row = requiredObject(value, `allocations[${index}]`);
    const nominationId = requiredIdentifier(row, "nomination_id");
    const shipperId = ["LSPP", "ABCL", "NTGU", "CEMK", "SABT"].find((candidate) =>
      nominationId.endsWith(candidate)
    );
    if (!shipperId) {
      throw new ToolFailure("ALLOCATION_MISMATCH", `unknown nomination ${nominationId}`);
    }
    allocationShippers.add(shipperId);
    if (
      requiredInteger(row, "scheduled_dth") !== expected.scheduledDth[shipperId] ||
      requiredInteger(row, "cut_dth") !== expected.cutsDth[shipperId]
    ) {
      throw new ToolFailure(
        "ALLOCATION_MISMATCH",
        `${shipperId} allocation does not match the active scenario answer key`,
      );
    }
  }
  for (const [shipperId, cutDth] of Object.entries(expected.cutsDth)) {
    if (cutDth > 0 && !allocationShippers.has(shipperId)) {
      throw new ToolFailure(
        "ALLOCATION_MISMATCH",
        `${shipperId} cut is missing from the staged allocation`,
      );
    }
  }
  const payload = asJson({
    segment_id: segmentId,
    derated_capacity_dth: deratedCapacity,
    allocations,
    proration_factor_str: factor,
    citation,
  });
  const staged = await action.actions.stage(action.runId, {
    action_type: "apply_allocation",
    title: `Apply ${segmentId} derate allocation`,
    rationale:
      `Apply tariff-priority recut at ${deratedCapacity.toLocaleString("en-US")} Dth using factor ${factor} (${citation}).`,
    payload,
  });
  return { ok: true, data: asJson({ ...staged, status: "pending", payload }), citation };
};

const draftEbbNotice: ToolHandler = async (input, context) => {
  const action = requiredActionContext(context);
  const noticeId = crypto.randomUUID();
  const noticeType = requiredString(input, "notice_type");
  if (!["ofo", "efo", "capacity_constraint", "maintenance"].includes(noticeType)) {
    throw new ToolFailure("INVALID_INPUT", "notice_type is invalid");
  }
  const notice: NoticeDraft = {
    id: noticeId,
    pipeline_id: requiredIdentifier(input, "pipeline_id"),
    notice_type: noticeType as NoticeDraft["notice_type"],
    headline: requiredString(input, "headline"),
    body_text: requiredString(input, "body_text"),
    stage: requiredString(input, "stage"),
    tolerance_pct: requiredInteger(input, "tolerance_pct"),
    penalty_rate_cents_dth: requiredInteger(input, "penalty_rate_cents_dth"),
    affected_segment: requiredIdentifier(input, "affected_segment"),
    derate_to_dth: requiredInteger(input, "derate_to_dth"),
  };
  const expected = await loadScenarioExpectations(context);
  if (
    notice.stage !== expected.stage ||
    notice.tolerance_pct !== expected.tolerancePct ||
    notice.penalty_rate_cents_dth !== expected.penaltyRateCentsDth ||
    notice.derate_to_dth !== expected.deratedCapacityDth
  ) {
    throw new ToolFailure(
      "NOTICE_TERMS_MISMATCH",
      "draft notice terms do not match the active scenario",
    );
  }
  if (notice.stage?.startsWith("Stage ") && notice.notice_type !== "ofo") {
    throw new ToolFailure("INVALID_NOTICE_TYPE", "a staged flow order must use notice_type ofo");
  }
  const rationale = requiredString(input, "rationale");
  const noticeBody = notice.body_text.toLowerCase();
  if (
    noticeBody.includes("line-pack headroom") ||
    noticeBody.includes("line pack headroom") ||
    noticeBody.includes("currently in effect") ||
    noticeBody.includes("flow order in effect")
  ) {
    throw new ToolFailure(
      "INVALID_NOTICE_LANGUAGE",
      "draft notice must not claim line-pack headroom or that an unposted order is in effect",
    );
  }
  if (!noticeBody.includes("effective upon posting") || !notice.body_text.includes("19:00 CT")) {
    throw new ToolFailure(
      "INVALID_NOTICE_LANGUAGE",
      "draft notice must state effective upon posting and the exact 19:00 CT deadline",
    );
  }
  if (
    ["Lone Star", "Abilene Compute", "Cardinal", "Sabine", "North Texas Gas"]
      .some((name) => notice.body_text.includes(name))
  ) {
    throw new ToolFailure("PUBLIC_NOTICE_PRIVACY", "public notice contains a shipper name");
  }
  const staged = await action.actions.stageNotice(action.runId, notice, {
    title: `Post ${notice.stage} EBB notice`,
    rationale,
  });
  return {
    ok: true,
    data: asJson({ ...staged, status: "pending", effective: "upon approval and posting" }),
  };
};

interface StagedRecipient {
  shipper_id: string;
  subject: string;
  body: string;
  evidence_refs: string[];
}

function recipientRows(value: unknown): StagedRecipient[] {
  return requiredArray({ recipients: value }, "recipients").map((entry, index) => {
    const row = requiredObject(entry, `recipients[${index}]`);
    const evidence = requiredArray(row, "evidence_refs");
    if (!evidence.every((item) => typeof item === "string" && item.trim() !== "")) {
      throw new ToolFailure(
        "INVALID_INPUT",
        `recipients[${index}].evidence_refs must contain non-empty strings`,
      );
    }
    return {
      shipper_id: requiredIdentifier(row, "shipper_id"),
      subject: requiredString(row, "subject"),
      body: requiredString(row, "body"),
      evidence_refs: evidence as string[],
    };
  });
}

const draftShipperMessage: ToolHandler = async (input, context) => {
  const action = requiredActionContext(context);
  const recipients = recipientRows(input.recipients);
  if (recipients.length === 0) {
    throw new ToolFailure("INVALID_INPUT", "recipients cannot be empty");
  }
  const expected = await loadScenarioExpectations(context);
  const unexpected = recipients.find((row) =>
    !expected.affectedShippers.includes(row.shipper_id)
  );
  if (unexpected) {
    throw new ToolFailure(
      "COMPLIANT_SHIPPER_MESSAGE_BLOCKED",
      `${unexpected.shipper_id} is neither in violation nor cut in the active scenario`,
    );
  }
  const byShipper = new Map(recipients.map((recipient) => [recipient.shipper_id, recipient]));
  if (
    recipients.length !== expected.affectedShippers.length ||
    expected.affectedShippers.some((shipper) => !byShipper.has(shipper))
  ) {
    throw new ToolFailure(
      "INCOMPLETE_RECIPIENT_SET",
      `messages must include exactly the active affected shippers: ${
        expected.affectedShippers.join(", ")
      }`,
    );
  }
  const requireEvidence = (shipper: string, fragments: string[]) => {
    const body = byShipper.get(shipper)?.body ?? "";
    if (fragments.some((fragment) => !body.toLowerCase().includes(fragment.toLowerCase()))) {
      throw new ToolFailure(
        "INCOMPLETE_MESSAGE_EVIDENCE",
        `${shipper} message is missing required verified evidence`,
      );
    }
  };
  for (const shipperId of expected.violators) {
    requireEvidence(shipperId, [formatUsd(expected.exposureCents[shipperId] ?? 0)]);
    if (shipperId === "LSPP") requireEvidence(shipperId, ["RP-BETH"]);
    if (shipperId === "ABCL") requireEvidence(shipperId, ["reduc", "downstream"]);
  }
  for (const [shipperId, cutDth] of Object.entries(expected.cutsDth)) {
    if (cutDth <= 0) continue;
    requireEvidence(shipperId, [
      formatDth(cutDth),
      formatDth(expected.scheduledDth[shipperId] ?? 0),
      expected.prorationFactor,
      "§12.6",
    ]);
  }
  const dollarImpact = requiredInteger(input, "dollar_impact_cents");
  if (dollarImpact !== expected.aggregateExposureCents) {
    throw new ToolFailure(
      "INVALID_DOLLAR_IMPACT",
      `aggregate projected exposure must be exactly ${expected.aggregateExposureCents} cents`,
    );
  }
  const payload = asJson({ recipients });
  const staged = await action.actions.stage(action.runId, {
    action_type: "send_shipper_message",
    title: `Send ${recipients.length} affected-shipper messages`,
    rationale: requiredString(input, "rationale"),
    payload,
    dollar_impact_cents: dollarImpact,
  });
  return { ok: true, data: asJson({ ...staged, status: "pending", recipient_count: recipients.length }) };
};

const escalateToHuman: ToolHandler = async (input, context) => {
  const action = requiredActionContext(context);
  const options = requiredArray(input, "options");
  if (options.length === 0) throw new ToolFailure("INVALID_INPUT", "options cannot be empty");
  const payload = asJson({
    options,
    context: requiredObject(input.context, "context"),
  });
  const staged = await action.actions.stage(action.runId, {
    action_type: "acknowledge_escalation",
    title: requiredString(input, "title"),
    rationale: requiredString(input, "rationale"),
    payload,
  });
  return { ok: true, data: asJson({ ...staged, status: "pending", escalation: true }) };
};

const string = { type: "string" };
const integer = { type: "integer" };
const allocationSchema = {
  type: "object",
  properties: {
    nomination_id: string,
    scheduled_dth: integer,
    cut_dth: integer,
    cut_reason: { type: ["string", "null"] },
  },
  required: ["nomination_id", "scheduled_dth", "cut_dth", "cut_reason"],
  additionalProperties: false,
};
const recipientSchema = {
  type: "object",
  properties: {
    shipper_id: string,
    subject: string,
    body: string,
    evidence_refs: { type: "array", items: string },
  },
  required: ["shipper_id", "subject", "body", "evidence_refs"],
  additionalProperties: false,
};

export const definitions: ToolDefinition[] = [
  {
    name: "stage_allocation",
    description:
      "Stage a complete deterministic allocation as a pending human action. Never applies schedules.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        segment_id: string,
        derated_capacity_dth: integer,
        allocations: { type: "array", items: allocationSchema },
        proration_factor_str: string,
        citation: string,
      },
      required: [
        "segment_id",
        "derated_capacity_dth",
        "allocations",
        "proration_factor_str",
        "citation",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "draft_ebb_notice",
    description:
      "Create a draft EBB notice and pending post action atomically. The notice is not posted.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: string,
        notice_type: { type: "string", enum: ["ofo", "efo", "capacity_constraint", "maintenance"] },
        headline: string,
        body_text: string,
        stage: string,
        tolerance_pct: integer,
        penalty_rate_cents_dth: integer,
        affected_segment: string,
        derate_to_dth: integer,
        rationale: string,
      },
      required: [
        "pipeline_id",
        "notice_type",
        "headline",
        "body_text",
        "stage",
        "tolerance_pct",
        "penalty_rate_cents_dth",
        "affected_segment",
        "derate_to_dth",
        "rationale",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "draft_shipper_message",
    description:
      "Stage one batched pending action containing messages only for affected shippers.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        recipients: { type: "array", items: recipientSchema },
        rationale: string,
        dollar_impact_cents: integer,
      },
      required: ["recipients", "rationale", "dollar_impact_cents"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description: "Stage a stop-the-line escalation with options and trade-offs.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        title: string,
        rationale: string,
        options: {
          type: "array",
          items: {
            type: "object",
            properties: { label: string, description: string },
            required: ["label", "description"],
            additionalProperties: false,
          },
        },
        context: {
          type: "object",
          properties: { summary: string, segment_id: string },
          required: ["summary", "segment_id"],
          additionalProperties: false,
        },
      },
      required: ["title", "rationale", "options", "context"],
      additionalProperties: false,
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  stage_allocation: stageAllocation,
  draft_ebb_notice: draftEbbNotice,
  draft_shipper_message: draftShipperMessage,
  escalate_to_human: escalateToHuman,
};
