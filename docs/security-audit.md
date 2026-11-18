# LifeLink security audit

Scope covers the public repository, the app served by Netlify, the linked Railway service, and the LifeLink project in Supabase. Application checks use synthetic local records. The audit covers application authorization and privacy controls, with infrastructure verification reported separately from code verification.

| Severity | Finding in the prior version | Remediation |
| --- | --- | --- |
| Critical | Public, first-use administrator creation depended on browser-local state. Roles and privileged actions were controlled by the browser. | Public registration is donor-only. The operator provisions the administrator on the server. Every admin action independently checks the current server-side session and role. |
| High | Donor records, request records, password hashes, and session state were stored in the browser. | A shared SQLite database lives outside the web root. The server stores per-password salted scrypt hashes and hashed session tokens. Production cookies are Secure, HttpOnly, and SameSite=Strict. Logout and password reset revoke affected sessions. |
| High | A requester could receive donor contact details by supplying an unverified number. Other listing paths could include requester details. | Public results omit contact numbers. Contact exchange requires donor acceptance. Request lookup and cancellation require an unguessable private tracking code. |
| High | The old administrator interface held contact data and constructed inline actions from record fields. | The new interface binds actions via event listeners, escapes displayed input, and uses a Content Security Policy that permits only the existing static scripts and exact inline fragments. |
| Medium | Login, registration and public request workflows lacked server-side input checks and request throttling. | The API validates inputs, caps body size, limits credential verification work and request rates, rejects unapproved browser origins, and uses parameterized database queries. |
| Medium | Public pages and the admin action had different meanings for database reset. | Shared reset requires an authorized admin and typed confirmation. It keeps the provisioned administrator, revokes all sessions, and removes application records in one transaction. The legacy reset page affects old browser data only. |

## Verification

- Local API checks cover donor-only registration, role checks for every admin action, donor account isolation, session revocation, password reset, request tracking, contact consent, stock updates and backup authorization.
- Chrome checks cover operator-provisioned admin login, donor registration and profile setup, redirect away from the admin page, search, request posting and private tracking.
- The Node package has no external server dependencies. Chart.js is a separately vendored browser asset and is outside the scope of the npm package audit. A separate query of the GitHub Advisory Database returned no published matches for Chart.js 4.4.1 at audit time.
- The Supabase public schema contained no application tables. The implementation retains SQLite and moves it to persistent Railway storage. Browser-only legacy records never become server accounts through the deployment.

## Residual risk

The app does not independently verify donor or requester identities, hospital details, or phone ownership, and administrator login uses a password without MFA. Public listings display a limited donor profile and request metadata. Treat backups as sensitive because they contain stored records and authentication hashes. Protected operations should be exercised on production with consented test accounts after cutover, and backup restore should be verified before use with real donor data.
