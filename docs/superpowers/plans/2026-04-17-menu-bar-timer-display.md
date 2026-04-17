# Menu Bar Timer Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the running timer's elapsed duration as `H:MM:SS` text next to the tray icon in the macOS menu bar, ticking every second while idle poll cadence stays at 5 seconds.

**Architecture:** Extend the existing background thread in `desktop/src-tauri/src/lib.rs` to a 1-second tick loop. Every 5th tick it polls `GET /api/timer/active` and parses the JSON to maintain local `is_active: bool` and `start_ms: Option<i64>` state. Every tick it either computes elapsed and calls `tray.set_title(Some(formatted))`, or calls `tray.set_title(None)` when idle. Two pure helpers (`format_elapsed`, `parse_start_to_ms`) are unit-tested.

**Tech Stack:** Rust, Tauri v2, reqwest (blocking), serde_json (already present), chrono (new).

**Spec:** `docs/superpowers/specs/2026-04-17-menu-bar-timer-display-design.md`

---

## File Structure

- `desktop/src-tauri/Cargo.toml` — add `chrono` dependency
- `desktop/src-tauri/src/lib.rs` — add two pure helper functions (`format_elapsed`, `parse_start_to_ms`), a `#[cfg(test)] mod tests` block, and rewrite the poll thread loop to tick every 1s and update `tray.set_title()`

Single-file change keeps cohesion with existing tray logic. No separate module needed — helpers are ~30 lines each and reused only inside this file.

---

### Task 1: Add chrono dependency

**Files:**

- Modify: `desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add chrono to `[dependencies]`**

Edit `desktop/src-tauri/Cargo.toml`. Add this line at the end of `[dependencies]` (after `png = "0.18.1"`):

```toml
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

- [ ] **Step 2: Verify it resolves**

Run from repo root: `cd desktop/src-tauri && cargo check`

Expected: `Compiling chrono v0.4.x` appears in output, then `Finished` with no errors. Warnings about unused deps are OK.

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
git commit -m "chore(desktop): add chrono dependency for RFC 3339 parsing"
```

---

### Task 2: Add `format_elapsed` helper with tests

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs` (insert new fn after `recolor`, before `#[cfg_attr(mobile, ...)]`)

- [ ] **Step 1: Write the failing test**

Add this to the bottom of `desktop/src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_elapsed_zero() {
        assert_eq!(format_elapsed(0), "0:00:00");
    }

    #[test]
    fn format_elapsed_seconds() {
        assert_eq!(format_elapsed(5_000), "0:00:05");
    }

    #[test]
    fn format_elapsed_minutes() {
        assert_eq!(format_elapsed(83_000), "0:01:23");
    }

    #[test]
    fn format_elapsed_hours() {
        assert_eq!(format_elapsed(5_025_000), "1:23:45");
    }

    #[test]
    fn format_elapsed_twelve_hours() {
        assert_eq!(format_elapsed(43_200_000), "12:00:00");
    }

    #[test]
    fn format_elapsed_negative_clamps_to_zero() {
        assert_eq!(format_elapsed(-1_000), "0:00:00");
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run from repo root: `cd desktop/src-tauri && cargo test format_elapsed`

Expected: compile error `cannot find function 'format_elapsed' in this scope`.

- [ ] **Step 3: Implement `format_elapsed`**

Insert this function in `desktop/src-tauri/src/lib.rs` immediately after the `recolor` function and before `#[cfg_attr(mobile, tauri::mobile_entry_point)]`:

```rust
/// Format an elapsed millisecond count as `H:MM:SS`.
/// Hours are unpadded; minutes and seconds are zero-padded to 2 digits.
/// Negative input clamps to `0:00:00`.
fn format_elapsed(ms: i64) -> String {
    let total_secs = if ms < 0 { 0 } else { ms / 1000 };
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    format!("{}:{:02}:{:02}", hours, minutes, seconds)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd desktop/src-tauri && cargo test format_elapsed`

Expected: `test result: ok. 6 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add format_elapsed helper for H:MM:SS display"
```

---

### Task 3: Add `parse_start_to_ms` helper with tests

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `mod tests` block in `desktop/src-tauri/src/lib.rs`:

```rust
    #[test]
    fn parse_start_to_ms_utc_z() {
        let ms = parse_start_to_ms("2026-04-17T10:30:00Z").unwrap();
        assert_eq!(ms, 1_776_421_800_000);
    }

    #[test]
    fn parse_start_to_ms_with_offset() {
        let ms = parse_start_to_ms("2026-04-17T16:15:00+05:45").unwrap();
        // Same instant as 10:30:00Z
        assert_eq!(ms, 1_776_421_800_000);
    }

    #[test]
    fn parse_start_to_ms_with_fractional() {
        let ms = parse_start_to_ms("2026-04-17T10:30:00.500Z").unwrap();
        assert_eq!(ms, 1_776_421_800_500);
    }

    #[test]
    fn parse_start_to_ms_invalid() {
        assert!(parse_start_to_ms("not-a-date").is_none());
        assert!(parse_start_to_ms("").is_none());
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd desktop/src-tauri && cargo test parse_start_to_ms`

