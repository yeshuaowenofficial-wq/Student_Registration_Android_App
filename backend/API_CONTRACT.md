# API contract — backend/database team

All routes except `/api/auth/*` and `GET /api/health` require
`Authorization: Bearer <token>`. Mutating routes (`POST`/`PUT`/`DELETE`
other than login/register) also require an `X-Operation-Id: <client-uuid>`
header for idempotent retries.

| Method | Route | Role | Request body | Success response | Key errors |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | public | `claim_code, student_name, student_number, program_code, username, password` | `201 { account_id, student_id, role, token }` | `400 VALIDATION_ERROR`, `403 INVALID_CLAIM_CODE`, `403 CLAIM_MISMATCH`, `409 CLAIM_CODE_USED`, `409 STUDENT_NUMBER_RESERVED`, `409 ACCOUNT_EXISTS` |
| POST | `/api/auth/login` | public | `username, password` | `200 { account_id, student_id, role, token }` | `401 INVALID_CREDENTIALS` |
| POST | `/api/auth/logout` | any | — | `200 { message }` | — |
| GET | `/api/students` | lecturer | query: `search, program_code, group_code, page, page_size` | `200 { page, page_size, total, students[] }` | `400 VALIDATION_ERROR` |
| GET | `/api/students/me` | student | — | `200 { ...profile, group_occupancy }` | `404 NOT_FOUND` |
| GET | `/api/students/:studentId` | lecturer (any) / student (own) | — | `200 { ...profile }` | `403 FORBIDDEN`, `404 NOT_FOUND` |
| POST | `/api/students` | lecturer | `student_name, student_number, program_code, group_code` | `201 { student_id, claim_code }` | `400 VALIDATION_ERROR`, `409 DUPLICATE_STUDENT_NUMBER`, `409 GROUP_FULL` |
| PUT | `/api/students/:studentId` | lecturer (any field) / student (name, programme only) | `student_name?, program_code?, expected_version?` | `200 { student_id, version, updated }` | `403 FORBIDDEN_FIELD`, `404 NOT_FOUND`, `409 STUDENT_DELETED`, `409 VERSION_CONFLICT` |
| POST | `/api/students/:studentId/group-transfer` | lecturer (any) / student (own) | `group_code, expected_version?` | `200 { student_id, group_code, version }` | `404 STUDENT_NOT_FOUND`, `404 GROUP_NOT_FOUND`, `409 STUDENT_NOT_ACTIVE`, `409 GROUP_FULL`, `409 VERSION_CONFLICT` |
| DELETE | `/api/students/:studentId` | lecturer | — | `200 { student_id, status: 'deleted', version }` | `404 NOT_FOUND` |
| POST | `/api/students/:studentId/correction-request` | student (own) | `requested_value` | `201 { request_id, status: 'pending' }` | `400 VALIDATION_ERROR`, `404 NOT_FOUND` |
| GET | `/api/groups` | any | — | `200 { groups: [{ group_code, capacity, active_count }] }` | — |
| GET | `/api/groups/pending-corrections` | lecturer | — | `200 { requests[] }` | — |
| POST | `/api/groups/corrections/:requestId/resolve` | lecturer | `decision: 'approved'\|'rejected'` | `200 { request_id, status }` | `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `409 DUPLICATE_STUDENT_NUMBER` |
| GET | `/api/health` | public | — | `200 { status: 'ok' }` | — |

## Field rules enforced server-side
- `student_name`: 2–100 trimmed characters, letters/accents/ordinary punctuation.
- `student_number`: exactly 9 digits, outer whitespace trimmed, no embedded spaces, leading zeroes kept as a string, globally unique (including soft-deleted rows).
- `program_code`: one of `CS`, `IT`, `DS`.
- `group_code`: one of `G01`–`G04`, or `UNASSIGNED`/`null`.
- Every mutation on `students` bumps `version`; callers proposing an edit against stale data get `409 VERSION_CONFLICT` instead of silently overwriting.
