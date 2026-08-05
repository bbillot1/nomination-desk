import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve("dist");
const forbidden = [
  { label: "Supabase project URL", pattern: /https:\/\/[a-z0-9]{20}\.supabase\.co/i },
  { label: "publishable key", pattern: /sb_publishable_/ },
  { label: "secret key", pattern: /sb_secret_/ },
  { label: "service-role identifier", pattern: /SUPABASE_SERVICE/ },
  { label: "Anthropic secret name", pattern: /ANTHROPIC_API_KEY/ },
] as const;

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    if ((await stat(path)).isDirectory()) files.push(...await filesBelow(path));
    else files.push(path);
  }
  return files;
}

const violations: Array<{ file: string; label: string }> = [];
for (const file of await filesBelow(dist)) {
  const contents = await readFile(file, "utf8");
  for (const item of forbidden) {
    if (item.pattern.test(contents)) {
      violations.push({
        file: file.slice(dist.length + 1),
        label: item.label,
      });
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`Replay build contains ${violation.label} in ${violation.file}`);
  }
  process.exit(1);
}

console.log("Replay build is disconnected from Supabase and contains no secret identifiers.");
