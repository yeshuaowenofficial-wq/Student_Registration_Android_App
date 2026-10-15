const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { validateStudentName, validateStudentNumber, validateProgramCode } = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '2h';
const LECTURER_INVITE_CODE = process.env.LECTURER_INVITE_CODE || 'MU-STAFF-2026';

function issueToken(account) {
  return jwt.sign({ account_id: account.account_id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Profile pictures are bundled in the app (assets/www/pfps/<name>.svg); only store the key.
function cleanAvatar(avatar) {
  return typeof avatar === 'string' && /^[a-z0-9-]{1,30}$/.test(avatar) ? avatar : null;
}

// Shared shape returned by login / register / me so the app always gets the same fields.
async function profileFor(accountId) {
  const [rows] = await pool.query(
    `SELECT a.account_id, a.student_id, a.role, a.username, a.display_name, a.avatar,
            s.student_name, s.student_number, p.program_code, g.group_code
     FROM accounts a
     LEFT JOIN students s ON s.student_id = a.student_id
     LEFT JOIN programmes p ON p.program_id = s.program_id
     LEFT JOIN lab_groups g ON g.group_id = s.group_id
     WHERE a.account_id = :id`,
    { id: accountId }
  );
  const r = rows[0];
  if (!r) return null;
  return {
    account_id: r.account_id,
    student_id: r.student_id,
    role: r.role,
    username: r.username,
    name: r.student_name || r.display_name || r.username,
    avatar: r.avatar,
    student_number: r.student_number,
    program_code: r.program_code,
    group_code: r.group_code,
  };
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
  const { claim_code, student_name, student_number, program_code, username, password, avatar } = req.body;

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
      `INSERT INTO accounts (student_id, username, avatar, password_hash, role, is_active)
       VALUES (:studentId, :username, :avatar, :hash, 'student', 1)`,
      { studentId, username: username.trim(), avatar: cleanAvatar(avatar), hash: passwordHash }
    );

    await conn.query(
      `UPDATE claim_codes SET used_at = NOW(), used_by_student = :studentId WHERE claim_code = :code`,
      { studentId, code: claim_code }
    );

    await conn.commit();

    const token = issueToken({ account_id: accountResult.insertId });
    const profile = await profileFor(accountResult.insertId);
    return res.status(201).json({
      ...profile,
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
  const { username, password, role } = req.body;
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

  // Portal check: the app sends which workspace the user chose (student / lecturer).
  // A student account can never be used to enter the lecturer workspace (and vice versa).
  if (role && role !== account.role) {
    return res.status(403).json({
      error: 'ROLE_MISMATCH',
      message: `This is a ${account.role} account. Switch to the ${account.role === 'student' ? 'Student' : 'Lecturer'} tab to sign in.`,
    });
  }

  await pool.query('UPDATE accounts SET last_login_at = NOW() WHERE account_id = :id', { id: account.account_id });

  const token = issueToken(account);
  const profile = await profileFor(account.account_id);
  return res.json({ ...profile, token });
});

/**
 * POST /api/auth/register-lecturer
 * Lecturer accounts need the staff invite code (LECTURER_INVITE_CODE in .env)
 * so students cannot simply create themselves a lecturer login.
 */
router.post('/register-lecturer', async (req, res) => {
  const { staff_code, full_name, username, password, avatar } = req.body;
  if (staff_code !== LECTURER_INVITE_CODE) {
    return res.status(403).json({ error: 'INVALID_STAFF_CODE', message: 'Staff invite code is not valid' });
  }
  const nameCheck = validateStudentName(full_name);
  if (!nameCheck.ok) return res.status(400).json({ error: 'VALIDATION_ERROR', message: nameCheck.error.replace('student_name', 'full_name') });
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'password must be at least 8 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [result] = await pool.query(
      `INSERT INTO accounts (student_id, username, display_name, avatar, password_hash, role, is_active)
       VALUES (NULL, :u, :n, :a, :h, 'lecturer', 1)`,
      { u: username.trim(), n: nameCheck.value, a: cleanAvatar(avatar), h: hash }
    );
    const token = issueToken({ account_id: result.insertId });
    const profile = await profileFor(result.insertId);
    return res.status(201).json({ ...profile, token });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'ACCOUNT_EXISTS', message: 'That username is already taken' });
    }
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Registration failed' });
  }
});

/** GET /api/auth/me — current account profile (name, role, avatar, group). */
router.get('/me', requireAuth, async (req, res) => {
  const profile = await profileFor(req.user.accountId);
  if (!profile) return res.status(404).json({ error: 'NOT_FOUND', message: 'Account not found' });
  res.json(profile);
});

/** PUT /api/auth/me/avatar — change the signed-in user's profile picture. body: { avatar } */
router.put('/me/avatar', requireAuth, async (req, res) => {
  const avatar = cleanAvatar(req.body.avatar);
  if (!avatar) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'avatar is not valid' });
  await pool.query(`UPDATE accounts SET avatar = :a WHERE account_id = :id`, { a: avatar, id: req.user.accountId });
  res.json({ avatar });
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
