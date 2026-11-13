/** Calendar helpers. Months are keyed "YYYY-MM"; all dates are UTC ISO "YYYY-MM-DD". */

/** The demo's "today": every portfolio metric is as of this month-end. */
export const AS_OF = "2026-10-31";
export const AS_OF_MONTH = "2026-10";

export function monthKey(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(key: string): [number, number] {
  const [y, m] = key.split("-").map(Number);
  return [y, m];
}

export function addMonths(key: string, n: number): string {
  const [y, m] = parseMonth(key);
  return monthKey(y, m + n);
}

export function monthDiff(from: string, to: string): number {
  const [y1, m1] = parseMonth(from);
  const [y2, m2] = parseMonth(to);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function daysInMonth(key: string): number {
  const [y, m] = parseMonth(key);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isoDate(key: string, day: number): string {
  return `${key}-${String(day).padStart(2, "0")}`;
}

/** 0 = Sunday */
export function weekday(key: string, day: number): number {
  const [y, m] = parseMonth(key);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

export function monthLabel(key: string): string {
  const [y, m] = parseMonth(key);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; monthDiff(k, to) >= 0; k = addMonths(k, 1)) out.push(k);
  return out;
}
