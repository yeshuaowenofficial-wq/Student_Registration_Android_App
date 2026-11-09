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
});

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
const GROUP_CODE_RE = /^G\d{2,3}$/i;

/**
 * POST /api/groups — lecturer creates a new lab group (e.g. G15, G16) with up to 15 max capacity.
 * body: { group_code, capacity: 1..15, program_code: 'CS'|'IT'|'ITED', schedule_day, start_time, end_time, room }
 */
router.post('/', requireRole('lecturer'), async (req, res) => {
  const { group_code, capacity, program_code, schedule_day, start_time, end_time, room } = req.body;
  const code = String(group_code || '').trim().toUpperCase();
  if (!GROUP_CODE_RE.test(code)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'group_code must be formatted like G15 (G followed by 2-3 digits)' });
  }
  const capNum = capacity !== undefined ? parseInt(capacity, 10) : 15;
  if (Number.isNaN(capNum) || capNum < 1 || capNum > 15) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Group capacity must be between 1 and 15 members maximum' });
  }
  if (!VALID_DAYS.includes(schedule_day)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `schedule_day must be one of ${VALID_DAYS.join(', ')}` });
  }
  if (!TIME_RE.test(start_time || '') || !TIME_RE.test(end_time || '')) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time and end_time must be HH:MM (24h)' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'end_time must be after start_time' });
  }
  let roomValue = typeof room === 'string' ? room.trim() : '';
  const prog = ['CS', 'IT', 'ITED'].includes(program_code) ? program_code : null;
  if (prog && roomValue && !/^(CS|IT|ITED)\s*[\-]/i.test(roomValue)) {
    roomValue = `${prog} - ${roomValue}`;
  }
  roomValue = roomValue.slice(0, 60) || null;

  try {
    await pool.query(
      `INSERT INTO lab_groups (group_code, capacity, schedule_day, start_time, end_time, room)
       VALUES (:code, :cap, :d, :s, :e, :r)`,
      { code, cap: capNum, d: schedule_day, s: start_time, e: end_time, r: roomValue }
    );
    res.status(201).json({
      group_code: code,
      capacity: capNum,
      active_count: 0,
      schedule_day,
      start_time,
      end_time,
      room: roomValue
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE_GROUP_CODE', message: `Lab group ${code} already exists` });
    }
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not create lab group' });
  }
});

/**
 * PUT /api/groups/:groupCode/schedule — lecturer edits a group's weekly lab slot.
 * body: { schedule_day: 'MON'..'SAT', start_time: 'HH:MM', end_time: 'HH:MM', room }
 */
router.put('/:groupCode/schedule', requireRole('lecturer'), async (req, res) => {
  const groupCode = String(req.params.groupCode || '').trim().toUpperCase();
  const { schedule_day, start_time, end_time, room } = req.body;
  const day = String(schedule_day || '').trim().toUpperCase().slice(0, 3);
  if (!VALID_DAYS.includes(day)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `schedule_day must be one of ${VALID_DAYS.join(', ')}` });
  }

  // Normalize time to HH:MM format (handles HH:MM and HH:MM:SS)
  const normTime = (t) => {
    if (!t) return '';
    const m = String(t).trim().match(/^([01]\d|2[0-3]):[0-5]\d/);
    return m ? m[0] : '';
  };
  const sTime = normTime(start_time);
  const eTime = normTime(end_time);

  if (!sTime || !eTime) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start_time and end_time must be HH:MM (24h format)' });
  }
  if (sTime >= eTime) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'end_time must be after start_time' });
  }
  const roomValue = typeof room === 'string' ? room.trim().slice(0, 60) : null;
  const [result] = await pool.query(
    `UPDATE lab_groups SET schedule_day = :d, start_time = :s, end_time = :e, room = :r WHERE UPPER(group_code) = :g`,
    { d: day, s: sTime, e: eTime, r: roomValue || null, g: groupCode }
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No such lab group' });
  res.json({ group_code: groupCode, schedule_day: day, start_time: sTime, end_time: eTime, room: roomValue });
});

