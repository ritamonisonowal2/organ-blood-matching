# Normalization — from a flat form to 3NF

This document shows how the system's data design was normalized **from an
unnormalized paper request-form table up to Third Normal Form (3NF)** — the
final tables used in `schema.sql`.

---

## Step 0 — Unnormalized form (UNF)

Imagine recording every request on one paper-style sheet, exactly as a clerk
would fill it from a phone call:

**REQUEST_RECORD**

| request_ref | hospital_name | hospital_city | hospital_phone | blood_group | units | urgency | donor_names | donor_groups | donor_phones | donation_dates |
|---|---|---|---|---|---|---|---|---|---|---|
| R-101 | City Care | Bengaluru | 9876500001 | O− | 2 | critical | Isha Kapoor; Arjun Reddy | O−; B− | 9876500010; 9876500011 | 02 Nov; 03 Nov |

**Problems:** `donor_names`, `donor_groups`, `donor_phones`, `donation_dates`
hold *multiple values in one cell* (repeating groups). One row cannot be
searched, counted or joined reliably.

---

## Step 1 — First Normal Form (1NF): atomic values, no repeating groups

**Rule:** every cell holds exactly one value; each row is unique.

Split the multi-valued donor list into one row per donor, adding a key
`request_id` and a donor identifier:

**REQUEST_1NF** (key: `request_id` + `donor_id`)

| request_id | hospital_name | hospital_city | hospital_phone | blood_group | units | urgency | donor_id | donor_name | donor_group | donor_city | donor_phone | donation_date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 101 | City Care | Bengaluru | 9876500001 | O− | 2 | critical | D-10 | Isha Kapoor | O− | Mumbai | 9876500010 | 02 Nov |
| 101 | City Care | Bengaluru | 9876500011 | O− | 2 | critical | D-11 | Arjun Reddy | B− | Hyderabad | 9876500011 | 03 Nov |

✔ Atomic cells. ✘ Still redundant: hospital and request facts repeat on every donor row.

---

## Step 2 — Second Normal Form (2NF): no partial dependencies

**Rule:** with a composite key (`request_id`, `donor_id`), every non-key column
must depend on the **whole** key.

- `hospital_name`, `blood_group`, `units`, `urgency` … depend **only on
  `request_id`** → *partial dependency*.
- `donor_name`, `donor_group`, `donor_city` … depend **only on `donor_id`** → *partial dependency*.
- `donation_date` depends on **both** → stays.

Split into three tables:

**REQUEST** (key: `request_id`)

| request_id | hospital_name | hospital_city | hospital_phone | blood_group | units | urgency |
|---|---|---|---|---|---|---|
| 101 | City Care | Bengaluru | 9876500001 | O− | 2 | critical |

**DONOR** (key: `donor_id`)

| donor_id | donor_name | donor_group | donor_city | donor_phone |
|---|---|---|---|---|
| D-10 | Isha Kapoor | O− | Mumbai | 9876500010 |
| D-11 | Arjun Reddy | B− | Hyderabad | 9876500011 |

**DONATION_MATCH** (key: `request_id` + `donor_id`)

| request_id | donor_id | donation_date |
|---|---|---|
| 101 | D-10 | 02 Nov |
| 101 | D-11 | 03 Nov |

✔ No partial dependencies. ✘ Hospital city/phone still repeat for every request.

---

## Step 3 — Third Normal Form (3NF): no transitive dependencies

**Rule:** no non-key column may depend on another non-key column.

In `REQUEST`: `hospital_city` and `hospital_phone` depend on `hospital_name`,
not directly on `request_id` → **transitive dependency**.
`request_id → hospital_name → (city, phone)`.

Move hospital facts to their own table and reference it by a foreign key:

**HOSPITAL** (key: `hospital_id`)

| hospital_id | hospital_name | city | phone |
|---|---|---|---|
| H-1 | City Care | Bengaluru | 9876500001 |

**REQUEST (3NF)** (key: `request_id`, FK: `hospital_id`)

| request_id | hospital_id | type | blood_group | units | urgency | status |
|---|---|---|---|---|---|---|
| 101 | H-1 | blood | O− | 2 | critical | pending |

✔ Every non-key attribute now depends on *the key, the whole key, and nothing but the key*.

**Same fix applied to the donor side:** donor `blood_group` / `city` / `phone`
depend only on `donor_id`, so `DONOR` holds them once, and login data (email,
password, role) lives in a separate `USERS` table (1:1) — one responsibility
per table.

---

> **Design note (v4):** the walkthrough above uses a separate `HOSPITAL` table to show
> a transitive dependency. In the final system hospitals are **not accounts** — anyone can
> raise a request without logging in — so the place name is just an optional attribute of the
> request (`hospital_name`), stored together with the seeker's name and phone, which describe
> *that one request*. Seekers have no account, so these details are deliberately kept on the
> `Request` row. The 3NF split that remains is `Users` (login) vs `Donor` (profile), and
> `DonationMatch` (the donors linked to a request).

## Final 3NF design (as implemented)

| Table | Purpose | Key constraints |
|---|---|---|
| `Users` | Login accounts | `email UNIQUE`, `role CHECK` |
| `Donor` | Donor profile (1:1 Users) | `CHECK` age 18–65, group, organ |
| `Request` | Blood/organ requests raised by the public (no login) | `CHECK` phone/units/urgency/status |
| `CompatibilityRule` | Who can give to whom | `UNIQUE (recipient, donor)` |
| `BloodStock` | Units per group | `CHECK units >= 0` |
| `Donation` | Donations given | FK → Donor; fires stock trigger |
| `DonationMatch` | M:N request ↔ donors | FKs + `UNIQUE` pair |

Derived data (total units per group) is **not stored redundantly** in many
places — `BloodStock.units` is maintained by the two **TRIGGERs**, and
summaries are computed with `GROUP BY` **VIEWs** instead of duplicated columns.
