const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** GET /api/groups — list groups with live occupancy counts + weekly lab slot (any signed-in user). */
router.get('/', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT g.group_code, g.capacity, COUNT(s.student_id) AS active_count,
           g.schedule_day, TIME_FORMAT(g.start_time, '%H:%i') AS start_time,
           TIME_FORMAT(g.end_time, '%H:%i') AS end_time, g.room
    FROM lab_groups g
    LEFT JOIN students s ON s.group_id = g.group_id AND s.status = 'active'
    GROUP BY g.group_id, g.group_code, g.capacity, g.schedule_day, g.start_time, g.end_time, g.room
    ORDER BY g.group_code
  `);
  res.json({ groups: rows });
/** GET /api/groups/:groupCode/members — list active peers enrolled in a given lab group (accessible to both students and lecturers). */
router.get('/:groupCode/members', async (req, res) => {
  const { groupCode } = req.params;
  const [rows] = await pool.query(`
    SELECT s.student_id, s.student_number, s.student_name, p.program_code, g.group_code, a.avatar
    FROM students s
    JOIN programmes p ON p.program_id = s.program_id
    JOIN lab_groups g ON g.group_id = s.group_id
    LEFT JOIN accounts a ON a.student_id = s.student_id
    WHERE g.group_code = :groupCode AND s.status = 'active'
    ORDER BY s.student_name
  `, { groupCode });

  res.json({ group_code: groupCode, members: rows });
});

const VALID_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * PUT /api/groups/:groupCode/schedule — lecturer edits a group's weekly lab slot.
 * body: { schedule_day: 'MON'..'SAT', start_time: 'HH:MM', end_time: 'HH:MM', room }
 */
router.put('/:groupCode/schedule', requireRole('lecturer'), async (req, res) => {
  const { schedule_day, start_time, end_time, room } = req.body;
  if (!VALID_DAYS.includes(schedule_day)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `schedule_day must be one of ${VALID_DAYS.join(', ')}` });
  }
  if (!TIME_RE.test(start_time || '') || !TIME_RE.test(end_time || '')) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time and end_time must be HH:MM (24h)' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'end_time must be after start_time' });
  }
  const roomValue = typeof room === 'string' ? room.trim().slice(0, 60) : null;
  const [result] = await pool.query(
    `UPDATE lab_groups SET schedule_day = :d, start_time = :s, end_time = :e, room = :r WHERE group_code = :g`,
    { d: schedule_day, s: start_time, e: end_time, r: roomValue || null, g: req.params.groupCode }
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No such lab group' });
  res.json({ group_code: req.params.groupCode, schedule_day, start_time, end_time, room: roomValue });
});

/**
 * POST /api/groups/request-change — student submits a formal request to change their lab group.
 * Appears directly on the lecturer's notification & request tab.
 */
router.post('/request-change', requireRole('student'), async (req, res) => {
  const { requested_group, reason } = req.body;
  if (!requested_group || !['G01', 'G02', 'G03', 'G04', 'UNASSIGNED'].includes(requested_group)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid target group (G01-G04 or UNASSIGNED) is required' });
  }

  const [studentRows] = await pool.query(
    `SELECT s.student_id, s.student_name, s.student_number, g.group_code
     FROM students s
     LEFT JOIN lab_groups g ON g.group_id = s.group_id
     WHERE s.student_id = :id`,
    { id: req.user.studentId }
  );
  const st = studentRows[0];
  if (!st) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student record not found' });

  const currentGroup = st.group_code || 'UNASSIGNED';
  if (currentGroup === requested_group) {
    return res.status(400).json({ error: 'SAME_GROUP', message: 'You are already in group ' + requested_group });
  }

  const desc = reason ? `Group change from ${currentGroup} to ${requested_group}: ${reason.slice(0, 100)}` : `Group change from ${currentGroup} to ${requested_group}`;

  const [result] = await pool.query(
    `INSERT INTO correction_requests (student_id, requested_by, field_name, current_value, requested_value)
     VALUES (:id, :accountId, 'group_code', :current, :requested)`,
    { id: req.user.studentId, accountId: req.user.accountId, current: currentGroup, requested: requested_group }
  );

  res.status(201).json({ request_id: result.insertId, status: 'pending', requested_group });
});

/** GET /api/groups/pending-corrections — lecturer queue of student requests (group transfers & number corrections). */
router.get('/pending-corrections', requireRole('lecturer'), async (req, res) => {
  const [rows] = await pool.query(`
    SELECT r.request_id, r.student_id, s.student_name, s.student_number, r.field_name, r.current_value, r.requested_value, r.created_at
    FROM correction_requests r JOIN students s ON s.student_id = r.student_id
    WHERE r.status = 'pending' ORDER BY r.created_at DESC
  `);
  res.json({ requests: rows });
});

/** POST /api/groups/corrections/:requestId/resolve — lecturer approves or rejects. */
router.post('/corrections/:requestId/resolve', requireRole('lecturer'), async (req, res) => {
  const { decision } = req.body; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'decision must be approved or rejected' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM correction_requests WHERE request_id = :id AND status = 'pending' FOR UPDATE`,
      { id: req.params.requestId }
    );
    const request = rows[0];
    if (!request) { await conn.rollback(); return res.status(404).json({ error: 'NOT_FOUND', message: 'No pending request with that id' }); }

    if (decision === 'approved') {
      const [[student]] = await conn.query(
        `SELECT version FROM students WHERE student_id = :id FOR UPDATE`,
        { id: request.student_id }
      );

      if (request.field_name === 'student_number') {
        await conn.query(
          `UPDATE students SET student_number = :num, version = :v, updated_at = NOW() WHERE student_id = :id`,
          { num: request.requested_value, v: student.version + 1, id: request.student_id }
        );
      } else if (request.field_name === 'group_code') {
        const targetGroup = request.requested_value;
        let targetGroupId = null;
        if (targetGroup !== 'UNASSIGNED') {
          const [[grp]] = await conn.query(`SELECT group_id, capacity FROM lab_groups WHERE group_code = :c FOR UPDATE`, { c: targetGroup });
          if (!grp) { await conn.rollback(); return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Target group not found' }); }
          const [[{ count }]] = await conn.query(`SELECT COUNT(*) as count FROM students WHERE group_id = :gid AND status = 'active'`, { gid: grp.group_id });
          if (count >= grp.capacity) {
            await conn.rollback();
            return res.status(409).json({ error: 'GROUP_FULL', message: `Group ${targetGroup} is full (max ${grp.capacity})` });
          }
          targetGroupId = grp.group_id;
        }
        await conn.query(
          `UPDATE students SET group_id = :gid, version = :v, updated_at = NOW() WHERE student_id = :id`,
          { gid: targetGroupId, v: student.version + 1, id: request.student_id }
        );
      }
    }

    await conn.query(
      `UPDATE correction_requests SET status = :status, resolved_by = :by, resolved_at = NOW() WHERE request_id = :id`,
      { status: decision, by: req.user.accountId, id: req.params.requestId }
    );

    await conn.commit();
    res.json({ request_id: req.params.requestId, status: decision });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE_STUDENT_NUMBER', message: 'That student number is already taken' });
    }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not resolve request' });
  } finally {
    conn.release();
  }
});

module.exports = router;
