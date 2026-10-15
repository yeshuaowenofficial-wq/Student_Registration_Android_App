const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set — refusing to start with an insecure default');
}

// Verifies the bearer token on every protected request and re-checks the
// account is still active (covers logout / disabled-account cases even
// if the token itself has not expired yet).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Missing bearer token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Invalid or expired session' });
  }

  const [rows] = await pool.query(
    'SELECT account_id, student_id, role, is_active FROM accounts WHERE account_id = :id',
    { id: payload.account_id }
  );
  const account = rows[0];
  if (!account || !account.is_active) {
    return res.status(401).json({ error: 'SESSION_INVALID', message: 'Account disabled or session expired' });
  }

  req.user = {
    accountId: account.account_id,
    studentId: account.student_id,
    role: account.role,
  };
  next();
}

// Restricts a route to one or more roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient permissions for this action' });
    }
    next();
  };
}

// A student may only act on their own student_id. Lecturers pass through.
// This is enforced server-side (never rely on the client hiding buttons).
function requireOwnStudentOrLecturer(paramName = 'studentId') {
  return (req, res, next) => {
    if (req.user.role === 'lecturer') return next();
    if (req.user.role === 'student' && req.user.studentId === req.params[paramName]) {
      return next();
    }
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot access another student\'s record' });
  };
}

module.exports = { requireAuth, requireRole, requireOwnStudentOrLecturer };
