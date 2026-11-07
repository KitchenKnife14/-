# Google Sheets backend

This folder contains the Google Apps Script API used by the React family-budget app.

## Current backend

- Source: `Code.gs`
- API version: **11**
- Database: Google Sheets
- Runtime: Google Apps Script Web App
- Spreadsheet: `Семейный бюджет`
- Time zone: `Europe/Moscow`

The script must be bound to the intended spreadsheet and deployed as a Web App executing as the script owner. The spreadsheet itself must remain private. Application authentication, session checks, and family-level access validation are enforced by the Apps Script API.

## Release branch and deployment

The current implementation is maintained in `work/final-features-performance` and reviewed through PR #8. The main website's Production deployment has not yet been switched to this release. Do not update the Production branch or deploy the live webhook until the test backend, two-user access isolation, CRUD operations, and Telegram flow have been verified.

For step-by-step setup and safe deployment instructions, see [SETUP.md](SETUP.md).