/**
 * POST /api/groups/request-change — student submits a formal request to change their lab group.
 * Appears directly on the lecturer's notification & request tab.
 */
router.post('/request-change', requireRole('student'), async (req, res) => {
  const { requested_group, reason } = req.body;
  const targetCode = String(requested_group || '').trim().toUpperCase();
  if (!targetCode || (targetCode !== 'UNASSIGNED' && !GROUP_CODE_RE.test(targetCode))) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid target group (e.g. G01-G15 or UNASSIGNED) is required' });
  }
  if (targetCode !== 'UNASSIGNED') {
    const [[exists]] = await pool.query(`SELECT group_id FROM lab_groups WHERE group_code = :c`, { c: targetCode });
    if (!exists) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: `Target group ${targetCode} does not exist` });
    }
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

/** POST /api/groups/corrections/:requestId/resolve — lecturer approves, rejects, or reassigns to another group. */
router.post('/corrections/:requestId/resolve', requireRole('lecturer'), async (req, res) => {
  const { decision, target_group } = req.body; // 'approved' | 'rejected' | 'reassign' | 'reassigned'
  if (!['approved', 'rejected', 'reassign', 'reassigned'].includes(decision)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'decision must be approved, rejected, or reassign' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM correction_requests WHERE request_id = :id AND status = 'pending' FOR UPDATE`,
      { id: req.params.requestId }
    );
    const request = rows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No pending request with that id' });
    }

    const finalStatus = (decision === 'rejected') ? 'rejected' : 'approved';
    let assignedGroup = null;

    if (decision === 'approved' || decision === 'reassign' || decision === 'reassigned') {
      const [[student]] = await conn.query(
        `SELECT version FROM students WHERE student_id = :id FOR UPDATE`,
        { id: request.student_id }
      );
      if (!student) {
        await conn.rollback();
        return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student record not found' });
      }

      if (request.field_name === 'student_number') {
        await conn.query(
          `UPDATE students SET student_number = :num, version = :v, updated_at = NOW() WHERE student_id = :id`,
          { num: request.requested_value, v: student.version + 1, id: request.student_id }
        );
      } else if (request.field_name === 'group_code') {
        const chosenTarget = (target_group || request.requested_value || '').trim().toUpperCase();
        if (!chosenTarget || (chosenTarget !== 'UNASSIGNED' && !GROUP_CODE_RE.test(chosenTarget))) {
          await conn.rollback();
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid target group is required' });
        }
        assignedGroup = chosenTarget;
        let targetGroupId = null;
        if (chosenTarget !== 'UNASSIGNED') {
          const [[grp]] = await conn.query(`SELECT group_id, capacity FROM lab_groups WHERE UPPER(group_code) = :c FOR UPDATE`, { c: chosenTarget });
          if (!grp) {
            await conn.rollback();
            return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: `Target group ${chosenTarget} not found` });
          }
          const [[{ count }]] = await conn.query(`SELECT COUNT(*) as count FROM students WHERE group_id = :gid AND status = 'active'`, { gid: grp.group_id });
          if (count >= grp.capacity) {
            await conn.rollback();
            return res.status(409).json({ error: 'GROUP_FULL', message: `Group ${chosenTarget} is full (max ${grp.capacity})` });
          }
          targetGroupId = grp.group_id;
        }
        await conn.query(
          `UPDATE students SET group_id = :gid, version = :v, updated_at = NOW() WHERE student_id = :id`,
          { gid: targetGroupId, v: student.version + 1, id: request.student_id }
        );
        if (assignedGroup && assignedGroup !== request.requested_value) {
          await conn.query(
            `UPDATE correction_requests SET requested_value = :g WHERE request_id = :id`,
            { g: assignedGroup, id: req.params.requestId }
          );
        }
      }
    }

    await conn.query(
      `UPDATE correction_requests SET status = :status, resolved_by = :by, resolved_at = NOW() WHERE request_id = :id`,
      { status: finalStatus, by: req.user.accountId, id: req.params.requestId }
    );

    await conn.commit();
    res.json({
      request_id: req.params.requestId,
      status: finalStatus,
      decision,
      assigned_group: assignedGroup
    });
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