Expected: compile error `cannot find function 'parse_start_to_ms' in this scope`.

- [ ] **Step 3: Implement `parse_start_to_ms`**

Insert this function in `desktop/src-tauri/src/lib.rs` immediately after `format_elapsed`:

```rust
/// Parse an RFC 3339 timestamp (e.g. `2026-04-17T10:30:00Z` or with offset) to Unix millis.
/// Returns `None` if the string cannot be parsed.
fn parse_start_to_ms(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis())
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd desktop/src-tauri && cargo test parse_start_to_ms`

Expected: `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add parse_start_to_ms helper for ISO timestamps"
```

---

### Task 4: Rewrite poll thread to 1s tick loop driving `set_title`

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs` (replace the `std::thread::spawn(move || { ... })` block currently starting at line 131)

- [ ] **Step 1: Replace the poll thread body**

In `desktop/src-tauri/src/lib.rs`, find the block that currently reads:

```rust
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();

                loop {
                    std::thread::sleep(Duration::from_secs(5));

                    let active = client
                        .get("http://localhost:4001/api/timer/active")
                        .timeout(Duration::from_secs(3))
                        .send()
                        .and_then(|r| r.text())
                        .map(|t| t.contains("\"active\":true"))
                        .unwrap_or(false);

                    let prev = was_active_c.load(Ordering::Relaxed);
                    if active != prev {
                        was_active_c.store(active, Ordering::Relaxed);

                        let rgba = if active { &active_rgba } else { &idle_rgba };
                        let img = Image::new_owned(rgba.clone(), w, h);
                        let _ = tray.set_icon(Some(img));
                        let _ = tray.set_icon_as_template(true);

                        let _ = tray.set_tooltip(Some(if active {
                            "Clocktopus - Timer running"
                        } else {
                            "Clocktopus"
                        }));
                    }
                }
            });
```

Replace it with:

```rust
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                let mut is_active: bool = false;
                let mut start_ms: Option<i64> = None;
                let mut tick: u32 = 0;

                loop {
                    // Poll on first iteration and every 5th tick after
                    if tick % 5 == 0 {
                        let response = client
                            .get("http://localhost:4001/api/timer/active")
                            .timeout(Duration::from_secs(3))
                            .send()
                            .and_then(|r| r.text())
                            .ok()
                            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());

                        if let Some(json) = response {
                            let new_active = json.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                            let new_start_ms = json
                                .get("start")
                                .and_then(|v| v.as_str())
                                .and_then(parse_start_to_ms);

                            if new_active != is_active {
                                is_active = new_active;
                                was_active_c.store(new_active, Ordering::Relaxed);

                                let rgba = if new_active { &active_rgba } else { &idle_rgba };
                                let img = Image::new_owned(rgba.clone(), w, h);
                                let _ = tray.set_icon(Some(img));
                                let _ = tray.set_icon_as_template(true);

                                let _ = tray.set_tooltip(Some(if new_active {
                                    "Clocktopus - Timer running"
                                } else {
                                    "Clocktopus"
                                }));
                            }

                            start_ms = if new_active { new_start_ms } else { None };
                        }
                        // On request/parse failure: leave is_active and start_ms unchanged
                    }

                    // Drive the title every tick
                    if is_active {
                        if let Some(start) = start_ms {
                            let now_ms = chrono::Utc::now().timestamp_millis();
                            let elapsed = now_ms - start;
                            let _ = tray.set_title(Some(&format_elapsed(elapsed)));
                        } else {
                            let _ = tray.set_title(None::<&str>);
                        }
                    } else {
                        let _ = tray.set_title(None::<&str>);
                    }

                    tick = tick.wrapping_add(1);
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
```

- [ ] **Step 2: Verify it compiles**

Run: `cd desktop/src-tauri && cargo check`

Expected: `Finished`. No errors. Unused-variable warnings on `was_active` / `was_active_c` are not expected — both are still used (only writer is `was_active_c`). If a warning does appear, leave it unless it's an error.

- [ ] **Step 3: Run the full test suite**

Run: `cd desktop/src-tauri && cargo test`

Expected: all tests from Tasks 2 and 3 still pass. `test result: ok. 10 passed; 0 failed`.

- [ ] **Step 4: Manual smoke test (macOS)**

Run from repo root:

```bash
cd desktop && bun run tauri dev
```

Expected sequence:

1. App launches, tray icon appears with no title text.
2. Start a timer from the dashboard (or via `clock start`).
3. Within ~5 seconds, tray icon swaps to active variant AND a text like `0:00:04` appears next to it.
4. Title ticks up each second: `0:00:05`, `0:00:06`, ...
5. Stop the timer. Within ~5 seconds, title disappears and icon reverts to idle.
6. Kill the dashboard server (`mstop` or Ctrl-C). Title keeps ticking from last known state for a while (expected per spec — no offline indicator).

If the dashboard server is not running at app start, the title should stay empty and the existing error page should show in the window.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): show running timer elapsed in menu bar"
```

---

## Out of Scope (from spec)

- Linux / Windows menu bar text.
- Configurable format.
- Project name / description in the menu bar.
- Click-to-stop from tray.
- Notifications on elapsed thresholds.
