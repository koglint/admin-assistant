# Admin Assistant Frontend

This repository contains the browser-based admin dashboard for the Attendance Assistant project. It is a static web app built with plain HTML, CSS, and JavaScript and is designed to be hosted on GitHub Pages.

The frontend does three main jobs:

1. Authenticates the user with Google through Firebase Authentication.
2. Reads and updates student attendance data in Firestore.
3. Sends attendance spreadsheet uploads to the Flask backend for parsing.

## How The App Fits Together

The full system is split into two repositories:

- This repo, `Admin-assistant`, is the user interface.
- The companion repo, `admin-assistant-backend`, accepts uploaded Excel files and writes structured truancy data into Firestore.

The browser talks to two external services:

- Firebase Auth and Firestore, configured in [`firebase.js`](./firebase.js)
- The Render-hosted upload API at `https://admin-assistant-backend.onrender.com/upload`

Because this app is static, almost all business logic lives in the page scripts.

## Page Overview

### `index.html`

This is the launcher home page.

What it does:

- Prompts staff to sign in with Google.
- Shows the main action cards used to move through the workflow.

### `upload-data.html` + `main.js`

This page handles attendance uploads.

What it does:

- Lets the user upload a Sentral `.xls` or `.xlsx` absence export.
- Sends the file to the backend `POST /upload` endpoint using `FormData`.
- Shows a processing summary returned by the backend.
- No longer asks the user to decide whether the file is a midday or end-of-day upload.

The backend now decides what the file proves from the spreadsheet contents themselves:

- late-to-school rows are identified from roll-call absence entries
- same-day versus next-day detention is decided from the student arrival time compared with first break
- repeated uploads for the same report date are allowed
- detention absence checks stay pending until a later report contains enough day coverage to resolve them

### `late-data.html` + `main.js`

This page shows the current late-arrivals table.

The late-data flow is:

1. The user chooses an attendance file.
2. `main.js` sends it to the backend `POST /upload` endpoint using `FormData`.
3. The backend parses the spreadsheet and updates Firestore.
4. On success, the frontend reloads the current truancy list from Firestore.

### `detentions.html` + `detentions.js`

This page is used to manage detention follow-up.

What it does:

- Loads all students with truancy records.
- Shows latest late date, total truancy count, detention count, and current resolution status.
- Lets staff select multiple students and mark them as present for detention.
- Lets staff manually toggle `truancyResolved`.
- Lets staff undo a detention mark.
- Lets staff hide served students or hide escalated students from the table.

Important data fields used on this page:

- `detentionsServed`
- `lastDetentionServedDate`
- `truancyResolved`
- `escalated`

### `reports.html` + `reports.js`

This page exports report data from Firestore.

What it does:

- Loads student summary data from Firestore.
- Lets the user choose:
  - simple or detailed output
  - roll-class or surname sorting
  - PDF or Excel export
- Builds grouped roll-class exports when roll sorting is selected.

Libraries used on this page:

- `jsPDF`
- `jspdf-autotable`
- `SheetJS`

### `escalated.html` + `escalated.js`

This page handles manual escalation.

What it does:

- Loads all students from Firestore.
- Shows the currently escalated students.
- Lets the user search by student name or roll class.
- Lets the user set `escalated: true` or `escalated: false` on a student document.

### `admin.html` + `admin.js`

This page contains protected admin controls.

What it does:

- Requires normal Google sign-in first.
- Only allows the signed-in emails `troy.koglin1@det.nsw.edu.au` or `troy.koglin1@education.nsw.gov.au`.
- Requires a second admin password, but the password itself is checked on the Render backend rather than stored in frontend code.
- Exposes a purge action that deletes every student document in the `students` Firestore collection through a backend endpoint.
- Uses a second confirmation step where the user must type `DELETE`.
- Sends the user’s Firebase ID token to the backend so the server can verify that the user is logged in before purging.

Important note:

- The frontend no longer stores the real admin password and no longer deletes Firestore data directly. The secure purge is controlled by the backend.

## Firestore Data Shape

The app expects a `students` collection where each document ID is the student ID from the attendance spreadsheet.

Typical document shape:

```json
{
  "givenName": "Jane",
  "surname": "Citizen",
  "rollClass": "10.2",
  "truancyCount": 2,
  "truancyResolved": false,
  "detentionsServed": 1,
  "lastDetentionServedDate": "2026-04-01",
  "notes": "",
  "escalated": false,
  "truancies": [
    {
      "date": "2026-03-31",
      "description": "unjustified late arrival",
      "comment": "",
      "justified": false,
      "resolved": false,
      "explainer": "",
      "explainerSource": "",
      "detentionIssued": false,
      "arrivalTime": "09:04",
      "minutesLate": 29
    }
  ]
}
```

Notes:

- The frontend treats `truancyResolved` as the source of truth for whether the current case is resolved.
- Individual truancy records are displayed in the details table, but page-level workflow is based on the student document status.

## Authentication And Access

Google sign-in is handled in [`firebase.js`](./firebase.js) using Firebase Authentication.

Each page follows the same basic pattern:

1. Wait for `onAuthStateChanged`.
2. If logged in, show the page content.
3. If logged out, hide page content and show the sign-in button.

This means the app assumes access control is primarily enforced through Firebase project configuration and Firestore security rules.

## Local Development

This project is static, so you can open the HTML files directly, but using a local server is usually smoother for module loading and browser consistency.

Simple option with Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

When testing uploads locally, make sure the backend URL in [`main.js`](./main.js) points to a live backend instance that has access to the same Firebase project.

## Deployment

This repo is set up well for GitHub Pages or any static hosting platform.

Deployment expectations:

- HTML pages are served as static files.
- `firebase.js` contains the Firebase web config.
- `main.js` points uploads to the Render backend URL.
- `admin.js` points secure purge requests to the Render backend URL.

If you change the backend host, update the `BACKEND_URL` constant in [`main.js`](./main.js).
If you change the backend host, also update the `ADMIN_PURGE_URL` constant in [`admin.js`](./admin.js).

## Key Files

- [`index.html`](./index.html): home page and upload screen
- [`main.js`](./main.js): current truancy list and upload flow
- [`detentions.html`](./detentions.html): detention tracking page
- [`detentions.js`](./detentions.js): detention workflow logic
- [`reports.html`](./reports.html): report export UI
- [`reports.js`](./reports.js): PDF/Excel export logic
- [`escalated.html`](./escalated.html): escalated students page
- [`escalated.js`](./escalated.js): escalation search and update logic
- [`admin.html`](./admin.html): admin control page
- [`admin.js`](./admin.js): admin password gate and purge workflow
- [`firebase.js`](./firebase.js): Firebase setup
- [`style.css`](./style.css): shared styling

## Typical Workflow

1. Sign in on the home page.
2. Upload a fresh attendance spreadsheet on the Upload Attendance Data page.
3. Review unresolved late arrivals on the View Late Data page.
4. Move to the Detentions page to record served detentions.
5. Use the Escalated page for students needing manual escalation.
6. Use the Reports page to export summaries for staff use.
7. Use the Admin page only for protected maintenance actions such as a full student-data purge.

## Maintenance Notes

- Keep the frontend Firebase config aligned with the Firebase project used by the backend service account.
- Keep the backend upload URL current if the Render service name or domain changes.
- If the spreadsheet export format changes, the backend parser will likely need updates before the frontend changes.
