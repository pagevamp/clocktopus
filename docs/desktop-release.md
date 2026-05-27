# Desktop release: signing & distribution

End-to-end guide to sign, notarize, and distribute the Clocktopus desktop app
(`desktop/`) as a downloadable `.dmg`. Written so a developer with no prior Apple
code-signing experience can do it from scratch.

This is **Developer ID** distribution (outside the Mac App Store), which keeps the
current menubar design (`tauri-nspanel` / `macOSPrivateApi`) as-is. The app is built
with Tauri 2; `bunx tauri build` produces the `.app` and `.dmg`.

## What you'll end up with

- A **Developer ID Application** certificate + private key (signs the `.app`).
- An **App Store Connect API key** `.p8` (notarizes the build with Apple).
- A populated `desktop/.env` for local builds, and the same values as GitHub secrets
  for CI.
- A signed + notarized + stapled `.dmg` that opens on any Mac with no Gatekeeper
  warning.

You need an account in the **Apple Developer Program** (paid, $99/yr) with the
**Account Holder** role (see Step 2 for why).

---

## Step 1 — Decide the signing org

The app is signed by an Apple _team_, and that team's name is shown to users as the
developer. Ours is **OUTSIDE TECH, INC. (RWWN85PDLH)**. Make sure you're allowed to use
that team for this app before continuing. All examples below use that team — substitute
your own team name / Team ID if different.

---

## Step 2 — Create the Developer ID Application certificate

> **Only the Account Holder can create Developer ID certificates.** Admins and Members
> cannot — the option simply won't appear (you'll only see _Apple Development_, _Apple
> Distribution_, _Mac Installer Distribution_). If you're not the Account Holder, ask
> them to do this step (or to share the exported `.p12` from Step 3).

> **CRITICAL — generate the CSR in your _login_ keychain.** This is the #1 thing that
> goes wrong. The private key is created when you make the CSR, and it must end up in
> your **login** keychain alongside the cert so you can later export a `.p12`. If the key
> lands in the **System** keychain (or gets split from the cert across keychains), you
> will NOT be able to export it, and CI signing is impossible without re-issuing. See
> Troubleshooting.

1. **Create the CSR (this makes your private key):**
   Open **Keychain Access**. First, in the left sidebar select the **login** keychain so
   the key is created there. Then menu bar → **Keychain Access → Certificate Assistant →
   Request a Certificate From a Certificate Authority…**
   - User Email Address: your email
   - Common Name: e.g. "Clocktopus Developer ID"
   - CA Email Address: leave blank
   - Select **Saved to disk**
   - Save the `.certSigningRequest`.

2. **Issue the cert:** developer.apple.com → Certificates, IDs & Profiles →
   **Certificates** → **+** → under **Software** pick **Developer ID Application**
   (NOT _Apple Distribution_ — that's App Store; NOT _Apple Development_ — that can't
   distribute). Profile Type: **G2 Sub-CA (Xcode 11.4.1 or later)**. Upload the CSR.

3. **Install:** download the issued `.cer` and double-click it. It pairs with the private
   key in your login keychain.

4. **Verify it's a complete, usable identity:**

   ```sh
   security find-identity -v -p codesigning
   ```

   You must see a line like
   `Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)`.
   (`-p codesigning` only lists identities that have **both** the cert and its private
   key — so seeing it here proves the pairing is good.)

5. **Confirm it's in login + exportable:** Keychain Access → **login** → **My
   Certificates** → the cert appears with a ▸ that expands to a private key. If it's not
   under **login → My Certificates**, stop and read Troubleshooting before continuing.

---

## Step 3 — Export the signing certificate as `.p12`

The `.p12` bundles the cert + private key. CI imports it to sign on a clean runner.

