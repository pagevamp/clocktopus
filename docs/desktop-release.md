# Desktop release (signed + notarized .dmg)

How to build, sign, notarize, and verify the Clocktopus desktop app (`desktop/`) for
distribution as a downloadable `.dmg`. This is Developer ID distribution (outside the
Mac App Store), so the current menubar design (`tauri-nspanel` / `macOSPrivateApi`) is
kept as-is.

## One-time prerequisites

1. Apple Developer Program membership (paid).
2. Create a **Developer ID Application** certificate. Note: only the **Account Holder**
   can create Developer ID certs — Admins cannot, and the option won't appear for them
   (you'll only see Apple Development / Apple Distribution / Mac Installer Distribution).
   - developer.apple.com → Certificates, IDs & Profiles → Certificates → "+" →
     under **Software** choose **Developer ID Application** (NOT Apple Distribution —
     that's for the App Store).
   - Profile Type: choose **G2 Sub-CA (Xcode 11.4.1 or later)** (the "Previous Sub-CA"
     is legacy and expires Feb 01, 2027).
   - It asks for a CSR. Generate one in **Keychain Access** (menu bar) →
     **Certificate Assistant → Request a Certificate From a Certificate Authority…**:
     enter your email + a Common Name, leave CA Email blank, select **Saved to disk**.
     Upload the resulting `.certSigningRequest`.
   - Download the issued `.cer`, double-click to install into your Keychain.
   - Confirm: `security find-identity -v -p codesigning` shows the identity. Ours is
     `Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)`.
   - Note: this signs the app as **OUTSIDE TECH, INC.** — that org is the listed
     developer on every distributed build.
3. Create notarization credentials — **App Store Connect API key**:
   App Store Connect → Users and Access → Integrations → Keys → **Team Keys** tab →
   generate a key with the **Developer** role. Download the `.p8` **once** (you cannot
   re-download it), and note the **Key ID** and **Issuer ID**.
   (Alternative: an Apple ID app-specific password — see Option B below.)

## Environment

Store these in `desktop/.env` (already gitignored — see `desktop/.gitignore`, so it is
never committed). Set only one of Option A / Option B.

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)"

# Option A — App Store Connect API key (preferred):
APPLE_API_KEY="AB12CD34EF"            # Key ID
APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Issuer ID
APPLE_API_KEY_PATH="/Users/szn/keys/AuthKey_AB12CD34EF.p8"

# Option B — Apple ID + app-specific password (use instead of Option A):
APPLE_ID="you@example.com"
APPLE_PASSWORD="abcd-efgh-ijkl-mnop"  # app-specific password
APPLE_TEAM_ID="RWWN85PDLH"
```

Keep the `.p8` file **outside** the repo (e.g. `~/keys/`) — `.gitignore` does not cover
loose `*.p8` files, so a key dropped inside `desktop/` could be committed.

`desktop/.env` is NOT auto-exported into the build. Load it into the shell before every
build (`set -a; source .env; set +a`), as shown below.

## Build + notarize

```sh
cd desktop
set -a; source .env; set +a
echo "$APPLE_SIGNING_IDENTITY"   # MUST print the identity — empty means ad-hoc fallback
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
