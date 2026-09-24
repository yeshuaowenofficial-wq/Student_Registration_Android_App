# Backend/database team — setup

Covers the ICT361 lab requirements owned by this team: schema and keys,
the locking transaction for the 15-member cap, secure login/registration,
role-based permission checks, validated CRUD, soft deletion, and
search/filter queries. See `API_CONTRACT.md` for the full route list.

## 1. Install

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your local MySQL credentials and a real JWT_SECRET
```

## 2. Create the database

```bash
mysql -u root -p < sql/schema.sql
```

Regenerate the seeded lecturer password hash before loading the seed data
(the placeholder in `sql/seed.sql` will not match `Lecturer#2026`):

```bash
node src/utils/hashSeedPassword.js 'Lecturer#2026'
# paste the printed hash into sql/seed.sql, then:
mysql -u root -p < sql/seed.sql
```

## 3. Run

```bash
npm start
# API on http://localhost:3000
```

Android/Retrofit should point at this host over HTTPS in any deployed
environment (put a TLS-terminating reverse proxy in front for the remote
backend, per the lab's requirement).

## 4. Run the concurrency evidence (Challenge 1)

Point a **disposable** test database at `.env` (e.g. `DB_NAME=student_registration_test`,
schema loaded the same way), then:

```bash
for i in $(seq 1 20); do node --test test/concurrency.test.js || break; done
```

Each run resets the fixture (G01 at 14/15) and fires two simultaneous
`assignStudentToGroup` calls, asserting exactly one succeeds and the final
count is 15. Capture the console output across the 20 runs as submission
evidence.

## Design notes for the demo/questioning

- **Keys**: `students.student_id` is a UUID, generated once and never
  reused — it is the identity Room/foreign keys rely on, independent of
  the human-facing `student_number`. `students.student_number` carries a
  `UNIQUE` constraint that is never lifted, even after soft delete, so a
  released number can't be silently re-registered.
- **Capacity locking**: see `src/services/groupAssignment.js`. The
  `SELECT ... FOR UPDATE` on the target `lab_groups` row is what
  serialises concurrent assignment attempts for that group; the `COUNT`
  taken afterwards in the same transaction is therefore always accurate.
- **Idempotency**: see `src/utils/idempotency.js` and the
  `operation_receipts` table. A retried mutation with the same
  `X-Operation-Id` replays the stored response instead of re-running the
  handler; the same id with different content is rejected.
- **RBAC**: every protected route runs `requireAuth` (verifies the JWT
  and re-checks the account is still active) and, where relevant,
  `requireRole` and `requireOwnStudentOrLecturer`. These checks live on
  the server, not just as hidden buttons in the app.
- **Soft delete**: `DELETE /api/students/:id` sets `status='deleted'`,
  clears `group_id` (releasing the place exactly once — repeating the
  call is a no-op), disables the linked account, and keeps the row (with
  `deleted_at`) so the number stays reserved and a `sync_events` row lets
  offline clients learn about the deletion instead of resurrecting it.
