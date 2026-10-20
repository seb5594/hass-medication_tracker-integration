# Changelog

Versions follow the scheme of the original project: `YYYY.M.D.B`, the release date plus a build
number for the day.

## 2026.10.20.0

- German translation of the setup and options dialogs. The integration is called
  "Medikamentenübersicht" in German.
- The Lovelace card follows the language of the Home Assistant user profile (English and German);
  other languages fall back to English.
- The Lovelace card is served by the integration and loaded into the frontend automatically.
  The file in `config/www` and the dashboard resource are no longer needed and can be removed.
- Requires Home Assistant 2024.7 or newer (`async_register_static_paths`).
- The brand icon is a real PNG now, with an `@2x` variant.
- Releases are built and published as a ZIP by the shared workflow engine.
