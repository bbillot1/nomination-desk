const volumeFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const centralDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const centralTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDth(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : volumeFormatter.format(value);
}

export function formatMoneyCents(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : moneyFormatter.format(value / 100);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}%`;
}

export function formatCentralDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? "—"
    : `${centralDateTimeFormatter.format(instant)} CT`;
}

export function formatCentralTime(value: string | null | undefined): string {
  if (!value) return "—";
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "—" : `${centralTimeFormatter.format(instant)} CT`;
}

export function formatRelativeMinutes(minutes: number): string {
  if (minutes <= 0) return "deadline passed";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m remaining`;
  return `${hours}h ${remainder.toString().padStart(2, "0")}m remaining`;
}

export function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
