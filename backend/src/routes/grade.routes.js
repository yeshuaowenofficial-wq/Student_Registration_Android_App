const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/grades/me — student: all of their own grades. */
router.get('/me', requireRole('student'), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.grade_id, g.grade_value, g.recorded_at, c.course_code, c.course_name
     FROM grades g JOIN courses c ON c.course_id = g.course_id
     WHERE g.student_id = :studentId ORDER BY c.course_code`,
    { studentId: req.user.studentId }
  );
  res.json({ grades: rows });
});

/** GET /api/grades?course_id=&student_id= — lecturer roster/filter view. */
router.get('/', requireRole('lecturer'), async (req, res) => {
  const where = [];
  const params = {};
  if (req.query.course_id) { where.push('g.course_id = :courseId'); params.courseId = req.query.course_id; }
  if (req.query.student_id) { where.push('g.student_id = :studentId'); params.studentId = req.query.student_id; }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT g.grade_id, g.student_id, s.student_name, g.course_id, c.course_code,
            g.grade_value, g.recorded_at
     FROM grades g
     JOIN students s ON s.student_id = g.student_id
     JOIN courses c ON c.course_id = g.course_id
     ${whereClause} ORDER BY c.course_code, s.student_name`,
    params
  );
  res.json({ grades: rows });
});

/**
 * POST /api/grades — lecturer only. Upsert: one grade per (student, course) —
 * posting again for the same pair overwrites the previous value (no history kept).
 * body: { student_id, course_id, grade_value }
 */
router.post('/', requireRole('lecturer'), async (req, res) => {
  const { student_id, course_id, grade_value } = req.body;

  if (!student_id || !course_id) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'student_id and course_id are required' });
  }
  if (!grade_value || typeof grade_value !== 'string' || grade_value.trim().length === 0 || grade_value.length > 10) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'grade_value is required and must be 1-10 characters' });
  }

  const [[student]] = await pool.query(`SELECT status FROM students WHERE student_id = :id`, { id: student_id });
  if (!student) return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student does not exist' });
  if (student.status !== 'active') return res.status(409).json({ error: 'STUDENT_NOT_ACTIVE', message: 'Student record is deleted' });

  const [[course]] = await pool.query(`SELECT course_id FROM courses WHERE course_id = :id`, { id: course_id });
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND', message: 'Course does not exist' });

  await pool.query(
    `INSERT INTO grades (student_id, course_id, grade_value, recorded_by)
     VALUES (:studentId, :courseId, :value, :recordedBy)
     ON DUPLICATE KEY UPDATE grade_value = :value, recorded_by = :recordedBy, recorded_at = NOW()`,
    { studentId: student_id, courseId: course_id, value: grade_value.trim(), recordedBy: req.user.accountId }
  );

  res.status(200).json({ student_id, course_id, grade_value: grade_value.trim() });
});

module.exports = router;
