// Creates/refreshes the demo accounts with REAL bcrypt hashes so you can log in
// immediately (the hash in sql/seed.sql is only a placeholder).
// Safe to run repeatedly.   Usage:  npm run setup-demo
require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');

const LECTURER = { username: 'lecturer1', password: 'Lecturer#2026', name: 'Dr. Mwansa', avatar: 'dog-1' };
const STUDENT = {
  username: '202408138', password: 'Student#2026', name: 'Chanda Mubanga',
  number: '202408138', program: 'CS', group: 'G01', avatar: 'cat-1',
};

async function main() {
  // Lecturer account
  const lecHash = await bcrypt.hash(LECTURER.password, 12);
  await pool.query(
    `INSERT INTO accounts (student_id, username, display_name, avatar, password_hash, role, is_active)
     VALUES (NULL, :u, :n, :a, :h, 'lecturer', 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name),
                             role = 'lecturer', is_active = 1`,
    { u: LECTURER.username, n: LECTURER.name, a: LECTURER.avatar, h: lecHash }
  );

  // Student profile + account
  const [existing] = await pool.query(`SELECT student_id FROM students WHERE student_number = :n`, { n: STUDENT.number });
  let studentId = existing[0] && existing[0].student_id;
  if (!studentId) {
    studentId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
       VALUES (:id, :num, :name,
               (SELECT program_id FROM programmes WHERE program_code = :p),
               (SELECT group_id FROM lab_groups WHERE group_code = :g), 'active', 1)`,
      { id: studentId, num: STUDENT.number, name: STUDENT.name, p: STUDENT.program, g: STUDENT.group }
    );
  }
  const stuHash = await bcrypt.hash(STUDENT.password, 12);
  await pool.query(
    `INSERT INTO accounts (student_id, username, display_name, avatar, password_hash, role, is_active)
     VALUES (:sid, :u, :n, :a, :h, 'student', 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), is_active = 1`,
    { sid: studentId, u: STUDENT.username, n: STUDENT.name, a: STUDENT.avatar, h: stuHash }
  );

  console.log('Demo accounts ready:');
  console.log(`  Lecturer -> username: ${LECTURER.username}   password: ${LECTURER.password}`);
  console.log(`  Student  -> username: ${STUDENT.username}   password: ${STUDENT.password}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Demo setup failed:', err.message);
  process.exit(1);
});
