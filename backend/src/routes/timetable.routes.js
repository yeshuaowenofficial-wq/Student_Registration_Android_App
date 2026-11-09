const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * GET /api/timetable — a student sees only slots for courses offered to their
 * programme; a lecturer sees everything (optionally narrowed with ?program_code=).
 */
router.get('/', async (req, res) => {
  const params = {};
  let programFilter = '';

  if (req.user.role === 'student') {
    const [[student]] = await pool.query(`SELECT program_id FROM students WHERE student_id = :id`, { id: req.user.studentId });
    if (!student) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student profile not found' });
    programFilter = 'WHERE cp.program_id = :programId';
    params.programId = student.program_id;
  } else if (req.query.program_code) {
    programFilter = 'WHERE p.program_code = :programCode';
    params.programCode = req.query.program_code;
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT t.timetable_id, t.day_of_week, t.start_time, t.end_time, t.room,
            c.course_id, c.course_code, c.course_name
     FROM timetable t
     JOIN courses c ON c.course_id = t.course_id
     JOIN course_programmes cp ON cp.course_id = c.course_id
     JOIN programmes p ON p.program_id = cp.program_id
     ${programFilter}
     ORDER BY FIELD(t.day_of_week,'MON','TUE','WED','THU','FRI','SAT'), t.start_time`,
    params
  );
  res.json({ timetable: rows });
});

/** POST /api/timetable — lecturer only. body: { course_id, day_of_week, start_time, end_time, room? } */
router.post('/', requireRole('lecturer'), async (req, res) => {
  const { course_id, day_of_week, start_time, end_time, room } = req.body;

  if (!course_id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'course_id is required' });
  if (!VALID_DAYS.includes(day_of_week)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `day_of_week must be one of ${VALID_DAYS.join(', ')}` });
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(start_time || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(end_time || '')) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time and end_time must be HH:MM (24h)' });
  }

  const [[course]] = await pool.query(`SELECT course_id FROM courses WHERE course_id = :id`, { id: course_id });
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND', message: 'Course does not exist' });

  const [result] = await pool.query(
    `INSERT INTO timetable (course_id, day_of_week, start_time, end_time, room)
     VALUES (:courseId, :day, :start, :end, :room)`,
    { courseId: course_id, day: day_of_week, start: start_time, end: end_time, room: room || null }
  );
  res.status(201).json({ timetable_id: result.insertId });
});

/** DELETE /api/timetable/:timetableId — lecturer only. */
router.delete('/:timetableId', requireRole('lecturer'), async (req, res) => {
  const [result] = await pool.query(`DELETE FROM timetable WHERE timetable_id = :id`, { id: req.params.timetableId });
  if (result.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Timetable slot not found' });
  res.json({ timetable_id: req.params.timetableId, deleted: true });
});

module.exports = router;
