# Desktop release (signed + notarized .dmg)

How to build, sign, notarize, and verify the Clocktopus desktop app (`desktop/`) for
distribution as a downloadable `.dmg`. This is Developer ID distribution (outside the
Mac App Store), so the current menubar design (`tauri-nspanel` / `macOSPrivateApi`) is
kept as-is.

## One-time prerequisites

1. Apple Developer Program membership (already enrolled).
2. Create a **Developer ID Application** certificate:
   - Xcode → Settings → Accounts → your team → Manage Certificates → "+" →
     "Developer ID Application".
   - Confirm it is installed: `security find-identity -v -p codesigning`
     (note the line like `"Developer ID Application: Your Name (TEAMID)"`).
3. Create notarization credentials (choose one):
   - **App Store Connect API key** (preferred): App Store Connect → Users and Access →
     Integrations → Keys → generate a key with the "Developer" role. Download the `.p8`
     once, note the **Key ID** and **Issuer ID**.
   - or an **app-specific password** for your Apple ID
     (appleid.apple.com → Sign-In & Security → App-Specific Passwords).

## Environment (set per shell, never commit)

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Option A — App Store Connect API key (preferred):
export APPLE_API_KEY="AB12CD34EF"            # Key ID
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Issuer ID
export APPLE_API_KEY_PATH="$HOME/keys/AuthKey_AB12CD34EF.p8"

# Option B — Apple ID + app-specific password (use instead of Option A):
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"  # app-specific password
export APPLE_TEAM_ID="TEAMID"
```

Tauri reads `APPLE_SIGNING_IDENTITY` automatically, so no signing identity is stored in
the repo. Set only one of Option A / Option B.

## Build + notarize

```sh
cd desktop
bunx tauri build
```

Tauri signs the app with the Developer ID identity, enables hardened runtime + the
entitlements at `src-tauri/entitlements.plist`, submits the app to Apple's notary
service, staples the ticket, and produces the artifacts under
`desktop/src-tauri/target/release/bundle/` (`.app` under `macos/`, `.dmg` under `dmg/`).

Verify the env vars are actually loaded before building — if `APPLE_SIGNING_IDENTITY`
is missing, Tauri silently falls back to an ad-hoc signature (no notarization), and the
checks below fail with "code has no resources" / "no ticket stapled". Confirm with
`echo "$APPLE_SIGNING_IDENTITY"`.

## Staple the DMG

Tauri notarizes and staples the `.app`, but NOT the `.dmg` wrapper. Staple the DMG too
so it passes Gatekeeper offline. The contents are already notarized, so the submit
returns quickly:

```sh
cd desktop
set -a; source .env; set +a
DMG=src-tauri/target/release/bundle/dmg/Clocktopus_*.dmg
xcrun notarytool submit $DMG --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple $DMG
```

## Verify

```sh
cd desktop
APP="src-tauri/target/release/bundle/macos/Clocktopus.app"
codesign --verify --deep --strict --verbose=2 "$APP"   # → "...: valid on disk"
spctl -a -vvv "$APP"                                    # → accepted, source=Notarized Developer ID
xcrun stapler validate src-tauri/target/release/bundle/dmg/Clocktopus_*.dmg  # → The validate action worked
```

If `spctl` rejects due to a hardened-runtime / entitlement issue, add the specific
entitlement to `src-tauri/entitlements.plist`, rebuild, and re-verify.

## Final check

Download the `.dmg` on a clean macOS user account, open it, drag Clocktopus to
Applications, and launch. Gatekeeper must NOT show an "unidentified developer" warning.
Walk the in-app Setup flow (it installs bun, then the `clocktopus` CLI, then starts the
server). Then link the `.dmg` on the website.
