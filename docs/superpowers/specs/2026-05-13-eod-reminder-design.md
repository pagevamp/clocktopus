# End-of-Day Timer Reminder

## Problem

Users sometimes forget to stop the Clockify timer at the end of the workday, causing inflated time entries that must be corrected later. Idle detection covers walk-away cases but not the situation where the user keeps working past their intended stop time.

## Goal

Add an opt-in setting for an end-of-day (EOD) time. At that time on weekdays, if a timer is running, show a desktop notification asking the user to stop the timer.

## Non-goals

- Auto-stopping without user consent.
- Per-day-of-week scheduling (Mon–Fri hardcoded for v1).
- Weekend reminders.
- Multiple reminders per day beyond a single 15-minute snooze.
- Headless / non-GUI environments (relies on `node-notifier`, same as idle prompt).

## Requirements

1. User can set an EOD time (HH:mm, 24h) and toggle the feature on/off in the dashboard.
2. Feature is disabled by default.
3. On weekdays (Mon–Fri) at or after the configured time, if a timer is running, fire one desktop notification with **Stop** and **Snooze 15m** actions.
4. **Stop** → call existing `stopTimerAndLog` flow (Clockify + Jira + local DB).
5. **Snooze 15m** → re-fire notification 15 minutes later, with **Stop** action only (no further snooze).
6. Dismiss / ignore → no further popups that day.
7. If the monitor daemon is not running at EOD time, no popup is shown. Idle popup on next wake covers the forgotten-timer case.
8. If no timer is running at EOD, do nothing (skip silently).

## Architecture

### Components

| Component                      | Type             | Purpose                                                                                                   |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `settings` table               | new SQLite table | key/value store for app settings, starting with EOD fields                                                |
| `lib/settings.ts`              | new module       | `getEodSettings()`, `setEodSettings()`, `markEodFired()`, `setSnoozeUntil()`                              |
| `lib/notifier.ts`              | new module       | Shared wrapper over `node-notifier` (`NotificationCenter`). Replaces inline notifier in `Clockify` class. |
| `lib/eod.ts`                   | new module       | Pure logic: `shouldFireEod(input) → Decision`. Easy to unit test.                                         |
| `index.ts` (`monitor:run`)     | edited           | New `setInterval(60_000)` calls `shouldFireEod` and triggers notification + actions                       |
| `dashboard/routes/settings.ts` | new route        | GET/POST `/api/settings/eod`                                                                              |
| `dashboard/views.ts`           | edited           | New card in Settings tab with toggle + `<input type="time">`                                              |

### Data model

New SQLite table:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

Keys used by this feature:

| Key                  | Type                | Notes                                                         |
| -------------------- | ------------------- | ------------------------------------------------------------- |
| `eodReminderEnabled` | `'true' \| 'false'` | User toggle                                                   |
| `eodReminderTime`    | `HH:mm` string      | 24h, validated by regex `^([01]\d\|2[0-3]):[0-5]\d$`          |
| `eodLastFiredDate`   | `YYYY-MM-DD`        | Local date; cleared on date roll-over by virtue of comparison |
| `eodSnoozeUntil`     | ISO 8601 timestamp  | Set when user clicks Snooze; cleared when snooze popup fires  |

