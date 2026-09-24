const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { validateStudentName, validateStudentNumber, validateProgramCode } = require('../utils/validate');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '2h';

function issueToken(account) {
  return jwt.sign({ account_id: account.account_id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * POST /api/auth/register
 * Student self-registration with mandatory ownership verification via a
 * claim code. Two cases:
 *  (a) The lecturer already entered this student (claim code is tied to
 *      a student_number) -> link a new account to that EXISTING profile.
 *      Never create a second profile for the same student.
 *  (b) A generic self-service code (not tied to any student_number) ->
 *      create a brand-new profile, Unassigned, then the account.
 */
router.post('/register', async (req, res) => {
  const { claim_code, student_name, student_number, program_code, username, password } = req.body;

  if (!claim_code || typeof claim_code !== 'string') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'claim_code is required' });
  }
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'password must be at least 8 characters' });
  }
  const nameCheck = validateStudentName(student_name);
  if (!nameCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: nameCheck.error });
  const numberCheck = validateStudentNumber(student_number);
  if (!numberCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: numberCheck.error });
  const programCheck = validateProgramCode(program_code);
  if (!programCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: programCheck.error });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [codeRows] = await conn.query(
      `SELECT claim_code, student_number, used_at FROM claim_codes WHERE claim_code = :code FOR UPDATE`,
      { code: claim_code }
    );
    const codeRow = codeRows[0];
    if (!codeRow) {
      await conn.rollback();
      return res.status(403).json({ error: 'INVALID_CLAIM_CODE', message: 'Claim code not recognised' });
    }
    if (codeRow.used_at) {
      await conn.rollback();
      return res.status(409).json({ error: 'CLAIM_CODE_USED', message: 'This claim code has already been used' });
    }
    // If the code was pre-issued for a specific student_number, the caller
    // must supply that exact number — this is the ownership check.
    if (codeRow.student_number && codeRow.student_number !== numberCheck.value) {
      await conn.rollback();
      return res.status(403).json({ error: 'CLAIM_MISMATCH', message: 'Claim code does not match this student number' });
    }

    let studentId;

    const [existingRows] = await conn.query(
      `SELECT student_id, status FROM students WHERE student_number = :num FOR UPDATE`,
      { num: numberCheck.value }
    );
    const existingStudent = existingRows[0];

    if (existingStudent) {
      if (existingStudent.status === 'deleted') {
        await conn.rollback();
        return res.status(409).json({ error: 'STUDENT_NUMBER_RESERVED', message: 'This student number cannot be re-registered' });
      }
      const [existingAccountRows] = await conn.query(
        `SELECT account_id FROM accounts WHERE student_id = :id`,
        { id: existingStudent.student_id }
      );
      if (existingAccountRows.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'ACCOUNT_EXISTS', message: 'An account already exists for this student' });
      }
      // Link to the EXISTING profile the lecturer already created — never
      // create a second profile for the same student.
      studentId = existingStudent.student_id;
    } else {
      // No lecturer-entered record yet: create a fresh profile, Unassigned.
      studentId = crypto.randomUUID();
      const [programRows] = await conn.query(
        `SELECT program_id FROM programmes WHERE program_code = :code`,
        { code: programCheck.value }
      );
      await conn.query(
        `INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version)
         VALUES (:id, :num, :name, :programId, NULL, 'active', 1)`,
        { id: studentId, num: numberCheck.value, name: nameCheck.value, programId: programRows[0].program_id }
      );
      await conn.query(
        `INSERT INTO sync_events (student_id, event_type, event_version, event_payload)
         VALUES (:id, 'created', 1, :payload)`,
        { id: studentId, payload: JSON.stringify({ source: 'self_registration' }) }
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [accountResult] = await conn.query(
      `INSERT INTO accounts (student_id, username, password_hash, role, is_active)
       VALUES (:studentId, :username, :hash, 'student', 1)`,
      { studentId, username: username.trim(), hash: passwordHash }
    );

    await conn.query(
      `UPDATE claim_codes SET used_at = NOW(), used_by_student = :studentId WHERE claim_code = :code`,
      { studentId, code: claim_code }
    );

    await conn.commit();

    const token = issueToken({ account_id: accountResult.insertId });
    return res.status(201).json({
      account_id: accountResult.insertId,
      student_id: studentId,
      role: 'student',
      token,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE', message: 'Username or student number already in use' });
    }
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Registration failed' });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/auth/login
 * Verifies credentials with a constant-shape response so the API never
 * reveals whether the username or the password was wrong.
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'username and password are required' });
  }

  const [rows] = await pool.query(
    `SELECT account_id, student_id, role, password_hash, is_active FROM accounts WHERE username = :username`,
    { username }
  );
  const account = rows[0];

  // Always run a bcrypt compare, even for an unknown username, using a
  // fixed dummy hash — this avoids leaking existence via response timing.
  const hashToCheck = account ? account.password_hash : '$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsal';
  const passwordMatches = await bcrypt.compare(password, hashToCheck);

  if (!account || !passwordMatches || !account.is_active) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect username or password' });
  }

  await pool.query('UPDATE accounts SET last_login_at = NOW() WHERE account_id = :id', { id: account.account_id });

  const token = issueToken(account);
  return res.json({
    account_id: account.account_id,
    student_id: account.student_id,
    role: account.role,
    token,
  });
});

/**
 * POST /api/auth/logout
 * Stateless JWTs can't be revoked server-side without a blacklist; for
 * this lab the server just acknowledges so the client can clear its
 * token and lock local data. A production build would maintain a
 * revocation list or use short-lived tokens with refresh rotation.
 */
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out. Discard the token and clear local session data on the device.' });
});

module.exports = router;
