import { getCredential, setCredential } from './db.js';

export function resolveCredential(key: string): string | undefined {
  const dbValue = getCredential(key);
  if (dbValue) return dbValue;
  return process.env[key];
}

export function saveCredential(key: string, value: string) {
  setCredential(key, value);
}

export function isClockifyKeyValid(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

export function isClockifyDisabled(): boolean {
  return resolveCredential('CLOCKIFY_DISABLED') === '1';
}

export function setClockifyDisabled(disabled: boolean) {
  setCredential('CLOCKIFY_DISABLED', disabled ? '1' : '0');
}

export function isClockifyEnabled(): boolean {
  return isClockifyKeyValid(resolveCredential('CLOCKIFY_API_KEY')) && !isClockifyDisabled();
}
