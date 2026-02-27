import { getCredential, setCredential } from './db.js';

export function resolveCredential(key: string): string | undefined {
  const dbValue = getCredential(key);
  if (dbValue) return dbValue;
  return process.env[key];
}

export function saveCredential(key: string, value: string) {
  setCredential(key, value);
}
