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
   - **Setting up on a different machine:** the Developer ID cert's private key cannot
     be re-downloaded and lives only in the Keychain that created it. On the original
     machine, export it from Keychain Access (right-click the identity → Export → `.p12`,
     set a password). On the new machine, double-click the `.p12` to import. Re-issuing a
     new cert is also possible but the old one keeps signing existing builds.
3. Create notarization credentials — **App Store Connect API key**:
   App Store Connect → Users and Access → Integrations → Keys → **Team Keys** tab →
   generate a key with the **Developer** role. Download the `.p8` **once** (you cannot
   re-download it), and note the **Key ID** and **Issuer ID**.
   (Alternative: an Apple ID app-specific password — see Option B below.)

## Environment

`desktop/.env` (already gitignored — see `desktop/.gitignore`, never committed) holds
everything for local builds. The same values feed CI as GitHub secrets (see the CI
section). Full set:

```sh
# Signing identity — exact string from `security find-identity -v -p codesigning`.
APPLE_SIGNING_IDENTITY="Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)"

# Notarization — App Store Connect API key.
APPLE_API_KEY="<Key ID>"
APPLE_API_ISSUER="<Issuer ID>"
APPLE_API_KEY_PATH="/Users/szn/keys/AuthKey_<Key ID>.p8"   # path to the .p8 (local builds)

# Cert + private key for signing. Locally the cert lives in the Keychain, so these are
# only strictly needed by CI — but release.sh / Tauri will use them if present.
APPLE_CERTIFICATE_PASSWORD="<password set when exporting the .p12>"
APPLE_CERTIFICATE="<base64 of the .p12>"        # base64 -i DeveloperID.p12
APPLE_API_KEY_B64="<base64 of the .p8>"          # base64 -i ~/keys/AuthKey_<Key ID>.p8
```

Notes:

- `.p12` (cert + private key) = **signing**. `.p8` (App Store Connect key) = **notarization**.
  CI needs both; a local build can sign straight from the Keychain and only needs the
  `.p8` (`APPLE_API_KEY_PATH`) for notarization.
- Keep the `.p8` file **outside** the repo (e.g. `~/keys/`) — `.gitignore` does not cover
  loose `*.p8` files, so a key dropped inside `desktop/` could be committed.
- `desktop/.env` is NOT auto-exported into the build. `release.sh` loads it for you; for
  manual builds run `set -a; source .env; set +a` first.

## Build + notarize

Once the one-time prerequisites are done and `desktop/.env` is populated, the whole
build → notarize → staple → verify pipeline is one command:

```sh
cd desktop && ./release.sh
```

`release.sh` loads `.env`, fails fast if the signing identity is missing or not in the
Keychain, builds, notarizes + staples the DMG, and runs all verification checks. The
manual steps below are what it automates (useful for debugging).

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

## CI (GitHub Actions)

`.github/workflows/build-desktop.yml` builds, signs, notarizes, staples, verifies, and
attaches the DMG to a GitHub Release on any `v*` tag push. It needs these repo secrets
(Settings → Secrets and variables → Actions → New repository secret):

| Secret                       | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | base64 of the exported Developer ID `.p12`                  |
| `APPLE_CERTIFICATE_PASSWORD` | the password set when exporting the `.p12`                  |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)` |
| `APPLE_API_KEY`              | App Store Connect **Key ID**                                |
| `APPLE_API_ISSUER`           | App Store Connect **Issuer ID**                             |
| `APPLE_API_KEY_B64`          | base64 of the `.p8` key file                                |

Generate the base64 values (macOS pipes to clipboard):

```sh
# Export the cert+key first: Keychain Access → right-click the Developer ID identity →
# Export → .p12 (set a password = APPLE_CERTIFICATE_PASSWORD), then:
base64 -i DeveloperID.p12 | pbcopy        # → APPLE_CERTIFICATE
base64 -i ~/keys/AuthKey_XXXX.p8 | pbcopy # → APPLE_API_KEY_B64
```

Tauri imports `APPLE_CERTIFICATE` into a temporary keychain on the runner — no manual
keychain setup needed. Trigger a release by pushing a tag, e.g.
`git tag v1.0.3 && git push origin v1.0.3`.

## Final check

Download the `.dmg` on a clean macOS user account, open it, drag Clocktopus to
Applications, and launch. Gatekeeper must NOT show an "unidentified developer" warning.
Walk the in-app Setup flow (it installs bun, then the `clocktopus` CLI, then starts the
server). Then link the `.dmg` on the website.
