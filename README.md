# LifeLink: Organ & Blood Matching System

LifeLink is a web application that connects people who need blood or organs with compatible donors. It is a DBMS-focused project built only with HTML, CSS, JavaScript and SQL. The database is SQLite, running in the browser through [sql.js](https://github.com/sql-js/sql.js), so no server or installation is needed.

## Features

- **Public donor search.** Anyone can pick a patient's blood group (and optionally a city) and see compatible donors ranked by exact group, then compatible groups, then city. No login is required.
- **Contact and requests.** A seeker leaves a name and phone number to receive the selected donors' contact details, or posts an open request that compatible donors see on their dashboard.
- **Request tracking.** A seeker can check the status of a request, or cancel it, using the request number and phone number.
- **Donor accounts.** Donors register with a name, email and password, then complete and edit their profile (blood group, organ, age, city, phone) and set their availability.
- **Donation approval.** Donors record donations, and the administrator approves or rejects them. Approved donations update the blood stock automatically.
- **Blood stock.** Stock per blood group with OK, LOW and OUT status. Fulfilling a blood request deducts stock.
- **Admin dashboard.** Statistics, charts, critical requests, request and donor management, password reset, an audit log, database export and system reset.
- **Privacy.** Passwords are stored as salted SHA-256 hashes. Search results show only a donor's first name and last initial, and a donor's phone number is revealed only after the seeker provides their own contact details.

## Live demo

https://ritamonisonowal2.github.io/lifelink/

## Getting started

### Requirements

A modern web browser (Chrome, Edge or Firefox). No installation, server or internet connection is needed to run the project.

### Run locally

```bash
git clone https://github.com/ritamonisonowal2/lifelink.git
cd lifelink
```

Then open `index.html` in your browser.

To serve the project over HTTP instead:

- **Windows:** run `start-server.bat`, then open `http://127.0.0.1:8931`.
- **macOS / Linux:** run `python3 -m http.server 8931` in the project folder, then open `http://127.0.0.1:8931`.

### First use

The database is created automatically and starts empty, apart from the blood-compatibility reference table.

1. Open **Login** and choose **Set up the administrator account**.
2. Create the administrator account. You are taken to the admin dashboard.
3. Donors register from **Donate**. Seekers can search without an account.

### Resetting data

Data is stored in the browser's local storage, separately for each browser and each address (`file://` and `http://` are different). To clear everything, open `reset.html`.

## Technologies

| Layer | Technology |
|---|---|
| Structure | HTML5 |
| Styling | CSS3 |
| Logic | JavaScript (no framework) |
| Database | SQLite via sql.js, with SQL for the schema, queries, triggers and views |
| Charts | Chart.js |

## Database design

### Tables

| Table | Purpose |
|---|---|
| `Users` | Login accounts (donor or admin) |
| `Donor` | Donor profile, one-to-one with `Users` |
| `Request` | Blood and organ requests |
| `CompatibilityRule` | Which donor blood groups can give to which recipient groups |
| `BloodStock` | Units per blood group |
| `Donation` | Donations with a status of pending, approved or rejected |
| `DonationMatch` | Links requests to matched donors (many-to-many) |
| `AuditLog` | Record of stock and request-status changes |

### Triggers

- `trg_stock_on_donation` adds units to stock when a donation is approved.
- `trg_stock_on_fulfilment` deducts units from stock when a blood request is fulfilled.
- `trg_audit_stock` logs every stock change.
- `trg_audit_request` logs every request status change.

### Views

- `vw_stock_status` labels each blood group as OK, LOW or OUT.
- `vw_critical_requests` lists active critical requests.
- `vw_donor_group_summary` counts donors per blood group.

### Constraints

Primary and foreign keys, `UNIQUE` emails, `NOT NULL` fields, and `CHECK` constraints on age (18 to 65), phone length, blood groups, organs, urgency, request status, donation status and non-negative stock.

### Key query

`searchDonors()` in `js/db.js` joins `Donor`, `Users` and `CompatibilityRule`, orders results by match quality, city and age, and uses `NOT EXISTS` to skip donors already linked to an open request.

The full schema is in `docs/schema.sql`, and the normalization steps (1NF to 3NF) are in `docs/normalization.md`.

## Project structure

```
index.html            Home page with live statistics
find.html             Donor search, contact, request tracking
register.html         Donor sign-up (and one-time admin setup)
login.html            Login
donor.html            Donor dashboard
admin.html            Admin dashboard
reset.html            Clears all data in the current browser
start-server.bat      Optional local server (Windows)
css/                  style.css, theme-editorial.css
js/                   db.js, auth.js, ui.js, find.js, donor.js, admin.js
vendor/               sql-asm.js (sql.js), chart.umd.min.js (Chart.js)
server/               serve.ps1 used by start-server.bat
docs/                 schema.sql, normalization.md
```

## Limitations

- Data is stored per browser and is not shared between devices, because the project uses no server.
- Passwords are hashed in the browser, which is suitable for a student project but not for production use.
- Donors and hospitals are not independently verified.
- This is an academic prototype and is not intended for real medical emergencies.