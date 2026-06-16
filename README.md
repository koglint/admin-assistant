# Admin Assistant Frontend

This repository contains the browser-based admin dashboard for the Attendance Assistant project. It is a static web app built with plain HTML, CSS, and JavaScript and is designed to be hosted on GitHub Pages.

The frontend does three main jobs:

1. Authenticates the user with Google through Firebase Authentication.
2. Reads and updates student attendance data in Firestore.
3. Sends attendance spreadsheet uploads to the Flask backend for parsing.

## TL;DR

This section is the fast refresher for when you come back to the project later and remember the broad idea, but not the details.

### What the whole system does

The app tracks students who arrive late to school, assigns detention follow-up, and records whether detention was served.

The project has two parts:

- `Admin-assistant`: the static frontend UI hosted on GitHub Pages
- `admin-assistant-backend`: the Flask backend hosted on Render that parses spreadsheet uploads and writes Firestore records

### What gets uploaded

Staff upload a Sentral attendance export in `.xls` or `.xlsx` format.

The upload goes to the backend, not directly to Firestore. The Upload Attendance Data page has two modes:

- `Morning Late Arrivals`: use the daily morning absence export. The backend records late arrivals, assigns detentions, and writes attendance-day evidence.
- `Attendance Confirmation Only`: use full-day or full-week absence data after detention rolls are marked. The backend updates attendance-day evidence and confirms missed detentions, but skips new late-arrival and detention creation.

### What counts as a late arrival

The backend treats a row as a late-to-school case only when it looks like a missed roll-call absence row:

- `Shorthand` is not one of `S`, `F`, `E`, `B`, `L`, or `M`
- `Description` is not one of `Sick`, `Flexible`, `Suspended`, `School Business`, `Leave`, or `Exempt`
- `Shorthand` is `U` with `Description` `Unjustified`, or `Shorthand` is `?` with `Description` `Absent`
- the `Time` column contains a valid start and end time
- the start of the time range is `8:00AM` or `8:25AM`
- the end of the time range is strictly after `8:35AM`

So the system is not trying to ingest every attendance code. It is specifically looking for late-to-school cases inferred from roll-call absence rows.

### How the key values are calculated

- `arrivalTime`: taken from the right side of the spreadsheet `Time` range
- `minutesLate`: calculated against `8:35AM`
- `lateCount`: total stored late-arrival records for that student
- `activeDetention`: the current open detention, if one exists
- `detentionsServed`: how many detentions have been marked as completed
- resolved/pending display state: derived from whether `activeDetention.status` is `open`

### How detention scheduling works

When a new late arrival is added, the backend creates a detention if the student does not already have one open.

Detention date logic:

- Tuesday late arrivals move to Wednesday because Tuesday detention runs at first break
- Monday, Wednesday, Thursday, and Friday arrivals before first break can be same-day detention
- Monday, Wednesday, Thursday, and Friday arrivals from first break onward move to the next school day

First-break cutoff:

- Tuesday and Thursday: `10:25AM`
- Monday, Wednesday, Friday: `10:35AM`

### How detention attendance works

The Detentions page is where staff record that a student has successfully completed detention.

That page:

- loads students with late-arrival history
- allows filtering by year, search text, and served state
- lets staff tick students and mark `Successfully Completed Detention`
- increments `detentionsServed`
- clears `activeDetention`

If a detention was marked incorrectly, the page can undo the last served entry.

### How pending detention checks work

If a student is marked absent from detention, the backend does not immediately assume they skipped detention unfairly.

Instead, it waits for an `Attendance Confirmation Only` upload with full-day coverage for the detention date. The backend uses the absence export conservatively:

- no absence row for that student/date means the student is treated as present all day and available for detention
- any absence row for that student/date means the student is not safely counted as present during detention

If there is no absence row, `missedWhilePresentCount` is recalculated from confirmed missed-detention history.

### How the website is normally used

Typical daily flow:

1. Sign in with the school Google account.
2. Use the blue `Morning Late Arrivals` upload with today's morning Sentral absence export.
3. Use the Mark Detention Roll page during detention to mark students who successfully complete detention.
4. Use the green `Attendance Confirmation Only` upload with full-day or weekly absence data to confirm missed detentions.
5. Use Reports when a formal export is needed.

### What to remember before changing anything

- The frontend reads and writes Firestore directly for most day-to-day actions.
- The backend is the source of truth for spreadsheet parsing and automatic status calculation.
- Firestore field changes affect both repos.
- If the Sentral export changes, the backend parser is the first place to inspect.

## In-Depth

This section is the full handover explanation for a developer who needs to understand the system, maintain it, and safely extend it.

### Architecture and responsibilities

The project is deliberately split into a thin frontend and a logic-heavy backend.

Frontend responsibilities:

- authenticate staff with Firebase Authentication
- show workflow pages for uploads, detentions, reports, and admin tasks
- read student records from Firestore
- write direct user-driven updates to Firestore for actions such as marking detention served
- send uploaded spreadsheets to the backend

Backend responsibilities:

