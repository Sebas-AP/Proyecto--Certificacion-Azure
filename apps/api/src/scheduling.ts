import { pool } from './db.js';

const DAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type BranchNow = { day: number; minutes: number };

export function branchNow(timezone: string, at: Date = new Date()): BranchNow {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const weekday = parts.find(part => part.type === 'weekday')?.value ?? 'Mon';
  let hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  if (hour === 24) hour = 0;
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  return { day: DAY_MAP[weekday] ?? 1, minutes: hour * 60 + minute };
}

export function isWithinWindow(now: BranchNow, day: number, from: string, to: string): boolean {
  if (now.day !== day) return false;
  const [fromHours, fromMinutes] = from.split(':').map(Number);
  const [toHours, toMinutes] = to.split(':').map(Number);
  const fromMin = fromHours * 60 + fromMinutes;
  const toMin = toHours * 60 + toMinutes;
  return now.minutes >= fromMin && now.minutes < toMin;
}

export function isOpenAt(hours: { day_of_week: number; time_from: string; time_to: string }[], timezone: string, at: Date = new Date()): boolean {
  if (!hours.length) return true;
  const now = branchNow(timezone, at);
  return hours.some(row => isWithinWindow(now, row.day_of_week, row.time_from, row.time_to));
}

export async function branchOpenNow(branchId: string, at: Date = new Date()): Promise<{ openNow: boolean; timezone: string; hours: { day_of_week: number; time_from: string; time_to: string }[] }> {
  const branch = await pool.query('SELECT timezone FROM branches WHERE id = $1', [branchId]);
  const timezone = branch.rows[0]?.timezone ?? 'America/Mexico_City';
  const hours = await pool.query('SELECT day_of_week, time_from::text, time_to::text FROM branch_business_hours WHERE branch_id = $1 ORDER BY day_of_week', [branchId]);
  return { openNow: isOpenAt(hours.rows, timezone, at), timezone, hours: hours.rows };
}

export async function productAvailableNow(branchId: string, productId: string, at: Date = new Date()): Promise<{ available: boolean; openNow: boolean; windows: { day_of_week: number; time_from: string; time_to: string }[] }> {
  const { openNow, timezone } = await branchOpenNow(branchId, at);
  const windows = await pool.query(
    `SELECT ph.day_of_week, ph.time_from::text, ph.time_to::text
     FROM branch_product_hours ph
     WHERE ph.branch_id = $1 AND ph.product_id = $2
     ORDER BY ph.day_of_week, ph.time_from`,
    [branchId, productId],
  );
  const flag = await pool.query('SELECT is_available FROM branch_product_availability WHERE branch_id = $1 AND product_id = $2', [branchId, productId]);
  const flagEnabled = flag.rows[0] ? flag.rows[0].is_available : true;
  const now = branchNow(timezone, at);
  const inWindow = windows.rows.length === 0 || windows.rows.some(row => isWithinWindow(now, row.day_of_week, row.time_from, row.time_to));
  return { available: flagEnabled && openNow && inWindow, openNow, windows: windows.rows };
}