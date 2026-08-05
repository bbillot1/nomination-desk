import type { SupabaseClient } from "@supabase/supabase-js";

import type { AgentName } from "./events.ts";

export interface SkillRecord {
  id: string;
  name: string;
  trigger_description: string;
  body_md: string;
  version: string;
  author: string | null;
}

const SPECIALIST_SKILLS: Partial<Record<AgentName, string[]>> = {
  scheduling: ["derate-response", "capacity-shortfall"],
  exception: ["derate-response"],
  communications: ["shipper-communication"],
};

export async function loadSpecialistSkills(
  client: SupabaseClient,
  specialist: AgentName,
): Promise<SkillRecord[]> {
  const ids = SPECIALIST_SKILLS[specialist] ?? [];
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from("skills")
    .select("id,name,trigger_description,body_md,version,author")
    .in("id", ids);
  if (error) throw new Error(`could not load specialist skills: ${error.message}`);

  const records = (data ?? []) as SkillRecord[];
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = ids.map((id) => {
    const skill = byId.get(id);
    if (!skill) throw new Error(`required skill is missing: ${id}`);
    if (!skill.body_md.trim() || !skill.version.trim()) {
      throw new Error(`required skill is invalid: ${id}`);
    }
    return skill;
  });
  return ordered;
}

export function renderSkills(skills: readonly SkillRecord[]): string {
  return skills.map((skill) =>
    `<skill name="${skill.name}" version="${skill.version}">\n${skill.body_md}\n</skill>`
  ).join("\n\n");
}

export function skillAuditLabel(skills: readonly SkillRecord[]): string {
  return skills.map((skill) => `${skill.id}@${skill.version}`).join(",");
}
