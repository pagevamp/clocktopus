# Menu Bar Label Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append a Jira ticket or trimmed description next to the elapsed time in the macOS menu bar tray title, so the title reads `H:MM:SS LABEL`.

**Architecture:** Extend `GET /api/timer/active` to return a `jiraTicket` field. Extend the existing 1-second tick loop in `desktop/src-tauri/src/lib.rs` to cache `description` and `jira_ticket` alongside `start_ms`, pick a display label via a new pure `format_label` helper (Jira wins; otherwise description trimmed to 30 chars with `…`), and compose the title as `"{elapsed} {label}"` or just `"{elapsed}"` when no label exists.

**Tech Stack:** Hono (TypeScript), Rust, Tauri v2.

**Spec:** `docs/superpowers/specs/2026-04-17-menu-bar-label-display-design.md`

---

## File Structure

- `dashboard/routes/timer.ts` — add `jiraTicket` (computed via existing `extractJiraTicket`) to the `GET /api/timer/active` JSON response.
- `desktop/src-tauri/src/lib.rs` — add `DESC_MAX_CHARS` constant, `format_label` pure helper, unit tests; extend thread-local state and JSON parse and title composition.

---

### Task 1: Expose `jiraTicket` in `/api/timer/active`

**Files:**

- Modify: `dashboard/routes/timer.ts`

- [ ] **Step 1: Update the response to include the extracted ticket**

Open `dashboard/routes/timer.ts`. The active-timer handler currently returns:

```ts
return c.json({
  active: true,
  description: timer.description,
  projectId: timer.projectId,
  start: timerStart,
});
```

Replace that block with:

```ts
const jiraTicket = extractJiraTicket(timer.description ?? '');
return c.json({
  active: true,
  description: timer.description,
  projectId: timer.projectId,
  start: timerStart,
  ...(jiraTicket ? { jiraTicket } : {}),
});
```

Note: the same extractor is already called a few lines above inside the `if (!alreadyTracked)` branch. That call site is unchanged — we recompute here to cover both the "new session" and "already-tracked" paths. Keep both calls; `extractJiraTicket` is a pure regex match and trivially cheap.

- [ ] **Step 2: Build passes**

Run from repo root: `bun run build`

Expected: `tsc` finishes with no errors. If it complains about `jiraTicket` being redeclared, rename one of the two locals.

- [ ] **Step 3: Commit**

```bash
git add dashboard/routes/timer.ts
git commit -m "feat(timer): expose jiraTicket on /api/timer/active"
```

---

### Task 2: Add `DESC_MAX_CHARS` constant and `format_label` helper with tests

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs` (insert constant + helper after `parse_start_to_ms`, before `#[cfg_attr(mobile, ...)]`; append new tests to the existing `mod tests` block)

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `mod tests` block (at the bottom of `desktop/src-tauri/src/lib.rs`, after the `parse_start_to_ms_invalid` test):

```rust
    #[test]
    fn format_label_jira_only() {
        assert_eq!(format_label(Some("JIRA-123"), None), Some("JIRA-123".to_string()));
    }

    #[test]
    fn format_label_description_short() {
        assert_eq!(
            format_label(None, Some("Refactor auth middleware")),
            Some("Refactor auth middleware".to_string()),
        );
    }

    #[test]
    fn format_label_description_exactly_30() {
        let desc = "a".repeat(30);
        assert_eq!(format_label(None, Some(&desc)), Some(desc.clone()));
    }

    #[test]
    fn format_label_description_truncates_at_31() {
        let desc = "a".repeat(31);
        let result = format_label(None, Some(&desc)).unwrap();
        assert_eq!(result.chars().count(), 30);
        assert!(result.ends_with('…'));
        assert_eq!(result, format!("{}…", "a".repeat(29)));
    }

    #[test]
    fn format_label_jira_wins_over_description() {
        assert_eq!(
            format_label(Some("JIRA-123"), Some("some description")),
            Some("JIRA-123".to_string()),
        );
    }

    #[test]
    fn format_label_empty_strings_are_none() {
        assert_eq!(format_label(Some(""), Some("")), None);
        assert_eq!(format_label(None, Some("")), None);
        assert_eq!(format_label(Some(""), None), None);
    }

    #[test]
    fn format_label_both_none_is_none() {
        assert_eq!(format_label(None, None), None);
    }

    #[test]
    fn format_label_multibyte_description() {
        // 31 emoji characters — each is multi-byte in UTF-8 but one char.
        let desc = "🐙".repeat(31);
        let result = format_label(None, Some(&desc)).unwrap();
        assert_eq!(result.chars().count(), 30);
        assert!(result.ends_with('…'));
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd desktop/src-tauri && cargo test format_label`

Expected: compile error `cannot find function 'format_label' in this scope`.

- [ ] **Step 3: Implement constant + `format_label`**

