const fs = require('fs');
const path = require('path');
const pool = require('../db');

/**
 * Automatically ensures the MySQL database has all 15 groups (G01..G15),
 * nullable student_number for duplicate-ID students left without an ID,
 * and all 224 students from the updated spreadsheet.
 */
async function autoSyncSpreadsheet() {
  try {
    const seedPath = path.join(__dirname, '../../sql/v2.0_seed_data.json');
    if (!fs.existsSync(seedPath)) return;
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    // 1. Allow NULL student_number for duplicate-ID students kept without an ID
    await pool.query(`ALTER TABLE students MODIFY COLUMN student_number CHAR(9) NULL`).catch(() => {});

    // 2. Ensure programmes exist
    await pool.query(`
      INSERT INTO programmes (program_id, program_code, program_name) VALUES
        (1, 'CS', 'Computer Science'),
        (2, 'IT', 'Information Technology'),
        (3, 'ITED', 'ICT with Education')
      ON DUPLICATE KEY UPDATE program_name = VALUES(program_name)
    `);

    // 3. Upsert all 15 lab groups (G01..G15) strictly enforcing 15/15 max capacity
    for (const g of data.groups) {
      await pool.query(`
        INSERT INTO lab_groups (group_id, group_code, capacity, schedule_day, start_time, end_time, room)
        VALUES (:id, :code, 15, :day, :start, :end, :room)
        ON DUPLICATE KEY UPDATE
          capacity = 15,
          schedule_day = COALESCE(schedule_day, VALUES(schedule_day)),
          start_time = COALESCE(start_time, VALUES(start_time)),
          end_time = COALESCE(end_time, VALUES(end_time)),
          room = COALESCE(room, VALUES(room))
      `, {
        id: g.id,
        code: g.code,
        day: g.day,
        start: g.start,
        end: g.end,
        room: g.room
      });
    }

    // 4. Remove old synthetic duplicate IDs if present
    await pool.query(`DELETE FROM students WHERE student_number IN ('202407016', '202403847')`).catch(() => {});

    // 5. Upsert all 224 students from the spreadsheet (16th-slot overflow students have group = null -> UNASSIGNED)
    for (const s of data.students) {
      const grpId = s.group ? parseInt(String(s.group).replace('G', ''), 10) : null;
      await pool.query(`
        INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
        VALUES (:uuid, :num, :name, :progId, :grpId, 'active', 1)
        ON DUPLICATE KEY UPDATE
          student_number = VALUES(student_number),
          student_name = VALUES(student_name),
          program_id = VALUES(program_id),
          group_id = VALUES(group_id),
          status = 'active'
      `, {
        uuid: s.uuid,
        num: s.studentNo || null,
        name: s.name,
        progId: s.programId,
        grpId: grpId
      });
    }

    console.log(`[DB Auto-Sync] Synced ${data.groups.length} lab groups (G01-G15) and ${data.students.length} students.`);
  } catch (err) {
    console.warn('[DB Auto-Sync] Skipped or deferred:', err.message);
  }
}

module.exports = { autoSyncSpreadsheet };
