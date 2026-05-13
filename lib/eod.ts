export interface EodState {
  enabled: boolean;
  time: string | null;
  lastFiredDate: string | null;
  snoozeUntil: string | null;
  hasOpenSession: boolean;
}

export type EodDecision = 'fire-primary' | 'fire-snooze' | 'skip-mark-fired' | 'skip';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToTodayDate(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

export function shouldFireEod(args: { now: Date; state: EodState }): EodDecision {
  const { now, state } = args;

  if (!state.enabled) return 'skip';
  if (!isWeekday(now)) return 'skip';
  if (!state.time || !TIME_RE.test(state.time)) return 'skip';

  if (state.snoozeUntil) {
    const snoozeDate = new Date(state.snoozeUntil);
    if (isNaN(snoozeDate.getTime())) return 'skip';
    if (now < snoozeDate) return 'skip';
    if (localDateString(snoozeDate) !== localDateString(now)) return 'skip';
    return state.hasOpenSession ? 'fire-snooze' : 'skip-mark-fired';
  }

  const today = localDateString(now);
  if (state.lastFiredDate === today) return 'skip';

  const fireAt = timeToTodayDate(now, state.time);
  if (now < fireAt) return 'skip';

  return state.hasOpenSession ? 'fire-primary' : 'skip-mark-fired';
}