- parse Sentral spreadsheets
- decide whether a row represents a late-to-school event
- calculate arrival times and late minutes
- create or update late-arrival records
- assign or re-schedule detentions
- evaluate whether detention absences should count as missed while present
- recalculate resolution state from the current detention status
- provide the secure admin purge endpoint

This means frontend bugs usually affect presentation, workflow, or direct manual actions, while backend bugs usually affect the core attendance logic and automatic state calculation.

### Data flow from spreadsheet to UI

The end-to-end upload flow works like this:

1. A user signs in on the frontend.
2. On `upload-data.html`, the user uploads a Sentral spreadsheet.
3. `main.js` sends the file to `POST /upload` on the Flask backend using `FormData`.
4. The backend reads the workbook into memory and normalizes the spreadsheet columns.
5. The backend builds structured report rows.
6. The backend filters those rows to late-to-school roll-call events.
7. The backend updates the relevant student documents in Firestore.
8. The frontend reloads from Firestore and shows the new state.

The frontend does not parse the spreadsheet itself. It only shows upload summaries, reads Firestore for workflow pages, and performs manual workflow actions.

### Spreadsheet parsing rules

The backend expects spreadsheet columns including:

- `Student ID`
- `Given Name(s)`
- `Surname`
- `Roll Class`
- `Date`
- `Time`
- `Shorthand`
- `Description`
- `Comment`
- `Explainer`
- `Explainer Source`

The parser normalizes:

- student identity fields
- date values
- year values
- time range values
- optional source columns used by the backend parser

If those spreadsheet headers change, parsing will likely break or silently mis-classify records.

### Student document model

The main Firestore collection is `students`.

Document ID:

- the student ID from the spreadsheet

Important top-level fields:

- `givenName`, `surname`, `rollClass`, `yearGroup`
- `lateArrivals`
- `lateCount`
- `activeDetention`
- `detentionsServed`
- `detentionHistory`
- audit fields such as `updatedAt`, `updatedBy`, `lastAction`

### Late-arrival record model

Each late-arrival entry can contain:

- `date`
- `description`
- `justified`
- `arrivalTime`
- `minutesLate`
- `shorthand`
- `yearGroup`

The current duplicate rule is date-based: if the student already has a late record for the same date, a second one is not added. That is simple and works for the current use case, but it would need redesign if multiple distinct same-day late events ever had to be preserved separately.

### Detention lifecycle

The detention lifecycle is the most important domain workflow in the project.

When a new late-arrival record is added:

- the backend checks whether the student already has an open detention
- if not, it creates `activeDetention`
- the detention stores the late date it came from, the scheduled detention date, and tracking fields such as `missedWhilePresentCount`

When detention is served from the frontend:

- `detentions.js` updates the student document in Firestore
- `detentionsServed` increases
- a `served` item is appended to `detentionHistory`
- `activeDetention` is cleared

When a served detention is undone:

- the frontend removes the latest served history entry
- reduces `detentionsServed`
- recreates an `activeDetention`

### Pending attendance evaluation for missed detention

If detention attendance cannot be decided immediately, the backend can leave a detention waiting for later evidence from an upload that covers the detention date.

The backend checks later uploads conservatively:

- no absence row for the student/date means present at school and therefore missed detention while at school
- any absence row for the student/date means the missed detention is not counted and the student gets another chance

If the student was present:

- `missedWhilePresentCount` is recalculated from confirmed history
- a `missed_while_present` history event is written
- `attendanceEvidence` is set to `no_absence_row_full_day_coverage`
- the detention is moved to the next school day

If any absence row was recorded:

- a `not_counted_absence_recorded` history event is written
- `attendanceEvidence` is set to `absence_row_recorded_not_counted`
- the detention is also re-scheduled

### Frontend page-by-page logic

`index.html`

- signed-out state shows a large sign-in button and a short instruction
- signed-in state shows the main action buttons and sign-out

`upload-data.html` + `main.js`

- handles spreadsheet uploads
- displays the backend processing summary

`detentions.html` + `detentions.js`

- used during detention to mark students who complete detention
- supports bulk selection, filtering, undo, and view statistics

`reports.html` + `reports.js`

- loads student data and exports summary, missed detention, and history reports
- uses `jsPDF`, `jspdf-autotable`, and `SheetJS`

`admin.html` + `admin.js`

- performs protected admin tasks
- currently centers on secure purge authorization and deletion

### Authentication and authorization model

Normal page access depends on Firebase Authentication in the frontend.

Each page:

1. waits for `onAuthStateChanged`
2. shows or hides content based on login state

Most normal workflow actions write directly to Firestore from the browser, so Firestore security rules are an important part of the real security model even though they are not documented in this README.

The admin purge path adds an extra backend authorization layer:

- Firebase ID token must be valid
- email must be verified
- email must be in the allowed list
- backend admin password must match
- deletion must be explicitly confirmed with `DELETE`

### How to safely update the project

If you are changing UI only:

- start with the relevant HTML page and its JS file
- check whether the shared CSS already has a reusable pattern
- confirm whether `main.js` is shared by multiple pages before changing it

If you are changing workflow logic:

- identify whether the rule belongs in the frontend or backend
- if the rule comes from attendance data interpretation, put it in the backend
- if the rule is a manual staff action, it may belong in the frontend Firestore update code

