# SimplyTrack

The minimalist cat identity lives in `public/logo.svg` (square) and `public/icon.svg` (rounded app icon). Run `node scripts/generate-icons.mjs` after editing the square logo to regenerate the rounded SVG, PWA PNGs, Apple touch icon, maskable icon, and favicon.

A responsive, local-first personal finance PWA built with Next.js and React. The adjacent `../ui` project is a visual/product reference; this directory is the implementation.

## UI design credit

The UI was designed and implemented entirely by AI—because I'm an awful designer. Any good-looking pixels are its doing.

## Run

Requires Node.js 20.9+ and pnpm.

```sh
pnpm install
pnpm dev
# Production, including generated offline caches:
pnpm build
pnpm start
```

Open `http://localhost:3000`. Production deployments must use HTTPS. No finance backend, account database, or server-side storage is used. No external fonts or analytics are loaded.

## Features

- Monthly overview, quick expenses, transaction creation/editing/deletion and search.
- Category budgets, savings goals, income-based 50/30/20 analysis.
- Configurable 1–24 month estimates and saved what-if scenarios, separate from actual records.
- Encrypted SQLite vault, export/import, remembered tab sessions, explicit logout.
- Optional encrypted Google Drive sync with conflict resolution.
- Optional WebAuthn PRF device unlock; a platform authenticator may use biometrics or a device PIN.
- Installable app, mobile navigation, keyboard-accessible dialogs and offline operation.
- English and Spanish UI, including localized categories, validation messages, dates and currency formatting.
- Light, dark and system appearance, including dialogs, charts, forms and mobile navigation.
- Personal profile/workspace names, ISO currencies, editable expense/income catalogs and payment methods, custom quick actions, and configurable forecast assumptions.
- Readable light/dark surfaces, touch-friendly mobile controls, sticky dialog headings/save actions, recoverable search filters and keyboard-scrollable forecast tables.

## Personalization

Open **Settings & storage** (the sliders icon on mobile), then **Edit preferences**. Set your name, workspace name and display currency; add or rename expense categories, income categories and payment methods; mark expense categories as needs for the planning breakdown; and configure up to 12 quick expense shortcuts. Remove all shortcuts to hide that section. Budgets, goals and scenarios can be created, edited and deleted from their respective screens.

Catalog entries have stable identifiers: renaming changes their display throughout the app without rewriting transaction history. Archive an entry to hide it from new-record forms; existing transactions and budgets can still be edited with that archived option. Keep at least one active entry per catalog. Quick actions must be changed or removed before archiving options they use. Custom names remain literal in either language.

Forecast preferences include expected monthly income, optional expected monthly expenses, a signed opening balance and a 1–24 month horizon. Blank expected expenses retain the recorded/recurring-spending estimate; an explicit zero means no projected expenses. Opening balance affects projections, not monthly income/expense totals. Currency changes relabel amounts, not convert them. New transactions and quick actions use the selected month, so records do not disappear into another month's view.

All these preferences are part of the encrypted SQLite book and travel with exports and Google Drive vault sync. Old vaults receive the original defaults in memory when opened; their records, identifiers and revision are unchanged until a command is saved. Language and appearance remain device-local preferences.

## Appearance

The default **System** appearance follows `prefers-color-scheme`, including live device changes. Choose **Light**, **Dark**, or **System** on the unlock screen or in settings. Explicit choices are saved to `localStorage` under `simply-track-theme`, survive reloads and logout, and are independent of the encrypted vault. No default preference is written until the user chooses one. Invalid saved values fall back to System. Storage failures display a warning while still applying the selection for the current session.

A small first-party script applies the saved/system theme before rendering to avoid an opposite-theme flash. Theme changes also update native control color schemes and the browser's theme color. Appearance preferences synchronize between tabs through storage events, and work offline.

## Language

On first use, the app selects English or Spanish from the device's ordered language preferences (`navigator.languages`, including regional variants such as `es-CR`). Unsupported device languages fall back to English. Use **Language / Idioma** on the unlock screen or in **Settings & storage** to override it. Only an explicit choice is saved to `localStorage` under `simply-track-language`; it takes precedence over the device language on later visits, survives logout, and is device/browser-specific, not synced with the vault. If local storage is unavailable, a visible warning explains that the selection only lasts for the session.

Translations and interpolation live in `src/shared/i18n/`, with no dependency on finance storage. The document's `lang` attribute follows the selected language. Categories and payment methods retain their stable stored identifiers; user-entered descriptions, custom catalog names, notes, goal names and scenario names are never translated. Browser-owned date/number input controls and native validation prompts follow the browser/OS's own localization support.

New vaults start empty. Amounts use integer hundredths, with at most two decimal input places, including currencies conventionally displayed without fractional units. Changing currency relabels amounts; it does not convert them. Savings-goal allocations are informational and do not move money. Monthly recurring flags inform forecasts, not automatic transaction creation. Forecast assumptions are shown in the app; recurring records are summed, not deduplicated into subscriptions.

