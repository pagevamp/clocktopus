import { getSetting, setSetting, deleteSetting } from './db.js';
import type { EodState } from './eod.js';

const KEY = {
  enabled: 'eodReminderEnabled',
  time: 'eodReminderTime',
  lastFiredDate: 'eodLastFiredDate',
  snoozeUntil: 'eodSnoozeUntil',
  hookIgnoreBranches: 'hookIgnoreBranches',
  updatesAutoCheck: 'updatesAutoCheck',
  updatesNotify: 'updatesNotify',
} as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface EodSettingsForUi {
  enabled: boolean;
  time: string | null;
}

export function getEodSettings(): EodSettingsForUi {
  const enabled = getSetting(KEY.enabled) === 'true';
  const rawTime = getSetting(KEY.time);
  const time = rawTime && TIME_RE.test(rawTime) ? rawTime : null;
  return { enabled, time };
}

export function setEodSettings(input: { enabled: boolean; time: string }) {
  if (!TIME_RE.test(input.time)) {
    throw new Error(`Invalid time: ${input.time}`);
  }
  setSetting(KEY.enabled, input.enabled ? 'true' : 'false');
  setSetting(KEY.time, input.time);
}

export function readEodState(hasOpenSession: boolean): EodState {
  const ui = getEodSettings();
  return {
    enabled: ui.enabled,
    time: ui.time,
    lastFiredDate: getSetting(KEY.lastFiredDate),
    snoozeUntil: getSetting(KEY.snoozeUntil),
    hasOpenSession,
  };
}

export function markEodFired(localDate: string) {
  setSetting(KEY.lastFiredDate, localDate);
  deleteSetting(KEY.snoozeUntil);
}

export function setEodSnoozeUntil(iso: string) {
  setSetting(KEY.snoozeUntil, iso);
}

export function clearEodSnoozeUntil() {
  deleteSetting(KEY.snoozeUntil);
}

export function getHookIgnoreBranches(): string[] {
  const raw = getSetting(KEY.hookIgnoreBranches);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is string => typeof b === 'string' && b.length > 0);
  } catch {
    return [];
  }
}

export function setHookIgnoreBranches(branches: string[]) {
  const cleaned = Array.from(new Set(branches.map((b) => b.trim()).filter((b) => b.length > 0)));
  setSetting(KEY.hookIgnoreBranches, JSON.stringify(cleaned));
}

export interface UpdateSettings {
  autoCheck: boolean;
  notify: boolean;
}

export function getUpdateSettings(): UpdateSettings {
  const autoRaw = getSetting(KEY.updatesAutoCheck);
  const notifyRaw = getSetting(KEY.updatesNotify);
  return {
    autoCheck: autoRaw === null ? true : autoRaw === 'true',
    notify: notifyRaw === null ? true : notifyRaw === 'true',
  };
}

export function setUpdateSettings(input: UpdateSettings) {
  setSetting(KEY.updatesAutoCheck, input.autoCheck ? 'true' : 'false');
  setSetting(KEY.updatesNotify, input.notify ? 'true' : 'false');
}