All date/time comparisons use the system local timezone (matches user's wall-clock expectation of "6 PM").

The one-snooze-max rule is enforced at the UI layer: the second popup's `actions` array contains only `['Stop']`, so the user has no way to snooze again. No additional gating flag needed.

### Tick logic — `shouldFireEod`

Pure function, returns one of: `'fire-primary'`, `'fire-snooze'`, `'skip-mark-fired'`, `'skip'`.

```
input: { now: Date, settings, openSession }

if !settings.enabled              → 'skip'
if !isWeekday(now)                → 'skip'

if settings.snoozeUntil:
  if now < snoozeUntil            → 'skip'
  if dateOf(snoozeUntil) != today → 'skip'        // safety: skip stale snooze
  if !openSession                 → 'skip-mark-fired'
  return 'fire-snooze'

if settings.lastFiredDate == today → 'skip'

if now < parseTimeToday(settings.time, now) → 'skip'

if !openSession                   → 'skip-mark-fired'
return 'fire-primary'
```

Caller maps the decision to side effects:

- `'fire-primary'` → notify with `[Stop, Snooze 15m]`, set `lastFiredDate = today`
- `'fire-snooze'` → notify with `[Stop]`, clear `snoozeUntil`
- `'skip-mark-fired'` → set `lastFiredDate = today`, clear `snoozeUntil`
- `'skip'` → no-op

### Notification actions

Reuses `node-notifier`'s `NotificationCenter` with `actions` array and a callback that receives `metadata.activationValue`:

```ts
notifier.notify(
  {
    title: 'Clocktopus',
    subtitle: 'End of day',
    message: 'Timer still running. Stop now?',
    actions: ['Stop', 'Snooze 15m'],
    wait: true,
    sound: true,
  },
  (err, _, meta) => {
    if (meta?.activationValue === 'Stop') {
      stopTimerAndLog('End-of-day reminder.');
      clearSnoozeUntil();
    } else if (meta?.activationValue === 'Snooze 15m') {
      setSnoozeUntil(addMinutes(new Date(), 15));
      setEodSnoozeUsedDate(todayLocal());
    }
  },
);
```

For the snooze fire (second popup), actions is `['Stop']` only. Same callback shape.

### Dashboard route

```
GET  /api/settings/eod  → { enabled: boolean, time: string|null }
POST /api/settings/eod  → body { enabled: boolean, time: string }
                          400 if time fails HH:mm regex (when enabled=true)
                          200 { ok: true } on success
```

### Dashboard UI

New card in existing settings tab (`tab-settings`):

```
[End-of-Day Reminder]
[ ] Enable end-of-day reminder
Time: [ 18:00 ]
Fires Mon–Fri when a timer is running.
[Save]
```

Client JS posts to `/api/settings/eod` on Save, shows toast on success/error.

## Error handling

| Failure                           | Handling                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| Bad time string in POST           | Return 400, do not persist                                      |
| Bad time string read from DB      | Treat as disabled, log warning once per tick cycle (rate-limit) |
| `node-notifier` callback error    | Log to monitor logs, continue tick loop                         |
| `stopTimerAndLog` fails (network) | Log error, still set `lastFiredDate` to prevent loop            |
| DB read fails in tick             | Log, skip the tick (recoverable next tick)                      |
| Settings row missing              | Treat as defaults (disabled, no time)                           |

## Testing

### Unit (`lib/eod.test.ts`)

Pure-function tests over `shouldFireEod`. Matrix:

- disabled → skip
- weekend (Sat, Sun) → skip
- weekday, before time → skip
- weekday, at/after time, no open session → skip-mark-fired
- weekday, at/after time, open session, not fired today → fire-primary
- weekday, fired today, no snooze → skip
- weekday, snooze pending, before snoozeUntil → skip
- weekday, snooze elapsed, open session, same day → fire-snooze
- weekday, snooze elapsed, no open session → skip-mark-fired
- weekday, snooze elapsed, snoozeUntil from yesterday → skip

### Manual

1. Build, start monitor.
2. Set EOD time to `now + 1 min` via dashboard, enable.
3. Start timer.
4. Wait for popup. Click **Snooze 15m** → verify monitor logs the snooze.
5. Wait ~15 min. Second popup shows with **Stop** only. Click **Stop** → verify timer stopped in Clockify + DB.
6. Re-enable, set time again, dismiss popup → verify no further popups today.
7. Set time, no timer running → verify no popup but `lastFiredDate` advances (check DB).

## Known limitations

- **Tick latency**: notification can fire up to 60 s late (tick interval). Acceptable for a wall-clock reminder.
- **Timer started after EOD time**: if the user starts a new timer after the EOD time has already passed and `lastFiredDate == today`, no popup is shown for the rest of the day. Considered acceptable for v1; the idle popup still covers wake events.
- **Monitor daemon required**: feature is inert when the PM2 monitor is not running. Consistent with the idle popup.

## Open questions

None at spec time.

## Out of scope (future)

- Per-day schedule.
- Configurable snooze duration / count.
- "Stop in 60s" auto-stop variant.
- Cross-platform fallback when `node-notifier` is unavailable.