If you are changing Firestore fields:

- update both repos
- check all pages that read or write that field
- check exports and status displays

If you are changing spreadsheet assumptions:

- update the backend parser first
- test with a real export
- then verify the frontend pages that depend on the changed fields

### Recommended maintenance checklist for a new developer

When taking over the project, check these first:

1. Confirm the frontend and backend still point to the same Firebase project.
2. Confirm the Render backend URL is still correct in the frontend scripts.
3. Confirm the GitHub Pages origin still matches backend CORS settings.
4. Confirm the Firestore document shape still matches the frontend expectations.
5. Test a real upload and verify:
   - late arrivals are detected
   - detention scheduling looks correct
   - detention completion works
   - missed-detention confirmation works
   - exports still generate
6. Review any recent changes to the Sentral export format before debugging the app logic.

## How The App Fits Together

The full system is split into two repositories:

- This repo, `Admin-assistant`, is the user interface.
- The companion repo, `admin-assistant-backend`, accepts uploaded Excel files and writes structured late-arrival data into Firestore.

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
- Lets the user choose `Morning Late Arrivals` or `Attendance Confirmation Only`.
- Sends the file to the backend `POST /upload` endpoint using `FormData`.
- Shows a processing summary returned by the backend.

The two upload modes are:

- `Morning Late Arrivals`: records late arrivals, assigns/reconciles detentions, and writes attendance-day records.
- `Attendance Confirmation Only`: writes attendance-day records and resolves missed detention checks without creating new late detentions.

The backend still decides what the file proves from the spreadsheet contents:

- late-to-school rows are identified from roll-call absence entries in morning mode
- same-day versus next-day detention is decided from the student arrival time compared with first break
- repeated uploads for the same report date are allowed
- confirmation uploads can contain daily or weekly full-day data
- detention absence checks stay pending until a confirmation upload contains enough day coverage to resolve them

### `detentions.html` + `detentions.js`

This page is used to manage detention follow-up.

What it does:

- Loads all students with late-arrival records.
- Shows latest late date, total late count, detention count, and current resolution status.
- Lets staff select multiple students and mark them as present for detention.
- Marks due students who are not selected as absent from detention.
- Lets staff undo a detention mark.
- Lets staff hide served students from the table.

Important data fields used on this page:

- `detentionsServed`
- `lastDetentionServedDate`
- `activeDetention`

### `reports.html` + `reports.js`

This page exports report data from Firestore.

What it does:

- Loads student summary data from Firestore.
- Lets the user choose PDF or Excel export for reports that support both formats.
- Exports a school-wide summary report.
- Exports missed detention records sorted by missed detention date.
- Exports selected student late-arrival history.

Libraries used on this page:

- `jsPDF`
- `jspdf-autotable`
- `SheetJS`

### `admin.html` + `admin.js`

This page contains protected admin controls.

What it does:

- Requires normal Google sign-in first.
- Only allows approved admin usernames from `admin.js` and the backend to sign in with either `@det.nsw.edu.au` or `@education.nsw.gov.au`.
- Requires a second admin password, but the password itself is checked on the Render backend rather than stored in frontend code.
- Exposes a purge action that deletes every document in the `students`, `attendance_days`, and `uploadTracking` Firestore collections through a backend endpoint.
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
  "lateCount": 2,
  "detentionsServed": 1,
  "lastDetentionServedDate": "2026-04-01",
  "notes": "",
  "lateArrivals": [
    {
      "date": "2026-03-31",
      "description": "unjustified late arrival",
      "justified": false,
      "arrivalTime": "09:04",
      "minutesLate": 29,
      "shorthand": "U",
      "yearGroup": "10"
    }
  ]
}
```

Notes:

- The frontend derives whether the current case is resolved from `activeDetention`.
- Reports and detention roll views use late-arrival records for dates, counts, arrival details, and year fallback.

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

- [`index.html`](./index.html): home page
- [`main.js`](./main.js): authentication and upload flow
- [`detentions.html`](./detentions.html): detention tracking page
- [`detentions.js`](./detentions.js): detention workflow logic
- [`reports.html`](./reports.html): report export UI
- [`reports.js`](./reports.js): PDF/Excel export logic
- [`admin.html`](./admin.html): admin control page
- [`admin.js`](./admin.js): admin password gate and purge workflow
- [`firebase.js`](./firebase.js): Firebase setup
- [`style.css`](./style.css): shared styling

## Typical Workflow

1. Sign in on the home page.
2. Use `Morning Late Arrivals` on the Upload Attendance Data page with today's morning absence export.
3. Move to the Detentions page to record served detentions.
4. Use `Attendance Confirmation Only` with full-day or weekly absence data to confirm missed detentions.
5. Use the Reports page to export summaries for staff use.
6. Use the Admin page only for protected maintenance actions such as a full student-data purge.

## Maintenance Notes

- Keep the frontend Firebase config aligned with the Firebase project used by the backend service account.
- Keep the backend upload URL current if the Render service name or domain changes.
- If the spreadsheet export format changes, the backend parser will likely need updates before the frontend changes.
