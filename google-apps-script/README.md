# Google Sheets backend

This folder contains the Google Apps Script backend for the existing React budget app.

## Deployment notes

- Bind the script to the spreadsheet named `Семейный бюджет`.
- Deploy as a Web app, executing as the script owner.
- Restrict access through the app's own authentication and session token checks; do not publish spreadsheet edit access.
- Development continues on `audit/backend-upsert-guards`; `main` and Production remain untouched until the owner explicitly approves release.

The API must preserve the existing app's data model and provide authenticated access for two family members. It should not be treated as ready for deployment until authentication, access isolation, and CRUD operations are tested.
