const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ['present', 'absent', 'late'];

/** GET /api/attendance/me?course_id= — student: own attendance history, optionally one course. */
router.get('/me', requireRole('student'), async (req, res) => {
  const where = ['a.student_id = :studentId'];
  const params = { studentId: req.user.studentId };
  if (req.query.course_id) { where.push('a.course_id = :courseId'); params.courseId = req.query.course_id; }

  const [rows] = await pool.query(
    `SELECT a.attendance_id, a.session_date, a.status, c.course_code, c.course_name
     FROM attendance a JOIN courses c ON c.course_id = a.course_id
     WHERE ${where.join(' AND ')} ORDER BY a.session_date DESC`,
    params
  );
  res.json({ attendance: rows });
});

/**
 * GET /api/attendance?course_id=&date= — lecturer: roster for a course/date, to drive a
 * "mark attendance" screen (shows every active student in the course's programme(s),
 * with their status for that date if already marked, or null if not yet marked).
 */
router.get('/', requireRole('lecturer'), async (req, res) => {
  const { course_id, date } = req.query;
  if (!course_id || !date) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'course_id and date are required query params' });
  }

  const [rows] = await pool.query(
    `SELECT s.student_id, s.student_name, s.student_number, a.status
     FROM students s
     JOIN course_programmes cp ON cp.program_id = s.program_id
     LEFT JOIN attendance a ON a.student_id = s.student_id AND a.course_id = :courseId AND a.session_date = :date
     WHERE cp.course_id = :courseId AND s.status = 'active'
     ORDER BY s.student_name`,
    { courseId: course_id, date }
  );
  res.json({ course_id, session_date: date, roster: rows });
});

/**
 * POST /api/attendance — lecturer only, bulk mark for one course/date in one call
 * (matches a roster-style "mark attendance" screen). One record per (student, course,
 * date) — marking the same day again updates it rather than duplicating.
 * body: { course_id, session_date: "YYYY-MM-DD", records: [{ student_id, status }, ...] }
 */
router.post('/', requireRole('lecturer'), async (req, res) => {
  const { course_id, session_date, records } = req.body;

  if (!course_id || !session_date) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'course_id and session_date are required' });
  }
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'records must be a non-empty array of { student_id, status }' });
  }
  for (const r of records) {
    if (!r.student_id || !VALID_STATUSES.includes(r.status)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `Each record needs student_id and status in ${VALID_STATUSES.join('/')}` });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of records) {
      await conn.query(
        `INSERT INTO attendance (student_id, course_id, session_date, status, recorded_by)
         VALUES (:studentId, :courseId, :date, :status, :recordedBy)
         ON DUPLICATE KEY UPDATE status = :status, recorded_by = :recordedBy, recorded_at = NOW()`,
        { studentId: r.student_id, courseId: course_id, date: session_date, status: r.status, recordedBy: req.user.accountId }
      );
    }
    await conn.commit();
    res.status(200).json({ course_id, session_date, marked: records.length });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not save attendance' });
  } finally {
    conn.release();
  }
});

module.exports = router;