## Privacy and terms

`/privacy` and `/terms` are bilingual, responsive, available offline, and linked from the unlock screen and app footer. They describe the app's actual storage, biometric, Google Drive, and hosting behavior. Set `NEXT_PUBLIC_LEGAL_OPERATOR`, `NEXT_PUBLIC_LEGAL_CONTACT`, and `NEXT_PUBLIC_LEGAL_JURISDICTION` before deploying, and have the text reviewed for your jurisdiction. Update `LEGAL_EFFECTIVE_DATE` in `src/modules/legal/presentation/legal-content.ts` when the content changes.

## Architecture

Source code uses **domain-first vertical slices**, with layers inside each module rather than global layer folders:

```text
src/
  modules/
    finance/
      domain/          # Aggregate, transaction entity, settings, invariants and projections
      application/     # Use cases and finance repository port
      infrastructure/  # SQLite repository adapter
      presentation/    # Finance views, editors and app shell
    vault/
      application/     # Sync-vault port
      infrastructure/  # Encryption, device storage, biometrics and Drive adapter
  composition/         # Runtime wiring: encrypted persistence + finance service + event bus
  shared/
    presentation/      # Accessible dialogs and small UI primitives
    i18n/              # English/Spanish messages and language selection
    theme/             # Device-local appearance preferences
```

`src/modules/finance/domain/finance.ts` is the finance bounded context. `FinanceBook` is the aggregate root controlling the book's consistency boundary; `Transaction` is an entity; IDs are value objects; and monetary values are validated integer minor units. Budget, goal, scenario and personalized settings records belong to the book. The domain uses `AggregateRoot`, `Entity`, `UUIDValue` and `DomainEvent` from `@schorts/shared-kernel`.

`src/modules/finance/application/finance-service.ts` contains the use case and repository port. Commands reconstruct an aggregate, enforce invariants, persist the snapshot and domain events together, then publish `FinanceChanged` through the shared kernel's `InMemoryEventBus`. Presentation subscribes to committed events. SQLite includes indexed transaction rows, budget/goal/scenario tables, the aggregate snapshot, and a durable domain-event audit table. This is event-driven application coordination, **not event sourcing**; the snapshot is authoritative. The event audit is not a distributed outbox and is not replayed into external side effects. Drive sync is triggered from the committed state and is independently retryable.

The browser composition root (`Vault` in `src/composition/vault.ts`, created by `getVault`) injects repositories and the event bus into application services with constructors. The Drive adapter depends on the vault module's `SyncVault` port, not the concrete composition root or finance internals. Explicit, typed constructor DI avoids a reflection/decorator container for this small graph. Domain/application layers have no React or browser-storage dependencies.

Changes are serialized, and a Web Lock holds exclusive access for the open tab. Another tab is refused rather than allowed to overwrite the device file. SQLite changes and their events are committed before publishing; persistence failure restores the previous in-memory database and surfaces an error. The whole SQLite snapshot is encrypted and written after each command, so this design targets personal-sized ledgers (imports are limited to 64 MB), not high-volume accounting.

## Storage and encryption

- `sql.js` runs real SQLite in browser memory. Its WASM is copied locally at install time.
- At rest, the complete SQLite image is encrypted with AES-256-GCM, a random 96-bit nonce for every write, and authenticated version/salt metadata. Password keys use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a random 128-bit salt.
- The `.vault` file is a versioned encrypted envelope, not a plaintext `.sqlite` file. Standard SQLite tools cannot open it without decryption.
- Device persistence uses the Origin Private File System (`simply-track.vault`). Browsers without OPFS use IndexedDB. The selected backend is pinned. This is browser-private storage, not a file in the user's Documents folder. **Export backup** downloads a portable encrypted file that can be saved anywhere.
- Site-data deletion, uninstall policies, browser eviction, device loss or forgotten passwords can make data unrecoverable. Persistent-storage permission is requested, but the browser can deny it. Keep independent encrypted backups.
- The password is never stored or sent to a server. A non-extractable `CryptoKey` is stored in IndexedDB alongside a random token held in `sessionStorage`, so reloads in the same tab remain unlocked. Logout removes that key and token, closes SQLite, and drops Google access tokens. Closing a tab removes its session token; a subsequent tab must unlock again.
- Remembered unlock deliberately trades stronger at-rest session isolation for convenience. Same-origin malicious code, browser extensions with sufficient privileges, device compromise, or anyone using an unlocked tab can access the data. Encryption does not protect an already-unlocked session. Use a trusted HTTPS origin and lock the vault on shared devices. There is no password recovery.
- Device unlock wraps the vault encryption key with a WebAuthn PRF-derived AES key, rather than treating a biometric prompt as proof without cryptography. The credential/wrapped key is local, never exported or synced, and is invalidated when importing/replacing a vault. Enabling it requires confirming the password. Unsupported PRF authenticators produce an explicit error; password unlock remains available.

