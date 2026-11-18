# LifeLink — Organ & Blood Matching System

LifeLink is an academic donor-matching application with ranked donor search, donor and administrator dashboards, request tracking, and blood stock accounting. Its HTML, CSS, and JavaScript use a same-origin API backed by SQLite on the server.

## Run locally

Requires Node.js 24. Run `npm start` and visit `http://localhost:8931`. Run `npm test` to check authorization, privacy, and the matching and stock workflows. Keep the generated database in `data/` or set `LIFELINK_DB_PATH` to a private path outside the served files.

Public signup creates donor accounts. The first administrator is provisioned by the server operator through `npm run admin`, with `LIFELINK_ADMIN_EMAIL`, `LIFELINK_ADMIN_NAME`, and `LIFELINK_ADMIN_PASSWORD` supplied privately to the command. The command refuses to promote an existing donor or replace an administrator.

## Use LifeLink

- Search for blood or organ matches without an account. Choose donors to contact, or post an open request for compatible donors.
- Save the private tracking code to check or cancel a request. Contact details become available after the donor accepts and consents to share them.
- Register and sign in as a donor to manage your profile, respond to requests, and record donations.
- Sign in as the provisioned administrator to manage requests, review recorded donations, and view the audit log.

The older offline prototype stored data separately in each browser. Its accounts and records stay in the original browser. They are not automatically imported into the shared database, and old accounts must register again.

## Deployment

Railway runs the API and keeps the SQLite database on the persistent volume mounted at `/data`. The service uses one replica and checks `/health` before a deployment becomes active. Netlify builds the static pages and proxies `/api/*` to the Railway HTTPS origin in `netlify.toml`. Keep both production deploys connected to the same release.

Reserve the administrator address with the Railway variable `LIFELINK_ADMIN_EMAIL`. To provision through Railway, the authorized operator can supply `LIFELINK_ADMIN_NAME` and a one-time deployment variable `LIFELINK_ADMIN_PASSWORD`. After the first successful login, remove the password variable and redeploy. Future deploys do not reset the administrator's credentials.

See the [security audit](docs/security-audit.md) for findings and verification scope.

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

`searchDonors()` in `server/database.mjs` joins `Donor`, `Users` and `CompatibilityRule`, orders results by match quality, city and age, and uses `NOT EXISTS` to skip donors already linked to an open request.

The server schema is in `server/schema.sql`, and the normalization steps (1NF to 3NF) are in `docs/normalization.md`.

## Limitations

Donors and hospitals are not independently verified. LifeLink is an academic prototype and is not intended for real medical emergencies.
