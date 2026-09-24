const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth, requireRole, requireOwnStudentOrLecturer } = require('../middleware/auth');
const { idempotent } = require('../utils/idempotency');
const { assignStudentToGroup, AssignmentError } = require('../services/groupAssignment');
const {
  validateStudentName,
  validateStudentNumber,
  validateProgramCode,
  validateGroupCode,
} = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

const STUDENT_SELECT = `
  SELECT s.student_id, s.student_number, s.student_name, s.status, s.version,
         p.program_code, g.group_code, s.created_at, s.updated_at
  FROM students s
  JOIN programmes p ON p.program_id = s.program_id
  LEFT JOIN lab_groups g ON g.group_id = s.group_id
`;

/**
 * GET /api/students
 * Lecturer only. Combines search (name or number) with programme and
 * group filters, including an explicit "Unassigned" option, and paginates.
 */
router.get('/', requireRole('lecturer'), async (req, res) => {
  const { search, program_code, group_code, page = '1', page_size = '20' } = req.query;

  const where = [`s.status = 'active'`];
  const params = {};

  if (search) {
    where.push(`(s.student_name LIKE :search OR s.student_number LIKE :searchExact)`);
    params.search = `%${search}%`;
    params.searchExact = `%${search}%`;
  }
  if (program_code) {
    const check = validateProgramCode(program_code);
    if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });
    where.push(`p.program_code = :programCode`);
    params.programCode = check.value;
  }
  if (group_code) {
    if (group_code === 'UNASSIGNED') {
      where.push(`s.group_id IS NULL`);
    } else {
      const check = validateGroupCode(group_code);
      if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });
      where.push(`g.group_code = :groupCode`);
      params.groupCode = check.value;
    }
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(page_size, 10) || 20));
  params.limit = pageSize;
  params.offset = (pageNum - 1) * pageSize;

  const whereClause = where.join(' AND ');
  const [rows] = await pool.query(
    `${STUDENT_SELECT} WHERE ${whereClause} ORDER BY s.student_name LIMIT :limit OFFSET :offset`,
    params
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM students s
     JOIN programmes p ON p.program_id = s.program_id
     LEFT JOIN lab_groups g ON g.group_id = s.group_id
     WHERE ${whereClause}`,
    params
  );

  res.json({ page: pageNum, page_size: pageSize, total, students: rows });
});

/** GET /api/students/me — the signed-in student's own profile + group occupancy. */
router.get('/me', requireRole('student'), async (req, res) => {
  const [rows] = await pool.query(`${STUDENT_SELECT} WHERE s.student_id = :id`, { id: req.user.studentId });
  const student = rows[0];
  if (!student) return res.status(404).json({ error: 'NOT_FOUND', message: 'Profile not found' });

  let occupancy = null;
  if (student.group_code) {
    const [[{ activeCount, capacity }]] = await pool.query(
      `SELECT COUNT(s2.student_id) AS activeCount, g.capacity AS capacity
       FROM lab_groups g LEFT JOIN students s2 ON s2.group_id = g.group_id AND s2.status = 'active'
       WHERE g.group_code = :code GROUP BY g.capacity`,
      { code: student.group_code }
    );
    occupancy = { active_count: activeCount, capacity };
  }
  res.json({ ...student, group_occupancy: occupancy });
});

/** GET /api/students/:studentId — lecturer: any student; student: own record only. */
router.get('/:studentId', requireOwnStudentOrLecturer('studentId'), async (req, res) => {
  const [rows] = await pool.query(`${STUDENT_SELECT} WHERE s.student_id = :id`, { id: req.params.studentId });
  if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found' });
  res.json(rows[0]);
});

/**
 * POST /api/students
 * Lecturer only — creates a new student profile (e.g. ahead of the
 * student self-registering) and a matching claim code so the real
 * student can later link an account to this exact profile.
 */
router.post('/', requireRole('lecturer'), idempotent, async (req, res) => {
  const { student_name, student_number, program_code, group_code } = req.body;

  const nameCheck = validateStudentName(student_name);
  if (!nameCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: nameCheck.error });
  const numberCheck = validateStudentNumber(student_number);
  if (!numberCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: numberCheck.error });
  const programCheck = validateProgramCode(program_code);
  if (!programCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: programCheck.error });
  const groupCheck = validateGroupCode(group_code);
  if (!groupCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: groupCheck.error });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[program]] = await conn.query(
      `SELECT program_id FROM programmes WHERE program_code = :code`,
      { code: programCheck.value }
    );

    let groupId = null;
    if (groupCheck.value) {
      const [groupRows] = await conn.query(
        `SELECT group_id, capacity FROM lab_groups WHERE group_code = :code FOR UPDATE`,
        { code: groupCheck.value }
      );
      const group = groupRows[0];
      const [[{ activeCount }]] = await conn.query(
        `SELECT COUNT(*) AS activeCount FROM students WHERE group_id = :id AND status = 'active'`,
        { id: group.group_id }
      );
      if (activeCount >= group.capacity) {
        await conn.rollback();
        return res.status(409).json({ error: 'GROUP_FULL', message: 'Selected group is already at capacity; profile kept Unassigned' });
      }
      groupId = group.group_id;
    }

    const studentId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
       VALUES (:id, :num, :name, :programId, :groupId, 'active', 1)`,
      { id: studentId, num: numberCheck.value, name: nameCheck.value, programId: program.program_id, groupId }
    );

    const claimCode = `CLAIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await conn.query(
      `INSERT INTO claim_codes (claim_code, student_number) VALUES (:code, :num)`,
      { code: claimCode, num: numberCheck.value }
    );

    await conn.query(
      `INSERT INTO sync_events (student_id, event_type, event_version, event_payload)
       VALUES (:id, 'created', 1, :payload)`,
      { id: studentId, payload: JSON.stringify({ source: 'lecturer_entry' }) }
    );

    await conn.commit();
    res.status(201).json({ student_id: studentId, claim_code: claimCode });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE_STUDENT_NUMBER', message: 'That student number is already in use or reserved' });
    }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not create student' });
  } finally {
    conn.release();
  }
});

/**
 * PUT /api/students/:studentId
 * Lecturer: may edit name, programme, and (via /group-transfer) group.
 * Student: may edit only their own name and programme — never their own
 * student_number or group (those go through dedicated, guarded routes).
 */
router.put('/:studentId', requireOwnStudentOrLecturer('studentId'), idempotent, async (req, res) => {
  const { student_id: studentId } = req.params;
  const { student_name, program_code, expected_version } = req.body;
  const isLecturer = req.user.role === 'lecturer';

  if (!isLecturer && ('student_number' in req.body || 'group_code' in req.body)) {
    return res.status(403).json({
      error: 'FORBIDDEN_FIELD',
      message: 'Students cannot edit student_number or group directly; use the correction/group-request routes',
    });
  }

  const updates = {};
  if (student_name !== undefined) {
    const check = validateStudentName(student_name);
    if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });
    updates.student_name = check.value;
  }
  if (program_code !== undefined) {
    const check = validateProgramCode(program_code);
    if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });
    const [[program]] = await pool.query(`SELECT program_id FROM programmes WHERE program_code = :c`, { c: check.value });
    updates.program_id = program.program_id;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No editable fields supplied' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT version, status FROM students WHERE student_id = :id FOR UPDATE`,
      { id: studentId }
    );
    const student = rows[0];
    if (!student) { await conn.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found' }); }
    if (student.status !== 'active') { await conn.rollback(); return res.status(409).json({ error: 'STUDENT_DELETED', message: 'Student record is deleted' }); }
    if (expected_version !== undefined && student.version !== expected_version) {
      await conn.rollback();
      return res.status(409).json({
        error: 'VERSION_CONFLICT',
        message: 'Record changed since your edit was proposed',
      });
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
    await conn.query(
      `UPDATE students SET ${setClauses}, version = version + 1, updated_at = NOW() WHERE student_id = :id`,
      { ...updates, id: studentId }
    );
    await conn.commit();
    res.json({ student_id: studentId, version: student.version + 1, updated: updates });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Update failed' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/students/:studentId/group-transfer
 * Lecturer assigns/transfers; a student may request their own transfer,
 * subject to the same capacity rule. Delegates to the locking service
 * in services/groupAssignment.js.
 */
router.post('/:studentId/group-transfer', requireOwnStudentOrLecturer('studentId'), idempotent, async (req, res) => {
  const { group_code, expected_version } = req.body;
  const check = validateGroupCode(group_code);
  if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });

  try {
    const result = await assignStudentToGroup(req.params.studentId, check.value, expected_version ?? null);
    res.json(result);
  } catch (err) {
    if (err instanceof AssignmentError) {
      const statusByCode = {
        STUDENT_NOT_FOUND: 404,
        GROUP_NOT_FOUND: 404,
        STUDENT_NOT_ACTIVE: 409,
        GROUP_FULL: 409,
        VERSION_CONFLICT: 409,
      };
      return res.status(statusByCode[err.code] || 400).json({ error: err.code, message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Group transfer failed' });
  }
});

/**
 * DELETE /api/students/:studentId
 * Lecturer only, with confirmation handled client-side before calling
 * this. Soft delete: hide the record, release its group place exactly
 * once, disable its account, and keep the row (with a deletion marker
 * and its number) so it can never be silently re-registered.
 */
router.delete('/:studentId', requireRole('lecturer'), idempotent, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT status, version FROM students WHERE student_id = :id FOR UPDATE`,
      { id: req.params.studentId }
    );
    const student = rows[0];
    if (!student) { await conn.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found' }); }
    if (student.status === 'deleted') {
      // Already deleted — repeated deletion releases only one place, so
      // this is a no-op success, not a second release.
      await conn.commit();
      return res.json({ student_id: req.params.studentId, status: 'deleted', message: 'Already deleted' });
    }

    const newVersion = student.version + 1;
    await conn.query(
      `UPDATE students SET status = 'deleted', group_id = NULL, deleted_at = NOW(), version = :v
       WHERE student_id = :id`,
      { v: newVersion, id: req.params.studentId }
    );
    await conn.query(`UPDATE accounts SET is_active = 0 WHERE student_id = :id`, { id: req.params.studentId });
    await conn.query(
      `INSERT INTO sync_events (student_id, event_type, event_version, event_payload)
       VALUES (:id, 'deleted', :v, :payload)`,
      { id: req.params.studentId, v: newVersion, payload: JSON.stringify({}) }
    );

    await conn.commit();
    res.json({ student_id: req.params.studentId, status: 'deleted', version: newVersion });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Delete failed' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/students/:studentId/correction-request
 * A student cannot edit their own student_number; they raise a request
 * for a lecturer to action, preserving identity/ownership integrity.
 */
router.post('/:studentId/correction-request', requireOwnStudentOrLecturer('studentId'), requireRole('student'), async (req, res) => {
  const { requested_value } = req.body;
  const check = validateStudentNumber(requested_value);
  if (!check.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: check.error });

  const [rows] = await pool.query(`SELECT student_number FROM students WHERE student_id = :id`, { id: req.params.studentId });
  if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found' });

  const [result] = await pool.query(
    `INSERT INTO correction_requests (student_id, requested_by, field_name, current_value, requested_value)
     VALUES (:id, :accountId, 'student_number', :current, :requested)`,
    { id: req.params.studentId, accountId: req.user.accountId, current: rows[0].student_number, requested: check.value }
  );
  res.status(201).json({ request_id: result.insertId, status: 'pending' });
});

module.exports = router;