## Google Drive setup

1. Enable Google Drive API in a Google Cloud project.
2. Configure an OAuth consent screen and a **Web application** OAuth client. Add the exact deployed origin (and `http://localhost:3000` for development) as an authorized JavaScript origin. Add test users if the app is in testing.
3. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. This is a public client ID; do not put a client secret in the browser. Rebuild after changing it.
4. Connect in **Settings & storage**. On a second device, choose **Open from Drive** on the welcome screen and enter the same vault password.

The app requests only `drive.appdata` and stores encrypted `simply-track.vault` snapshots in Google's private app-data folder (not the user's visible My Drive). Google access tokens remain in memory and expire normally. Enabling sync saves a device-local preference scoped to the vault ID, not a token or password. After password unlock, biometric unlock, or a remembered-session reload, the app attempts to reconnect once when online using Google's `prompt: "none"`. Google/browser restrictions may still require interaction; a **Reconnect Google Drive** button appears directly on the dashboard if automatic authorization fails. Locking/logging out drops the token but preserves this preference; **Disconnect** disables future automatic reconnection, and **Clear sync link** removes the preference and baseline. Existing installations with a sync baseline are treated as previously enabled. Sync runs after committed edits while connected and online; use **Sync now** to fetch edits from another device without a local change. It is not a background/cloud daemon.

There is one shared current Drive vault, selected by the newest Drive-assigned creation time (with file ID as a deterministic tie-breaker). Other snapshots are internal encrypted backups, not device branches. Sync keeps the current version and removes other snapshots older than 30 days. Devices retain their last synced file/version, book ID and local revision. Reconnecting to an unchanged copy does not prompt again; identical decrypted book IDs and revisions can also repair a missing baseline. If Drive changes and the device has no unsynced edits, the app automatically restores the shared current version using the unlocked vault key. If both changed, or the remote copy needs a different password, it offers **Restore from Drive** or **Replace Drive with this device**. It never merges records. Manual restoration downloads an encrypted device backup first.

Uploads append encrypted snapshots rather than overwriting existing files or relying on browser-exposed ETags. Simultaneous devices can still publish competing versions: the newest published version becomes shared current, and the other upload remains a recoverable backup for 30 days. This is not a transactional multi-device database or a record-level merge system. Avoid simultaneous editing if you need strict ordering. Deleting remote app data pauses synchronization with an actionable error. **Clear sync link** clears device metadata only, never remote files. Drive integration requires the operator's OAuth setup and a live account; automated tests mock Google endpoints.

Restoring Drive validates the password and SQLite data, then adopts the current version without creating a redundant upload. Automatic restoration verifies the device revision inside the vault's serialized queue so an edit made during download becomes a conflict instead of being lost. All sync and resolution operations share an operation guard; disconnect aborts outstanding requests and ignores stale UI results. Dismissing a conflict keeps Google connected and pauses automatic sync until a committed edit or manual sync. Every committed edit, including deletions, can trigger sync. Cleanup failures are reported separately from successful vault synchronization; a snapshot already deleted by another device is treated as cleaned up.

## Offline and install

`pnpm build` generates `public/sw.js` from the production build's exact JavaScript/CSS/font assets and caches the shell, icons and SQLite WASM. Only same-origin app assets are cached, never vault plaintext or Google responses. Offline support is registered in production only. Open the app online once and let service-worker installation finish before going offline. Updates activate once existing app tabs are closed; this prevents replacing runtime assets under an open vault.

Use the browser's Install app action, or **Share > Add to Home Screen** on iOS. Production needs HTTPS; localhost is allowed for development. Web Locks, IndexedDB, Web Crypto and WebAssembly are required. OPFS, install prompts, persistent-storage grants and WebAuthn PRF are capability-dependent enhancements. Deploy at the origin root (asset and worker paths assume `/`).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
NEXT_PUBLIC_GOOGLE_CLIENT_ID=drive-test-client pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:dev
```

Unit tests cover aggregate invariants, customization rules, legacy settings upgrades, architectural boundaries, exact amounts, projections, authenticated encryption/tampering, real SQLite round trips, device-write rollback, event ordering, Drive snapshot conflicts, import failure handling, cancellation and retention. Production-browser tests exercise desktop/mobile finance workflows, personalization, remembered reloads, tab locking, encrypted backup import and offline reload/writes on port 3100. Drive browser regressions mock Google sign-in and API traffic; the build needs a public client ID (the dummy test ID above is sufficient). Never deploy that test build as your real OAuth configuration; rebuild with your deployment's client ID before publishing. `test:e2e:dev` specifically covers dialog lifecycle and personalization under React Strict Mode, reusing or starting the development server on port 3000. Actual Google OAuth and hardware-backed PRF require compatible real accounts/devices and are not simulated as successful live integrations.
