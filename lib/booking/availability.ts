/**
 * Booking availability helpers — all date math respects the business timezone.
 * Slot logic: split the working hours of a given date into N-minute slots
 * (matching service duration), and remove slots colliding with existing
 * appointments (status not in cancelled/no_show).
 */

import { db } from '@/lib/db/drizzle';
import { businessHours, appointments } from '@/lib/db/schema';
import { eq, and, gte, lt, ne, or, inArray } from 'drizzle-orm';

export type WeeklyHour = {
  weekday: number; openTime: string; closeTime: string; isClosed: boolean | null;
};

/** Convert a YYYY-MM-DD + HH:MM in a given IANA tz to a UTC Date. */
export function zonedDateToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  // First guess assuming the wall clock is UTC
  let utc = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Iterate twice to correct DST/offset
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(utc));
    const get = (k: string) => parseInt(parts.find(p => p.type === k)?.value || '0', 10);
    const seen = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), 0);
    utc += Date.UTC(y, m - 1, d, hh, mm, 0) - seen;
  }
  return new Date(utc);
}

/** Returns the weekday (0=Sun..6=Sat) for YYYY-MM-DD in a tz. */
export function weekdayInTz(dateStr: string, tz: string): number {
  const noonUtc = zonedDateToUtc(dateStr, '12:00', tz);
  const dayInTz = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(noonUtc);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayInTz] ?? 0;
}

/** "HH:MM" -> minutes from midnight */
function toMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** minutes from midnight -> "HH:MM" */
function toHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function getAvailableSlots(opts: {
  businessId: number;
  tz: string;
  dateStr: string; // YYYY-MM-DD in business tz
  durationMin: number;
  noticeMinutes?: number;
}): Promise<string[]> {
  const { businessId, tz, dateStr, durationMin } = opts;
  const noticeMin = opts.noticeMinutes ?? 60;

  const wd = weekdayInTz(dateStr, tz);
  const hours = await db.select().from(businessHours).where(and(eq(businessHours.businessId, businessId), eq(businessHours.weekday, wd)));
  if (!hours.length || hours[0].isClosed) return [];

  const open = toMin(hours[0].openTime);
  const close = toMin(hours[0].closeTime);
  if (close <= open) return [];

  // Existing appointments for that day
  const dayStartUtc = zonedDateToUtc(dateStr, '00:00', tz);
  const nextDate = new Date(dayStartUtc.getTime() + 24 * 3600 * 1000);
  const existing = await db.select().from(appointments).where(
    and(
      eq(appointments.businessId, businessId),
      gte(appointments.startAt, dayStartUtc),
      lt(appointments.startAt, nextDate),
      // Exclude cancelled & no_show
      or(eq(appointments.status, 'confirmed'), eq(appointments.status, 'completed'), eq(appointments.status, 'checked_in'))
    )
  );

  const taken = existing.map(a => ({
    startMin: getMinutesInTz(a.startAt, tz),
    endMin: getMinutesInTz(a.endAt, tz),
  }));

  const now = new Date();
  const nowMinInTz = isSameDayInTz(now, dateStr, tz) ? getMinutesInTz(now, tz) + noticeMin : -Infinity;

  // 15-min step
  const STEP = 15;
  const slots: string[] = [];
  for (let m = open; m + durationMin <= close; m += STEP) {
    const slotStart = m;
    const slotEnd = m + durationMin;
    if (slotEnd > close) break;
    if (slotStart < nowMinInTz) continue;
    const collides = taken.some(t => !(slotEnd <= t.startMin || slotStart >= t.endMin));
    if (!collides) slots.push(toHm(slotStart));
  }
  return slots;
}

function getMinutesInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return (h === 24 ? 0 : h) * 60 + m;
}

function isSameDayInTz(d: Date, dateStr: string, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d) === dateStr;
}