Open `desktop/src-tauri/src/lib.rs`. Immediately after the `parse_start_to_ms` function and before `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, insert:

```rust
/// Maximum character count (not bytes) before a description is trimmed with an ellipsis.
const DESC_MAX_CHARS: usize = 30;

/// Pick a display label for the tray title.
/// Jira ticket wins when present and non-empty. Otherwise trim the description
/// to `DESC_MAX_CHARS` characters, appending `…` when trimmed.
/// Returns `None` when neither source yields a usable string.
fn format_label(jira: Option<&str>, desc: Option<&str>) -> Option<String> {
    if let Some(j) = jira {
        if !j.is_empty() {
            return Some(j.to_string());
        }
    }
    if let Some(d) = desc {
        if !d.is_empty() {
            if d.chars().count() <= DESC_MAX_CHARS {
                return Some(d.to_string());
            }
            let head: String = d.chars().take(DESC_MAX_CHARS - 1).collect();
            return Some(format!("{}…", head));
        }
    }
    None
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd desktop/src-tauri && cargo test format_label`

Expected: `test result: ok. 8 passed; 0 failed`.

- [ ] **Step 5: Run the full suite**

Run: `cd desktop/src-tauri && cargo test`

Expected: 18 tests pass (10 pre-existing + 8 new).

- [ ] **Step 6: Commit**

Use the move-file workaround to keep unrelated modifications out of this commit (husky pre-commit does `git add .`). If `git status` shows only `lib.rs` modified, plain `git add` is fine.

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add format_label helper for tray title suffix"
```

---

### Task 3: Wire label into poll thread and title composition

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs` (thread body)

- [ ] **Step 1: Extend thread-local state**

In the `std::thread::spawn(move || { ... })` block (currently has `let mut is_active: bool = false; let mut start_ms: Option<i64> = None; let mut tick: u32 = 0;`), add two more locals immediately after `start_ms`:

Before:

```rust
                let mut is_active: bool = false;
                let mut start_ms: Option<i64> = None;
                let mut tick: u32 = 0;
```

After:

```rust
                let mut is_active: bool = false;
                let mut start_ms: Option<i64> = None;
                let mut description: Option<String> = None;
                let mut jira_ticket: Option<String> = None;
                let mut tick: u32 = 0;
```

- [ ] **Step 2: Parse `description` and `jiraTicket` from the JSON response**

In the `if let Some(json) = response { ... }` branch, after the existing `new_start_ms` assignment and before the `if new_active != is_active` check, add:

```rust
                            let new_description = json
                                .get("description")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let new_jira_ticket = json
                                .get("jiraTicket")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
```

Then, after the existing `start_ms = if new_active { new_start_ms } else { None };` line, add (still inside the `if let Some(json)` block):

```rust
                            if new_active {
                                description = new_description;
                                jira_ticket = new_jira_ticket;
                            } else {
                                description = None;
                                jira_ticket = None;
                            }
```

- [ ] **Step 3: Compose title with label**

Find the current title-drive block:

```rust
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
```

Replace with:

```rust
                    // Drive the title every tick
                    if is_active {
                        if let Some(start) = start_ms {
                            let now_ms = chrono::Utc::now().timestamp_millis();
                            let elapsed = now_ms - start;
                            let elapsed_str = format_elapsed(elapsed);
                            let label = format_label(jira_ticket.as_deref(), description.as_deref());
                            let title = match label {
                                Some(l) => format!("{} {}", elapsed_str, l),
                                None => elapsed_str,
                            };
                            let _ = tray.set_title(Some(&title));
                        } else {
                            let _ = tray.set_title(None::<&str>);
                        }
                    } else {
                        let _ = tray.set_title(None::<&str>);
                    }
```

- [ ] **Step 4: Verify it compiles**

Run: `cd desktop/src-tauri && cargo check`

Expected: `Finished`, no errors. A `#[allow(dead_code)]`-style warning on `description` or `jira_ticket` should not appear because both are read in the title block.

- [ ] **Step 5: Run the full suite**

Run: `cd desktop/src-tauri && cargo test`

Expected: 18 tests pass.

- [ ] **Step 6: Manual smoke test (macOS)**

SKIP this step if you are an automated agent. Note this in your report. For a human: `cd desktop && bun run tauri dev`, start a timer whose description contains `JIRA-123`, confirm the title reads `0:00:0x JIRA-123`. Start another timer with a long description (~50 chars, no ticket) and confirm the description is trimmed with `…` at 30 chars.

- [ ] **Step 7: Commit**

If `git status` shows files other than `lib.rs` modified, move them aside (e.g. `mv /path /tmp/`) before committing, then restore and commit them separately.

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): show Jira ticket or description next to elapsed time"
```

---

## Out of Scope (from spec)

- Truncating Jira tickets.
- Per-project custom labels/colors.
- Showing project name.
- Rich formatting.
- Localizing the ellipsis character.
