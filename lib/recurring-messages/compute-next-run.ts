/**
 * Timezone-aware "next run" calculator for recurring/programmed messages.
 *
 * Uses the Intl API (built into Node 18+) to:
 *  1. Get the "current time" expressed in the rule's timezone
 *  2. Build the next intended firing date in that timezone
 *  3. Convert it back to UTC for DB storage
 *
 * We avoid extra dependencies (no date-fns-tz) because we only need
 * minute-level precision and the operations are simple.
 */

type Rule = {
  scheduleType: 'once' | 'day_of_month' | 'every_n_days' | 'day_of_week';
  scheduleValue: number;
  sendHour?: number | null;
  sendMinute?: number | null;
  timezone?: string | null;
  runOnceAt?: Date | string | null;
};

/**
 * Returns the wall-clock parts (Y/M/D/h/m) of a given UTC date as observed in `tz`.
 */
function partsInTimezone(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (k: string) => parseInt(parts.find(p => p.type === k)?.value || '0', 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') === 24 ? 0 : get('hour'), // Intl can emit "24"
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Given wall-clock parts in a tz, returns the corresponding UTC Date.
 * Uses a 2-pass correction to account for DST/offset.
 */
function fromZonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  // First guess: treat the wall-clock as if it were UTC
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  // What does that UTC moment look like in tz?
  const p1 = partsInTimezone(new Date(utcGuess), tz);
  const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const seenUtc = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, 0);
  // Offset to apply (in ms)
  utcGuess = utcGuess + (wantedUtc - seenUtc);
  // Second pass to catch DST edge cases
  const p2 = partsInTimezone(new Date(utcGuess), tz);
  const seen2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, 0);
  utcGuess = utcGuess + (wantedUtc - seen2);
  return new Date(utcGuess);
}

export function computeNextRun(rule: Rule, from: Date = new Date()): Date | null {
  if (rule.scheduleType === 'once') {
    return rule.runOnceAt ? new Date(rule.runOnceAt) : from;
  }

  const tz = rule.timezone || 'UTC';
  const sendHour = Math.max(0, Math.min(23, rule.sendHour ?? 9));
  const sendMinute = Math.max(0, Math.min(59, rule.sendMinute ?? 0));

  // Current "wall clock" in the rule's tz
  const nowZ = partsInTimezone(from, tz);

  // Candidate today at sendHour:sendMinute in tz
  const buildAt = (y: number, m: number, d: number) => fromZonedTime(y, m, d, sendHour, sendMinute, tz);

  if (rule.scheduleType === 'day_of_month') {
    const targetDay = Math.min(Math.max(rule.scheduleValue, 1), 31);
    let y = nowZ.year;
    let m = nowZ.month;
    let candidate = buildAt(y, m, targetDay);
    if (candidate <= from) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      candidate = buildAt(y, m, targetDay);
    }
    return candidate;
  }

  if (rule.scheduleType === 'every_n_days') {
    const days = Math.max(rule.scheduleValue, 1);
    // First candidate: today at HH:MM in tz
    let candidate = buildAt(nowZ.year, nowZ.month, nowZ.day);
    while (candidate <= from) {
      // add N days in tz
      const c = partsInTimezone(candidate, tz);
      const next = buildAt(c.year, c.month, c.day);
      // Use UTC math: add N*86400000 ms then realign to HH:MM
      const tentative = new Date(next.getTime() + days * 86400000);
      const tp = partsInTimezone(tentative, tz);
      candidate = buildAt(tp.year, tp.month, tp.day);
    }
    return candidate;
  }

  if (rule.scheduleType === 'day_of_week') {
    // 1=Mon..7=Sun in our domain. JS getUTCDay-like in TZ: derive via Date
    const targetWd = rule.scheduleValue === 7 ? 7 : rule.scheduleValue; // keep as 1..7
    // Compute current weekday in tz: Sun=0..Sat=6 from a Date created at noon UTC of the tz-day
    const probe = new Date(Date.UTC(nowZ.year, nowZ.month - 1, nowZ.day, 12, 0, 0));
    const probeParts = partsInTimezone(probe, tz);
    const jsDay = new Date(Date.UTC(probeParts.year, probeParts.month - 1, probeParts.day)).getUTCDay(); // 0=Sun..6=Sat
    const currentWd = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
    let diff = targetWd - currentWd;
    let candidate = buildAt(nowZ.year, nowZ.month, nowZ.day);
    if (diff < 0 || (diff === 0 && candidate <= from)) diff += 7;
    if (diff > 0) {
      const tentative = new Date(candidate.getTime() + diff * 86400000);
      const tp = partsInTimezone(tentative, tz);
      candidate = buildAt(tp.year, tp.month, tp.day);
    }
    return candidate;
  }

  return null;
}
