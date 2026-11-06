# 🩸 LifeLink — Organ & Blood Matching System

A complete DBMS-driven web application that connects **people who need blood or organs** with compatible
**blood and organ donors**. Built with **HTML, CSS, JavaScript and SQL** (SQLite
relational DBMS) — everything runs locally, no internet or server install needed.

---

## ▶ How to run

1. Open the project folder.
2. **Double-click `index.html`** (works in Chrome / Edge / Firefox).
3. That's it — the SQLite database is created automatically inside the browser and
   every change is saved, even after refresh.

> Optional: double-click **`start-server.bat`** instead to serve the site at
> `http://127.0.0.1:8931` — handy for a projector demo. It uses only built-in
> Windows PowerShell, nothing to install.

> Everything runs offline. The database engine (sql.js — SQLite compiled to run in
> the browser) and Chart.js are included in the `vendor/` folder.

### First run — a clean, empty platform

The system ships with **no sample data**: no fake donors, requests, stock or accounts. Only the medical
blood-compatibility reference table is loaded. Everything you see is created through the website itself.

1. Open **Login** → click **Set up the administrator account** (shown only until an admin exists) and create the admin.
2. Donors register from **Become a donor**; seekers search and post requests with no account.
3. Charts and counters stay at zero / show "no data yet" messages until real records exist.

### How it works (like a normal website — no hospital accounts)

1. **Anyone can search, no login.** Pick a blood group (and optionally city) on the home page or **Find Donor** —
   compatible donors appear instantly, ranked: exact group first, same city next.
2. **Contact donors.** The seeker enters their name + phone and gets the donors' numbers. This saves a
   **Request** and links the donors. If nobody is available, the seeker can **post an open request**
   that compatible donors see on their dashboard.
3. **Donors register in 20 seconds** (name, email, password). Inside the dashboard they see who needs them *first*,
   then add blood group, city and age.
4. **The admin** oversees all requests, marks them fulfilled (the **TRIGGER** deducts blood stock), and manages
   donors, stock and analytics.

> Privacy note: a donor's phone number is shown only after a seeker leaves their own contact details,
> and only a first name + last initial is shown in search results.

**Recommended walkthrough (2 minutes):**
0. Create the admin, then register a donor and record a donation from the donor dashboard.
1. Home → choose **B+** → **Find donors now** → tick donors → **Get contact numbers** (no login).
2. Login as admin → set that request to **fulfilled** → the **TRIGGER** deducts blood stock.
3. Admin → charts, low-stock warnings and the critical-request VIEW are live.
4. Register a new donor → see suggestions first, then fill in the details.

---

## ✨ Features → Technologies map

| # | Feature | HTML | CSS | JavaScript | SQL / DBMS |
|---|---------|------|-----|------------|------------|
| 1 | Login / Register (Donor, Admin) | Login & signup forms | Clean layout | Validation, role-based pages | `Users` table, `UNIQUE` + `NOT NULL` constraints |
| 2 | Donor Registration | Registration form | Form styling | Form handling | `INSERT`, `CHECK` constraints (age 18–65, valid group/organ) |
| 3 | Blood Request | Request form, status table | Status colours | Status updates | `Request` table, foreign keys, `CHECK` on units/urgency/status |
| 4 | Auto Matching | Results table | Critical-case highlight | Displays matches | `JOIN` with `CompatibilityRule`, `ORDER BY`, `NOT EXISTS` |
| 5 | Blood Stock | Stock table | Low-stock warning | Refreshes display | `TRIGGER` adds stock on donation & deducts on fulfilment |
| 6 | Dashboard | Cards & charts | Visual design | Draws charts (Chart.js) | `GROUP BY`, `VIEW`s |

## 🗄️ DBMS concepts demonstrated

| Concept | Where it appears |
|---------|------------------|
| **Normalization (1NF → 3NF)** | `docs/normalization.md` — a request record decomposed step by step |
| **Trigger** | `trg_stock_on_donation` (stock ↑ when a donation is inserted) · `trg_stock_on_fulfilment` (stock ↓ when a blood request is fulfilled) |
| **View** | `vw_critical_requests` · `vw_stock_status` · `vw_donor_group_summary` |
| **Constraints** | `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `NOT NULL`, `CHECK` (blood groups, organs, age, units, statuses) |
| **Joins & aggregation** | Auto-matching `JOIN … ORDER BY`, dashboard `GROUP BY`, subqueries with `NOT EXISTS` |

## 📁 Project structure

```
organ-blood-matching/
├── index.html            Landing page (live stats from the DB)
├── login.html            Login (role-based redirect)
├── find.html             Public donor search + contact (no login)
├── register.html         Simple donor sign-up
├── donor.html            Donor dashboard (availability, requests, donations)
├── admin.html            Admin console (charts, tables, tools)
├── start-server.bat      One-click local web server (optional)
├── css/
│   └── style.css         Global design system
├── js/
│   ├── db.js             ★ SQLite schema, constraints, triggers, views, queries
│   ├── auth.js           Session handling & role-based access control
│   ├── ui.js             Shared UI helpers (badges, toasts, modals)
│   ├── donor.js          Donor page logic
│   ├── find.js           Public search page logic
│   └── admin.js          Admin page logic
├── vendor/
│   ├── sql-asm.js        SQLite engine (sql.js, runs 100% in the browser)
│   └── chart.umd.min.js  Chart.js
├── server/
│   └── serve.ps1         Tiny PowerShell web server used by start-server.bat
└── docs/
    ├── schema.sql          Clean DDL for the report
    └── normalization.md    Unnormalized → 1NF → 2NF → 3NF walkthrough
```

## 🧰 Admin tools

- **⬇ Export backup** — downloads the live database as a real SQLite file.
  Open it with the free *DB Browser for SQLite* to screenshot tables for your report.
- **♻ Reset system** — wipes everything (including the admin account) and returns to the brand-new, empty platform.

## ⚠️ Notes

- Data is stored in the browser's `localStorage` **per browser profile**. Clearing
  site data resets the database. Use **Reset system data** (admin) to start over.
- Passwords are stored as salted SHA-256 hashes (never plain text) — appropriate for
  an academic project; a production system would use bcrypt/argon2 on a server.
- The compatibility matrix is seeded medical reference data (WHO blood-group rules).

---

## 🎨 Look & feel (editorial layout)

- `css/theme-editorial.css` — warm cream paper, serif headings, mono labels and dark pill buttons, loaded after `style.css` on every page.
- Navigation tabs are drawn by `renderNavLinks()` in `js/ui.js` (Home · Match · Blood Stock · Requests · Analytics · Dashboard · Register), so they are identical on every page.
- `index.html` — hero card, clickable feature cards, and live sections: Instant Blood Match, Blood Stock, Requests, Analytics.

---
## 🆕 Version 6 changes
- **Donor can edit profile** (✏️ Edit profile on the donor dashboard).
- **Seekers can track and cancel a request** (Find Donor → "Track or cancel my request": request number + phone).
- **Donations need admin approval**: Donation.status = pending/approved/rejected. Stock rises only when the admin approves (trigger `trg_stock_on_donation`).
- **AuditLog table + 2 audit triggers** (`trg_audit_stock`, `trg_audit_request`) record every stock and request-status change; shown in the Admin dashboard.
- Clearer wording on Find Donor (patient's blood group, meaning of rank / "Compatible").