1. Keychain Access → **login** → **My Certificates** → right-click the **Developer ID
   Application** cert → **Export…** → format **Personal Information Exchange (.p12)** →
   set a password (you'll store it as `APPLE_CERTIFICATE_PASSWORD`).

   Or from the terminal:

   ```sh
   security export -k ~/Library/Keychains/login.keychain-db \
     -t identities -f pkcs12 -P "YOUR_P12_PASSWORD" -o ~/DeveloperID.p12
   ```

2. **Verify you exported the RIGHT cert** (this catches the most common CI failure):
   ```sh
   openssl pkcs12 -in ~/DeveloperID.p12 -passin pass:YOUR_P12_PASSWORD -nokeys 2>/dev/null \
     | openssl x509 -noout -subject
   ```
   The subject **must** contain `Developer ID Application`. If it shows
   `Apple Development`, you exported the wrong identity — see Troubleshooting.

---

## Step 4 — Create the notarization API key (`.p8`)

App Store Connect → **Users and Access** → **Integrations** → **Keys** → **Team Keys**
tab → **+** → role **Developer**. Download the `.p8` **once** (it cannot be
re-downloaded). Note the **Key ID** and **Issuer ID**.

Store the `.p8` **outside the repo** (e.g. `~/keys/`). The cert signs; this key
notarizes — you need both.

---

## Step 5 — Local builds

Populate `desktop/.env` (gitignored — see `desktop/.gitignore`, never committed):

```sh
# Exact string from `security find-identity -v -p codesigning`.
APPLE_SIGNING_IDENTITY="Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)"

# Notarization — App Store Connect API key.
APPLE_API_KEY="<Key ID>"
APPLE_API_ISSUER="<Issuer ID>"
APPLE_API_KEY_PATH="$HOME/keys/AuthKey_<Key ID>.p8"

# Signing cert as base64 (same values CI uses). On a machine whose Keychain already
# holds the identity these are optional locally, but keeping them makes .env the single
# source of truth.
APPLE_CERTIFICATE_PASSWORD="<the .p12 password from Step 3>"
APPLE_CERTIFICATE="<base64 of the .p12>"   # base64 -i ~/DeveloperID.p12
APPLE_API_KEY_B64="<base64 of the .p8>"    # base64 -i ~/keys/AuthKey_<Key ID>.p8
```

Then build everything with one command:

```sh
cd desktop && ./release.sh
```

`release.sh` loads `.env`, **fails fast** if `APPLE_SIGNING_IDENTITY` is empty or not in
the Keychain (which would otherwise silently produce an unsigned ad-hoc build), runs
`bunx tauri build`, notarizes + staples the `.dmg`, and runs all verification checks. It
prints the final distributable path.

<details>
<summary>Manual equivalent (for debugging)</summary>

```sh
cd desktop
set -a; source .env; set +a
echo "$APPLE_SIGNING_IDENTITY"   # MUST print the identity — empty ⇒ ad-hoc fallback
bunx tauri build                 # signs + notarizes + staples the .app

# Tauri staples the .app but NOT the .dmg — staple the dmg too:
DMG=src-tauri/target/release/bundle/dmg/Clocktopus_*.dmg
xcrun notarytool submit $DMG --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple $DMG
```

</details>

---

## Step 6 — CI (GitHub Actions)

`.github/workflows/build-desktop.yml` builds, signs, notarizes, staples, verifies, and
attaches the `.dmg` to a GitHub Release on any `v*` tag push. Add these repo secrets
(Settings → Secrets and variables → Actions → New repository secret):

| Secret                       | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | base64 of the Developer ID `.p12` (Step 3)                  |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password (Step 3)                                |
| `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: OUTSIDE TECH, INC. (RWWN85PDLH)` |
| `APPLE_API_KEY`              | App Store Connect **Key ID** (Step 4)                       |
| `APPLE_API_ISSUER`           | App Store Connect **Issuer ID** (Step 4)                    |
| `APPLE_API_KEY_B64`          | base64 of the `.p8` (Step 4)                                |

Generate the base64 values (macOS pipes to clipboard):

```sh
base64 -i ~/DeveloperID.p12       | pbcopy   # → APPLE_CERTIFICATE
base64 -i ~/keys/AuthKey_XXXX.p8  | pbcopy   # → APPLE_API_KEY_B64
```

Tauri imports `APPLE_CERTIFICATE` into a temporary keychain on the runner — no manual
keychain setup needed. Cut a release by pushing a tag:

```sh
git tag v1.0.3 && git push origin v1.0.3
```

---

## Verify & distribute

`release.sh` and CI run these automatically; run them by hand to double-check a build:

```sh
cd desktop
APP="$(ls -dt src-tauri/target/release/bundle/macos/*.app | head -1)"
DMG="$(ls -t  src-tauri/target/release/bundle/dmg/*.dmg | head -1)"
codesign --verify --deep --strict --verbose=2 "$APP"   # → "...: valid on disk"
spctl -a -vvv "$APP"                                    # → accepted, source=Notarized Developer ID
xcrun stapler validate "$DMG"                           # → The validate action worked
```

Final human check: download the `.dmg` on a **clean** macOS account, open it, drag
Clocktopus to Applications, launch. There must be no "unidentified developer" warning.
Walk the in-app Setup flow (installs bun, then the `clocktopus` CLI, then starts the
server). Then link the `.dmg` on the website.

---

## Troubleshooting

**`certificate from APPLE_CERTIFICATE "Apple Development: …" does not match provided
identity` (CI build fails).**
Your `.p12` contains the wrong cert. `security export` grabbed the _Apple Development_
identity instead of _Developer ID Application_. Re-export the correct one (Step 3) and
verify its subject with the `openssl` command before base64-ing it.

**Exported `.p12` only ever contains `Apple Development`, never `Developer ID
Application`.**
The Developer ID private key isn't in your login keychain — it's stuck in the **System**
keychain (or split from the cert), often marked non-extractable. There's no reliable way
to extract it. **Fix: re-issue the cert** — redo Step 2, being careful to select the
**login** keychain before creating the CSR. Same identity string, so nothing downstream
changes. Apple allows a limited number of Developer ID Application certs; if you're at
the cap, revoke the stuck one (already-notarized builds stay valid). Afterward, if two
identities share the same name (old in System, new in login), delete the old one to
avoid `codesign` ambiguity.

**Build "succeeds" but `spctl` says `code has no resources` / DMG has `no ticket
stapled`.**
`APPLE_SIGNING_IDENTITY` wasn't set in the build environment, so Tauri fell back to an
ad-hoc signature and skipped notarization. Confirm `echo "$APPLE_SIGNING_IDENTITY"`
prints the identity before building. `release.sh` guards against this.

**`xcrun stapler validate` fails on the `.dmg` even though the `.app` is accepted.**
Tauri staples the `.app` but not the `.dmg` wrapper. Notarize + staple the dmg
separately (the manual block in Step 5 / `release.sh` / CI all do this).

**`security export` with `-k /Library/Keychains/System.keychain` says "item could not be
found", or `sudo` complains "a terminal is required".**
You're trying to pull the key out of the System keychain. Don't — re-issue with the CSR
in login (see above). It's faster and reliable.
