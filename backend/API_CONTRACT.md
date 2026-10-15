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

## Courses, grades, attendance, timetable (added for CampusCompanion's scope)

**Not part of the ICT361 lab brief** — added because the team chose to keep this scope
from the UI/UX work rather than trim it to just registration + groups. See the note at
the top of `sql/02_courses_grades_attendance_timetable.sql` for the simplifications made
(implicit enrollment by programme, any lecturer can manage any course, one current grade
per student/course with no history, one attendance record per student/course/day).

| Method | Route | Role | Request body | Success response | Key errors |
|---|---|---|---|---|---|
| GET | `/api/courses` | any | query: `program_code?` (lecturer only; a student is auto-filtered to their own programme) | `200 { courses[] }` | — |
| GET | `/api/courses/:courseId` | any | — | `200 { course_id, course_code, course_name, lecturer_account_id, program_codes[] }` | `404 NOT_FOUND` |
| POST | `/api/courses` | lecturer | `course_code, course_name, program_codes[], lecturer_account_id?` | `201 { course_id, course_code, course_name }` | `400 VALIDATION_ERROR`, `409 DUPLICATE_COURSE_CODE` |
| PUT | `/api/courses/:courseId` | lecturer | `course_name?, lecturer_account_id?` | `200 { course_id, updated }` | `400 VALIDATION_ERROR`, `404 NOT_FOUND` |
| DELETE | `/api/courses/:courseId` | lecturer | — (cascades to grades/attendance/timetable for this course) | `200 { course_id, deleted: true }` | `404 NOT_FOUND` |
| GET | `/api/grades/me` | student | — | `200 { grades[] }` | — |
| GET | `/api/grades` | lecturer | query: `course_id?, student_id?` | `200 { grades[] }` | — |
| POST | `/api/grades` | lecturer | `student_id, course_id, grade_value` (upsert — overwrites any existing grade for that pair) | `200 { student_id, course_id, grade_value }` | `400 VALIDATION_ERROR`, `404 STUDENT_NOT_FOUND`/`COURSE_NOT_FOUND`, `409 STUDENT_NOT_ACTIVE` |
| GET | `/api/attendance/me` | student | query: `course_id?` | `200 { attendance[] }` | — |
| GET | `/api/attendance` | lecturer | query: `course_id, date` (required) — roster for that course/day, `status: null` if not yet marked | `200 { course_id, session_date, roster[] }` | `400 VALIDATION_ERROR` |
| POST | `/api/attendance` | lecturer | `course_id, session_date, records: [{student_id, status}]` — bulk mark/update for one day | `200 { course_id, session_date, marked }` | `400 VALIDATION_ERROR` |
| GET | `/api/timetable` | any | query: `program_code?` (lecturer only; a student is auto-filtered) | `200 { timetable[] }` | — |
| POST | `/api/timetable` | lecturer | `course_id, day_of_week, start_time, end_time, room?` | `201 { timetable_id }` | `400 VALIDATION_ERROR`, `404 COURSE_NOT_FOUND` |
| DELETE | `/api/timetable/:timetableId` | lecturer | — | `200 { timetable_id, deleted: true }` | `404 NOT_FOUND` |

## Field rules enforced server-side
- `student_name`: 2–100 trimmed characters, letters/accents/ordinary punctuation.
- `student_number`: exactly 9 digits, outer whitespace trimmed, no embedded spaces, leading zeroes kept as a string, globally unique (including soft-deleted rows).
- `program_code`: one of `CS`, `IT`, `DS`.
- `group_code`: one of `G01`–`G04`, or `UNASSIGNED`/`null`.
- Every mutation on `students` bumps `version`; callers proposing an edit against stale data get `409 VERSION_CONFLICT` instead of silently overwriting.
