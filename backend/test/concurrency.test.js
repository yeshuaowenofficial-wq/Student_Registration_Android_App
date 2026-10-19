// Integration test — requires a real MySQL test database with the schema
// loaded (point DB_NAME at a disposable database, e.g. student_registration_test).
//
// Run: node --test test/concurrency.test.js
//
// What it proves: start G01 with exactly 14 active students, then fire two
// group-transfer requests for the 15th place at the same time. Exactly one
// must succeed; the other must receive GROUP_FULL; the final count must be
// 15, never 16. The assignment above wraps this in the note that the whole
// fixture-reset-and-retry should be repeated 20 times for the submission
// evidence — this file does one run per execution so it can be scripted
// in a shell loop for that repetition.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
require('dotenv').config();
const pool = require('../src/db');
const { assignStudentToGroup } = require('../src/services/groupAssignment');

async function resetFixture() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`DELETE FROM sync_events`);
    await conn.query(`DELETE FROM students`);
    await conn.query(`UPDATE lab_groups SET capacity = 15`);

    const [[{ program_id }]] = await conn.query(`SELECT program_id FROM programmes WHERE program_code = 'CS'`);
    const [[group]] = await conn.query(`SELECT group_id FROM lab_groups WHERE group_code = 'G01'`);

    // Seed 14 active students already in G01.
    const seededIds = [];
    for (let i = 0; i < 14; i++) {
      const id = crypto.randomUUID();
      seededIds.push(id);
      await conn.query(
        `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
         VALUES (:id, :num, :name, :programId, :groupId, 'active', 1)`,
        { id, num: String(100000000 + i), name: `Fixture Student ${i}`, programId: program_id, groupId: group.group_id }
      );
    }

    // Two contenders for the 15th place, currently Unassigned.
    const contenderA = crypto.randomUUID();
    const contenderB = crypto.randomUUID();
    await conn.query(
      `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
       VALUES (:id, :num, :name, :programId, NULL, 'active', 1)`,
      { id: contenderA, num: '900000001', name: 'Contender A', programId: program_id }
    );
    await conn.query(
      `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
       VALUES (:id, :num, :name, :programId, NULL, 'active', 1)`,
      { id: contenderB, num: '900000002', name: 'Contender B', programId: program_id }
    );

    return { contenderA, contenderB };
  } finally {
    conn.release();
  }
}

test('exactly one of two simultaneous requests wins the last group place', async () => {
  const { contenderA, contenderB } = await resetFixture();

  const results = await Promise.allSettled([
    assignStudentToGroup(contenderA, 'G01'),
    assignStudentToGroup(contenderB, 'G01'),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one request should succeed');
  assert.equal(rejected.length, 1, 'exactly one request should fail');
  assert.equal(rejected[0].reason.code, 'GROUP_FULL');

  const [[{ activeCount }]] = await pool.query(
    `SELECT COUNT(*) AS activeCount FROM students s JOIN lab_groups g ON g.group_id = s.group_id
     WHERE g.group_code = 'G01' AND s.status = 'active'`
  );
  assert.equal(activeCount, 15, 'group must contain exactly 15 active students, never 16');
});

test.after(async () => {
  await pool.end();
});
