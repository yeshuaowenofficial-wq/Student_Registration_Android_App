const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * GET /api/courses
 * A student sees only courses offered to their own programme. A lecturer
 * sees everything (optionally narrowed with ?program_code=).
 */
router.get('/', async (req, res) => {
  const params = {};
  let programFilter = '';

  if (req.user.role === 'student') {
    const [[student]] = await pool.query(
      `SELECT program_id FROM students WHERE student_id = :id`,
      { id: req.user.studentId }
    );
    if (!student) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student profile not found' });
    programFilter = 'WHERE cp.program_id = :programId';
    params.programId = student.program_id;
  } else if (req.query.program_code) {
    programFilter = 'WHERE p.program_code = :programCode';
    params.programCode = req.query.program_code;
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT c.course_id, c.course_code, c.course_name, c.lecturer_account_id
     FROM courses c
     JOIN course_programmes cp ON cp.course_id = c.course_id
     JOIN programmes p ON p.program_id = cp.program_id
     ${programFilter}
     ORDER BY c.course_code`,
    params
  );
  res.json({ courses: rows });
});

/** GET /api/courses/:courseId — a single course plus which programmes it's offered to. */
router.get('/:courseId', async (req, res) => {
  const [[course]] = await pool.query(
    `SELECT course_id, course_code, course_name, lecturer_account_id FROM courses WHERE course_id = :id`,
    { id: req.params.courseId }
  );
  if (!course) return res.status(404).json({ error: 'NOT_FOUND', message: 'Course not found' });

  const [programmes] = await pool.query(
    `SELECT p.program_code FROM course_programmes cp
     JOIN programmes p ON p.program_id = cp.program_id WHERE cp.course_id = :id`,
    { id: req.params.courseId }
  );
  res.json({ ...course, program_codes: programmes.map((p) => p.program_code) });
});

/**
 * POST /api/courses — lecturer only.
 * body: { course_code, course_name, program_codes: ["CS","IT"], lecturer_account_id? }
 */
router.post('/', requireRole('lecturer'), async (req, res) => {
  const { course_code, course_name, program_codes, lecturer_account_id } = req.body;

  if (!course_code || typeof course_code !== 'string' || course_code.trim().length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'course_code is required' });
  }
  if (!course_name || typeof course_name !== 'string' || course_name.trim().length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'course_name is required' });
  }
  if (!Array.isArray(program_codes) || program_codes.length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'program_codes must be a non-empty array, e.g. ["CS","IT"]' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO courses (course_code, course_name, lecturer_account_id) VALUES (:code, :name, :lecturerId)`,
      { code: course_code.trim(), name: course_name.trim(), lecturerId: lecturer_account_id || null }
    );
    const courseId = result.insertId;

    for (const code of program_codes) {
      const [[program]] = await conn.query(`SELECT program_id FROM programmes WHERE program_code = :code`, { code });
      if (!program) {
        await conn.rollback();
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: `Unknown program_code: ${code}` });
      }
      await conn.query(
        `INSERT INTO course_programmes (course_id, program_id) VALUES (:courseId, :programId)`,
        { courseId, programId: program.program_id }
      );
    }

    await conn.commit();
    res.status(201).json({ course_id: courseId, course_code, course_name });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE_COURSE_CODE', message: 'That course code already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not create course' });
  } finally {
    conn.release();
  }
});

/** PUT /api/courses/:courseId — lecturer only. Updates name and/or the assigned lecturer. */
router.put('/:courseId', requireRole('lecturer'), async (req, res) => {
  const { course_name, lecturer_account_id } = req.body;
  const updates = {};
  if (course_name !== undefined) updates.course_name = course_name;
  if (lecturer_account_id !== undefined) updates.lecturer_account_id = lecturer_account_id;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No editable fields supplied' });
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
  const [result] = await pool.query(
    `UPDATE courses SET ${setClauses} WHERE course_id = :id`,
    { ...updates, id: req.params.courseId }
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Course not found' });
  res.json({ course_id: req.params.courseId, updated: updates });
});

/** DELETE /api/courses/:courseId — lecturer only. Cascades to its grades/attendance/timetable rows. */
router.delete('/:courseId', requireRole('lecturer'), async (req, res) => {
  const [result] = await pool.query(`DELETE FROM courses WHERE course_id = :id`, { id: req.params.courseId });
  if (result.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Course not found' });
  res.json({ course_id: req.params.courseId, deleted: true });
});

module.exports = router;
