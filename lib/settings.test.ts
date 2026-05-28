import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

const TMP = path.join(import.meta.dir, '__tmp_settings_test__');

// Isolate this test's DB from the project's real data/db. Must be set BEFORE
// any module that imports lib/db.ts loads, since db.ts resolves DB_DIR at
// import time. Dynamic imports below preserve that ordering.
process.env.CLOCKTOPUS_DATA_DIR = TMP;

let getUpdateSettings: typeof import('./settings.js').getUpdateSettings;
let setUpdateSettings: typeof import('./settings.js').setUpdateSettings;
let deleteSetting: typeof import('./db.js').deleteSetting;

beforeAll(async () => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const settings = await import('./settings.js');
  const db = await import('./db.js');
  getUpdateSettings = settings.getUpdateSettings;
  setUpdateSettings = settings.setUpdateSettings;
  deleteSetting = db.deleteSetting;
});

describe('update settings', () => {
  beforeEach(() => {
    deleteSetting('updatesAutoCheck');
    deleteSetting('updatesNotify');
  });

  it('returns defaults when nothing stored', () => {
    expect(getUpdateSettings()).toEqual({ autoCheck: true, notify: true });
  });

  it('round-trips written values', () => {
    setUpdateSettings({ autoCheck: false, notify: true });
    expect(getUpdateSettings()).toEqual({ autoCheck: false, notify: true });
  });

  it('round-trips the inverse combination', () => {
    setUpdateSettings({ autoCheck: true, notify: false });
    expect(getUpdateSettings()).toEqual({ autoCheck: true, notify: false });
  });

  it('returns defaults after stored values are cleared', () => {
    setUpdateSettings({ autoCheck: false, notify: false });
    deleteSetting('updatesAutoCheck');
    deleteSetting('updatesNotify');
    expect(getUpdateSettings()).toEqual({ autoCheck: true, notify: true });
  });
});
