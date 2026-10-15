// Server-side validation. The mobile app does its own checks for early
// feedback, but the server is the source of truth — never trust the client.

const NAME_RE = /^[\p{L}][\p{L}\p{M}'.\- ]{1,99}$/u; // 2-100 chars after trim, letters/accents/ordinary punctuation
const STUDENT_NUMBER_RE = /^\d{9}$/;                 // exactly 9 digits, no embedded spaces
const VALID_PROGRAMMES = ['CS', 'IT', 'DS'];
const VALID_GROUPS = ['G01', 'G02', 'G03', 'G04'];   // 'UNASSIGNED' is a filter value, not a stored group

function validateStudentName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'student_name is required' };
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    return { ok: false, error: 'student_name must be 2-100 characters' };
  }
  if (!NAME_RE.test(trimmed)) {
    return { ok: false, error: 'student_name contains unsupported characters' };
  }
  return { ok: true, value: trimmed };
}

function validateStudentNumber(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'student_number is required' };
  const trimmed = raw.trim(); // trim outer whitespace only
  if (trimmed.includes(' ')) {
    return { ok: false, error: 'student_number must not contain embedded spaces' };
  }
  if (!STUDENT_NUMBER_RE.test(trimmed)) {
    return { ok: false, error: 'student_number must be exactly 9 digits' };
  }
  return { ok: true, value: trimmed }; // leading zeroes preserved, kept as string
}

function validateProgramCode(raw) {
  if (!VALID_PROGRAMMES.includes(raw)) {
    return { ok: false, error: `program_code must be one of ${VALID_PROGRAMMES.join(', ')}` };
  }
  return { ok: true, value: raw };
}

function validateGroupCode(raw) {
  // null / 'UNASSIGNED' both mean "no group"
  if (raw === null || raw === undefined || raw === 'UNASSIGNED') {
    return { ok: true, value: null };
  }
  if (!VALID_GROUPS.includes(raw)) {
    return { ok: false, error: `group_code must be one of ${VALID_GROUPS.join(', ')} or UNASSIGNED` };
  }
  return { ok: true, value: raw };
}

module.exports = {
  validateStudentName,
  validateStudentNumber,
  validateProgramCode,
  validateGroupCode,
  VALID_PROGRAMMES,
  VALID_GROUPS,
};
