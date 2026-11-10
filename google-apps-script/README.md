# Google Sheets backend

This folder contains the Google Apps Script API used by the React family-budget app.

## Source of truth

- Backend source: `Code.gs`
- Manifest: `appsscript.json`
- API version constant: see `API_VERSION` in `Code.gs` (independent of Google's deployment version number)
- Database: Google Sheets
- Runtime: Google Apps Script V8
- Intended timezone: `Europe/Moscow`

The manifest in this repository is version-controlled configuration. It does **not** prove that a live Apps Script project has already been synchronized with it. The actual project timezone, OAuth scopes, web-app execution identity, access level, Script Properties, and deployment version must be checked in the Apps Script editor before any release.

## Safety and deployment

All work in the `ispravleniya` branch is audit/test work. Use a separate test spreadsheet and a test Apps Script project. Do not connect this code to the primary family spreadsheet, change the production deployment, or publish the live Telegram webhook as part of the audit.

The spreadsheet must remain private. The web app may need anonymous HTTP access so the frontend can call it without a Google sign-in; if configured that way, the endpoint is publicly reachable and relies on the application's own authentication and authorization checks. Verify the actual deployment access setting rather than inferring it from this repository.

For safe setup and manual verification steps, see [SETUP.md](SETUP.md).
