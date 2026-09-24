const pool = require('../db');

// Custom error used so routes can map it to the right HTTP status/code.
class AssignmentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Assigns or transfers a student to a lab group (or to Unassigned when
 * targetGroupCode is null), enforcing the 15-active-student cap even
 * when two requests race for the last place.
 *
 * Why this needs a transaction with row locking, not an app-side count:
 *  - Checking the count in Android/Node and inserting afterwards leaves a
 *    window between "count is 14" and "insert succeeds" where a second
 *    request can read the same stale count and also insert, overfilling
 *    the group. This is a classic check-then-act race.
 *  - Counting and updating in two separate unprotected SQL statements has
 *    the same problem even on the server, because MySQL does not hold any
 *    lock between them.
 *
 * The fix: lock the target group's row with SELECT ... FOR UPDATE first.
 * Every transaction that wants to change that group's membership must
 * wait for the previous one to commit or roll back, so the COUNT taken
 * afterwards, inside the same transaction, is always up to date. This
 * serialises assignment attempts per group without locking unrelated
 * groups or the whole table.
 *
 * @param {string} studentId
 * @param {string|null} targetGroupCode  e.g. 'G01', or null for Unassigned
 * @param {number|null} expectedVersion  optimistic-lock check for synced edits; omit to skip
 * @returns {Promise<{student_id: string, group_code: string|null, version: number}>}
 */
async function assignStudentToGroup(studentId, targetGroupCode, expectedVersion = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the student row so a concurrent edit/delete can't race this transfer.
    const [studentRows] = await conn.query(
      `SELECT student_id, group_id, status, version
       FROM students WHERE student_id = :id FOR UPDATE`,
      { id: studentId }
    );
    const student = studentRows[0];
    if (!student) throw new AssignmentError('STUDENT_NOT_FOUND', 'Student does not exist');
    if (student.status !== 'active') throw new AssignmentError('STUDENT_NOT_ACTIVE', 'Student record is deleted');
    if (expectedVersion !== null && student.version !== expectedVersion) {
      throw new AssignmentError('VERSION_CONFLICT', 'Record has changed since this edit was proposed');
    }

    let targetGroupId = null;

    if (targetGroupCode !== null) {
      // Lock the target GROUP row — this is what serialises concurrent
      // requests for the same group's last place.
      const [groupRows] = await conn.query(
        `SELECT group_id, capacity FROM lab_groups WHERE group_code = :code FOR UPDATE`,
        { code: targetGroupCode }
      );
      const group = groupRows[0];
      if (!group) throw new AssignmentError('GROUP_NOT_FOUND', 'Unknown group code');
      targetGroupId = group.group_id;

      // Already in this group — no-op, avoid double counting.
      if (student.group_id === targetGroupId) {
        await conn.commit();
        return { student_id: studentId, group_code: targetGroupCode, version: student.version };
      }

      const [[{ activeCount }]] = await conn.query(
        `SELECT COUNT(*) AS activeCount FROM students
         WHERE group_id = :groupId AND status = 'active'`,
        { groupId: targetGroupId }
      );

      if (activeCount >= group.capacity) {
        // Failed transfer: retain the previous group, tell the caller why.
        await conn.rollback();
        throw new AssignmentError('GROUP_FULL', 'This group is already at capacity');
      }
    }

    const newVersion = student.version + 1;
    await conn.query(
      `UPDATE students SET group_id = :groupId, version = :newVersion, updated_at = NOW()
       WHERE student_id = :id`,
      { groupId: targetGroupId, newVersion, id: studentId }
    );

    await conn.query(
      `INSERT INTO sync_events (student_id, event_type, event_version, event_payload)
       VALUES (:id, 'group_changed', :version, :payload)`,
      {
        id: studentId,
        version: newVersion,
        payload: JSON.stringify({ group_code: targetGroupCode }),
      }
    );

    await conn.commit();
    return { student_id: studentId, group_code: targetGroupCode, version: newVersion };
  } catch (err) {
    // rollback is a no-op if we already rolled back on GROUP_FULL above
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { assignStudentToGroup, AssignmentError };
