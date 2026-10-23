# Changelog

## [1.1.2] - 2026-10-23

### Fixed

- Clear settings errors when closing the dialog so they do not reappear on the page or when reopening settings.

## [1.1.1] - 2026-10-23

### Fixed

- Bring dialog errors into view and focus them, rather than leaving errors hidden behind dialogs or outside the scrolled viewport.
- Hide installation controls in installed app display modes, including iOS standalone, and after the browser reports installation.

## [1.1.0] - 2026-10-23

### Added

- Remember whether Google Drive sync is enabled on this device, scoped to the vault.
- Automatically attempt to reconnect and sync after password unlock, device unlock, or a remembered-session reload when online.
- Show a dashboard **Reconnect Google Drive** action when Google or the browser requires user interaction.
- Recognize existing sync baselines as previously enabled installations.

### Changed

- Logging out clears the Google access token but preserves the sync preference. **Disconnect** disables automatic reconnection; **Clear sync link** removes the preference and baseline.
- Handle sign-in cancellation, blocked popups, timeouts, and late callbacks without restoring a disconnected session.
- Update English and Spanish messages, settings guidance, privacy disclosures, and documentation for automatic reconnection. Google access tokens remain memory-only.

## [1.0.0] - 2026-10-23

### Added

- Responsive, minimalist personal finance PWA with an entirely AI-designed UI, custom cat identity, mobile navigation, accessible dialogs, and offline support.
- Monthly overview, quick expenses, searchable transactions, and transaction creation, editing, and deletion.
- Category budgets, savings goals, income-based 50/30/20 analysis, configurable 1–24 month forecasts, and saved what-if scenarios.
- Personalized profiles and workspaces, display currencies, expense and income categories, payment methods, quick actions, and forecast assumptions.
- Local-first SQLite persistence in browser-private OPFS storage with an IndexedDB fallback.
- Password-protected AES-256-GCM encrypted vaults, encrypted backup export/import, remembered tab sessions, and explicit logout.
- Optional WebAuthn PRF device unlock using compatible platform biometrics or a device PIN.
- Optional Google Drive sync with automatic uploads after committed edits, manual synchronization, and one shared current encrypted vault across devices.
- Automatic restoration of newer Drive data when the device has no unsynced changes, with explicit restore-or-replace decisions for conflicting copies.
- Encrypted Drive snapshot backups with 30-day retention, guarded sync operations, cancellation, and cleanup warnings.
- English and Spanish localization with device-language detection and persistent explicit language selection.
- Light, dark, and system appearance with persistent preferences, live system-theme changes, and pre-render theme application.
- Public bilingual privacy and terms pages, available without unlocking or JavaScript and accessible offline.
- Domain-driven vertical slices, Clean Architecture, typed constructor dependency injection, aggregates, entities, value objects, domain events, and committed-event coordination through `@schorts/shared-kernel`.
- Unit and desktop/mobile browser coverage for finance, storage, encryption, customization, localization, appearance, legal pages, and mocked Google Drive workflows.
