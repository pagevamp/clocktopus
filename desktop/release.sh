#!/usr/bin/env bash
#
# Build, sign, notarize, staple, and verify the Clocktopus desktop .dmg.
#
# Prerequisites (one-time, manual — see docs/desktop-release.md):
#   - Developer ID Application cert installed in the login Keychain.
#   - App Store Connect API key (.p8) OR Apple ID app-specific password.
#   - desktop/.env populated (gitignored). See docs/desktop-release.md for keys.
#
# Usage:
#   cd desktop && ./release.sh
#
set -euo pipefail

# Always run from this script's directory (the desktop/ folder).
cd "$(dirname "${BASH_SOURCE[0]}")"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Load env ---------------------------------------------------------------
[ -f .env ] || die "desktop/.env not found. See docs/desktop-release.md."
set -a
# shellcheck disable=SC1091
source .env
set +a

# --- Validate credentials ---------------------------------------------------
[ -n "${APPLE_SIGNING_IDENTITY:-}" ] || die "APPLE_SIGNING_IDENTITY is empty — would fall back to ad-hoc (no notarization)."

# Confirm the identity actually exists in the Keychain.
security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY" \
  || die "Signing identity not found in Keychain: $APPLE_SIGNING_IDENTITY"

# Decide which notarization credential set to use.
NOTARY_ARGS=()
if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  [ -f "$APPLE_API_KEY_PATH" ] || die "APPLE_API_KEY_PATH does not point to a file: $APPLE_API_KEY_PATH"
  NOTARY_ARGS=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
  log "Using App Store Connect API key for notarization."
elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
  log "Using Apple ID + app-specific password for notarization."
else
  die "No notarization credentials. Set APPLE_API_KEY/ISSUER/KEY_PATH or APPLE_ID/PASSWORD/TEAM_ID in .env."
fi

# --- Build (Tauri signs the .app, notarizes + staples it) -------------------
log "Building (signing identity: $APPLE_SIGNING_IDENTITY) …"
bunx tauri build

# --- Locate the freshly built .dmg and .app --------------------------------
DMG="$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"
APP="$(ls -dt src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -1 || true)"
[ -n "$DMG" ] || die "No .dmg found under src-tauri/target/release/bundle/dmg/"
[ -n "$APP" ] || die "No .app found under src-tauri/target/release/bundle/macos/"
log "App: $APP"
log "DMG: $DMG"

# --- Notarize + staple the DMG (Tauri staples the .app, not the .dmg) -------
log "Submitting DMG to the notary service …"
xcrun notarytool submit "$DMG" "${NOTARY_ARGS[@]}" --wait
log "Stapling the DMG …"
xcrun stapler staple "$DMG"

# --- Verify -----------------------------------------------------------------
log "Verifying app signature …"
codesign --verify --deep --strict --verbose=2 "$APP"
log "Verifying Gatekeeper acceptance …"
spctl -a -vvv "$APP"
log "Validating DMG staple …"
xcrun stapler validate "$DMG"

log "Done. Distributable: $DMG"
