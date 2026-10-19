/**
 * Campus Companion — data layer
 * -----------------------------------------------------------------------
 * Talks to the Node.js / Express / MySQL backend (backend/ folder).
 *
 *   LIVE mode  : the server answered GET /api/health -> every call goes to MySQL.
 *   DEMO mode  : server unreachable -> an offline sample store in localStorage
 *                that enforces the SAME rules (roles, 15-seat cap, unique numbers)
 *                so the UI can still be demonstrated without a laptop server.
 *
 * Server address is configurable from the app (Server settings) and defaults to
 * http://10.0.2.2:3000  (= "localhost of the PC" when running in the Android emulator).
 */
(function () {
  'use strict';

  const LS_URL = 'cc.serverUrl';
  const LS_DB = 'cc.demoDb.v2';
  const DEFAULT_URL = 'http://10.0.2.2:3000';
  const DEMO_STAFF_CODE = 'MU-STAFF-2026';

  const AVATARS = [
    'cat-1', 'cat-2', 'cat-3', 'cat-4',
    'dog-1', 'dog-2', 'dog-3', 'dog-4',
    'rabbit-1', 'rabbit-2', 'rabbit-3', 'rabbit-4',
    'cloud', 'sun'
  ];

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (_) { /* insecure context */ }
    }
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function timeoutFetch(url, options, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      fetch(url, options).then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
    });
  }

  const NUM_RE = /^\d{9}$/;
  const NAME_RE = /^[\p{L}][\p{L}\s.'-]{1,99}$/u;
  const PROGRAMS = ['CS', 'IT', 'DS'];

  function normStudent(s) {
    return {
      id: s.student_id,
      student_number: s.student_number,
      name: s.student_name,
      program_code: s.program_code,
      group_code: s.group_code || 'UNASSIGNED',
      version: s.version,
      status: s.group_code ? 'CONFIRMED' : 'PENDING'
    };
  }

  function normGroup(g) {
    return {
      group_code: g.group_code,
      capacity: Number(g.capacity) || 15,
      active_count: Number(g.active_count) || 0,
      schedule_day: g.schedule_day || null,
      start_time: g.start_time || null,
      end_time: g.end_time || null,
      room: g.room || ''
    };
  }

  function normUser(p) {
    return {
      accountId: p.account_id,
      studentId: p.student_id || null,
      role: p.role,
      username: p.username,
      name: p.name || p.username,
      avatar: p.avatar || null,
      studentNumber: p.student_number || null,
      program: p.program_code || null,
      group: p.group_code || 'UNASSIGNED',
      token: p.token || null
    };
  }

  function roleMismatch(actualRole) {
    const tab = actualRole === 'student' ? 'Student' : 'Lecturer';
    return new ApiError(403, 'ROLE_MISMATCH', `This is a ${actualRole} account. Switch to the ${tab} tab to sign in.`);
  }

  // ---------------------------------------------------------------------
  // LIVE backend (Node.js + MySQL)
  // ---------------------------------------------------------------------
  const live = {
    token: null,

    async request(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = 'Bearer ' + this.token;
      // Mutations on protected routes need an idempotency key (see backend/src/utils/idempotency.js)
      if (method !== 'GET' && !path.startsWith('/api/auth')) headers['X-Operation-Id'] = uuid();

      let res;
      try {
        res = await timeoutFetch(Api.getBaseUrl() + path, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        }, 10000);
      } catch (e) {
        throw new ApiError(0, 'NETWORK', 'Cannot reach the Campus Companion server. Check that it is running and the address in Server settings.');
      }
      let data = null;
      try { data = await res.json(); } catch (_) { /* empty body */ }
      if (!res.ok) {
        throw new ApiError(res.status, (data && data.error) || 'HTTP_' + res.status,
          (data && data.message) || `Request failed (${res.status})`);
      }
      return data;
    },

    async login(username, password, role) {
      const data = await this.request('POST', '/api/auth/login', { username, password, role });
      if (data.role !== role) throw roleMismatch(data.role); // belt-and-braces with the server check
      this.token = data.token;
      return normUser(data);
    },

    async registerStudent(f) {
      const data = await this.request('POST', '/api/auth/register', {
        claim_code: f.claim, student_name: f.name, student_number: f.number,
        program_code: f.program, username: f.number, password: f.password, avatar: f.avatar
      });
      this.token = data.token;
      return normUser(data);
    },

    async registerLecturer(f) {
      const data = await this.request('POST', '/api/auth/register-lecturer', {
        staff_code: f.staffCode, full_name: f.name, username: f.username, password: f.password, avatar: f.avatar
      });
      this.token = data.token;
      return normUser(data);
    },

    async loadData(user) {
      const g = await this.request('GET', '/api/groups');
      let students = [];
      if (user.role === 'lecturer') {
        const page = await this.request('GET', '/api/students?page_size=100');
        students = page.students.map(normStudent);
      } else {
        const me = await this.request('GET', '/api/students/me');
        const myStudent = normStudent(me);
        students = [myStudent];
        if (me.group_code && me.group_code !== 'UNASSIGNED') {
          try {
            const peersRes = await this.request('GET', `/api/groups/${me.group_code}/members`);
            if (peersRes && peersRes.members) {
              const peers = peersRes.members.map(normStudent);
              // Merge unique students
              const map = new Map();
              [myStudent, ...peers].forEach(s => map.set(s.id, s));
              students = Array.from(map.values());
            }
          } catch (_) { /* best effort */ }
        }
      }
      return { students, groups: g.groups.map(normGroup) };
    },

    async createStudent(f) {
      return this.request('POST', '/api/students', {
        student_name: f.name, student_number: f.number, program_code: f.program,
        group_code: f.group === 'UNASSIGNED' ? null : f.group
      });
    },

    async updateStudent(original, f, role) {
      let version = original.version;
      if (f.name !== original.name || f.program !== original.program_code) {
        const r = await this.request('PUT', `/api/students/${original.id}`, {
          student_name: f.name, program_code: f.program, expected_version: version
        });
        version = r.version;
      }
      if (role === 'lecturer' && f.group !== original.group_code) {
        const r = await this.request('POST', `/api/students/${original.id}/group-transfer`, {
          group_code: f.group, expected_version: version
        });
        version = r.version;
      }
      return { version };
    },

    async deleteStudent(id) { return this.request('DELETE', `/api/students/${id}`); },

    async requestCorrection(studentId, value) {
      return this.request('POST', `/api/students/${studentId}/correction-request`, { requested_value: value });
    },

    async requestGroupChange(targetGroup, reason) {
      return this.request('POST', '/api/groups/request-change', { requested_group: targetGroup, reason });
    },

    async getPendingCorrections() {
      return this.request('GET', '/api/groups/pending-corrections');
    },

    async resolveCorrection(requestId, decision) {
      return this.request('POST', `/api/groups/corrections/${requestId}/resolve`, { decision });
    },

    async updateSchedule(code, s) { return this.request('PUT', `/api/groups/${code}/schedule`, s); },

    async updateAvatar(avatar) { return this.request('PUT', '/api/auth/me/avatar', { avatar }); },

    async logout() {
      try { await this.request('POST', '/api/auth/logout'); } catch (_) { /* best effort */ }
      this.token = null;
    }
  };

  // ---------------------------------------------------------------------
  // DEMO backend (offline sample data, same rules as the server)
  // ---------------------------------------------------------------------
  function seedDb() {
    const s = (id, num, name, prog, grp) => ({ student_id: id, student_number: num, student_name: name, program_code: prog, group_code: grp, version: 1, status: 'active' });
    return {
      nextAccount: 3,
      nextStudent: 111,
      accounts: [
        { account_id: 1, username: 'lecturer1', password: 'Lecturer#2026', role: 'lecturer', name: 'Dr. Mwansa', avatar: 'dog-1', student_id: null },
        { account_id: 2, username: '202408138', password: 'Student#2026', role: 'student', name: 'Chanda Mubanga', avatar: 'cat-1', student_id: 'std-101' }
      ],
      students: [
        s('std-101', '202408138', 'Chanda Mubanga', 'CS', 'G01'),
        s('std-102', '202408101', 'Alice Mutale', 'CS', 'G01'),
        s('std-103', '202408102', 'Brian Lungu', 'IT', 'G01'),
        s('std-104', '202408103', 'Catherine Banda', 'DS', 'G02'),
        s('std-105', '202408104', 'David Phiri', 'CS', 'G02'),
        s('std-106', '202408105', 'Esther Tembo', 'IT', 'G03'),
        s('std-107', '202408106', 'Frank Mwanza', 'DS', 'G03'),
        s('std-108', '202408107', 'Grace Zulu', 'CS', null),
        s('std-109', '202408108', 'Harold Bwalya', 'IT', 'G04'),
        s('std-110', '202408109', 'Irene Sikazwe', 'DS', 'G04')
      ],
      groups: [
        { group_code: 'G01', capacity: 15, schedule_day: 'TUE', start_time: '10:00', end_time: '12:00', room: 'Engineering Lab 3' },
        { group_code: 'G02', capacity: 15, schedule_day: 'WED', start_time: '14:00', end_time: '16:00', room: 'CS Block Lab 1' },
        { group_code: 'G03', capacity: 15, schedule_day: 'THU', start_time: '08:00', end_time: '10:00', room: 'IT Centre Lab 2' },
        { group_code: 'G04', capacity: 15, schedule_day: 'FRI', start_time: '14:00', end_time: '16:00', room: 'Data Science Lab 4' }
      ],
      corrections: []
    };
  }

  const demo = {
    session: null,

    db() {
      try {
        const raw = localStorage.getItem(LS_DB);
        if (raw) return JSON.parse(raw);
      } catch (_) { /* corrupted -> reseed */ }
      const fresh = seedDb();
      this.save(fresh);
      return fresh;
    },
    save(db) { localStorage.setItem(LS_DB, JSON.stringify(db)); },

    delay(v) { return new Promise(r => setTimeout(() => r(v), 350)); },

    profile(db, acc) {
      const st = acc.student_id ? db.students.find(x => x.student_id === acc.student_id) : null;
      return normUser({
        account_id: acc.account_id, student_id: acc.student_id, role: acc.role, username: acc.username,
        name: st ? st.student_name : acc.name, avatar: acc.avatar,
        student_number: st && st.student_number, program_code: st && st.program_code, group_code: st && st.group_code,
        token: 'demo-' + acc.account_id
      });
    },

    activeCount(db, code) { return db.students.filter(s => s.status === 'active' && s.group_code === code).length; },

    checkStudentFields(name, number, program) {
      if (!NAME_RE.test((name || '').trim())) throw new ApiError(400, 'VALIDATION_ERROR', 'Name must be 2–100 letters (spaces, apostrophes and hyphens allowed).');
      if (number !== undefined && !NUM_RE.test((number || '').trim())) throw new ApiError(400, 'VALIDATION_ERROR', 'Student number must be exactly 9 digits.');
      if (!PROGRAMS.includes(program)) throw new ApiError(400, 'VALIDATION_ERROR', 'Programme must be CS, IT or DS.');
    },

    async login(username, password, role) {
      const db = this.db();
      const acc = db.accounts.find(a => a.username === username.trim());
      if (!acc || acc.password !== password) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
      if (acc.role !== role) throw roleMismatch(acc.role);
      if (acc.student_id) {
        const st = db.students.find(s => s.student_id === acc.student_id);
        if (!st || st.status !== 'active') throw new ApiError(401, 'INVALID_CREDENTIALS', 'This account has been disabled');
      }
      this.session = acc.account_id;
      return this.delay(this.profile(db, acc));
    },

    async registerStudent(f) {
      const db = this.db();
      if (!f.claim) throw new ApiError(400, 'VALIDATION_ERROR', 'A claim / verification code is required');
      this.checkStudentFields(f.name, f.number, f.program);
      if ((f.password || '').length < 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
      if (db.accounts.some(a => a.username === f.number)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account already exists for this student number');
      let st = db.students.find(s => s.student_number === f.number);
      if (st && st.status === 'deleted') throw new ApiError(409, 'STUDENT_NUMBER_RESERVED', 'This student number cannot be re-registered');
      if (!st) {
        st = { student_id: 'std-' + (db.nextStudent++), student_number: f.number, student_name: f.name.trim(), program_code: f.program, group_code: null, version: 1, status: 'active' };
        db.students.push(st);
      }
      const acc = { account_id: db.nextAccount++, username: f.number, password: f.password, role: 'student', name: st.student_name, avatar: f.avatar, student_id: st.student_id };
      db.accounts.push(acc);
      this.save(db);
      this.session = acc.account_id;
      return this.delay(this.profile(db, acc));
    },

    async registerLecturer(f) {
      const db = this.db();
      if (f.staffCode !== DEMO_STAFF_CODE) throw new ApiError(403, 'INVALID_STAFF_CODE', 'Staff invite code is not valid');
      if (!NAME_RE.test((f.name || '').trim())) throw new ApiError(400, 'VALIDATION_ERROR', 'Please enter your full name');
      if ((f.username || '').trim().length < 3) throw new ApiError(400, 'VALIDATION_ERROR', 'Username must be at least 3 characters');
      if ((f.password || '').length < 8) throw new ApiError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
      if (db.accounts.some(a => a.username === f.username.trim())) throw new ApiError(409, 'ACCOUNT_EXISTS', 'That username is already taken');
      const acc = { account_id: db.nextAccount++, username: f.username.trim(), password: f.password, role: 'lecturer', name: f.name.trim(), avatar: f.avatar, student_id: null };
      db.accounts.push(acc);
      this.save(db);
      this.session = acc.account_id;
      return this.delay(this.profile(db, acc));
    },

    async loadData(user) {
      const db = this.db();
      const active = db.students.filter(s => s.status === 'active');
      let students;
      if (user.role === 'lecturer') {
        students = active.map(normStudent);
      } else {
        const me = active.find(s => s.student_id === user.studentId);
        const myGroup = me && me.group_code;
        if (myGroup) {
          students = active.filter(s => s.group_code === myGroup).map(normStudent);
        } else {
          students = (me ? [me] : active.slice(0, 1)).map(normStudent);
        }
      }
      const groups = db.groups.map(g => normGroup({ ...g, active_count: this.activeCount(db, g.group_code) }));
      return this.delay({ students, groups });
    },

    async createStudent(f) {
      const db = this.db();
      this.checkStudentFields(f.name, f.number, f.program);
      if (db.students.some(s => s.student_number === f.number)) throw new ApiError(409, 'DUPLICATE_STUDENT_NUMBER', 'That student number is already in use or reserved');
      const grp = f.group === 'UNASSIGNED' ? null : f.group;
      if (grp && this.activeCount(db, grp) >= 15) throw new ApiError(409, 'GROUP_FULL', `Group ${grp} is already at capacity (15)`);
      const st = { student_id: 'std-' + (db.nextStudent++), student_number: f.number, student_name: f.name.trim(), program_code: f.program, group_code: grp, version: 1, status: 'active' };
      db.students.push(st);
      this.save(db);
      return this.delay({ student_id: st.student_id, claim_code: 'CLAIM-' + uuid().slice(0, 8).toUpperCase() });
    },

    async updateStudent(original, f, role) {
      const db = this.db();
      const st = db.students.find(s => s.student_id === original.id);
      if (!st || st.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Student not found');
      if (st.version !== original.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Record changed since you opened it — refresh and try again');
      this.checkStudentFields(f.name, undefined, f.program);
      const newGroup = f.group === 'UNASSIGNED' ? null : f.group;
      if (role === 'lecturer' && newGroup !== st.group_code && newGroup && this.activeCount(db, newGroup) >= 15) {
        throw new ApiError(409, 'GROUP_FULL', `Lab group ${newGroup} has reached maximum capacity of 15 students`);
      }
      st.student_name = f.name.trim();
      st.program_code = f.program;
      if (role === 'lecturer') st.group_code = newGroup;
      st.version += 1;
      this.save(db);
      return this.delay({ version: st.version });
    },

    async deleteStudent(id) {
      const db = this.db();
      const st = db.students.find(s => s.student_id === id);
      if (!st) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
      st.status = 'deleted';
      st.group_code = null;
      st.version += 1;
      this.save(db);
      return this.delay({ student_id: id, status: 'deleted' });
    },

    async requestCorrection(studentId, value) {
      if (!NUM_RE.test(value)) throw new ApiError(400, 'VALIDATION_ERROR', 'Student number must be exactly 9 digits.');
      const db = this.db();
      db.corrections.push({ request_id: Date.now(), student_id: studentId, field_name: 'student_number', requested_value: value, current_value: 'N/A', status: 'pending', created_at: new Date().toISOString() });
      this.save(db);
      return this.delay({ status: 'pending' });
    },

    async requestGroupChange(targetGroup, reason) {
      const db = this.db();
      const me = db.students.find(s => s.student_id === 'std-101') || db.students[0];
      const cur = me ? me.group_code : 'UNASSIGNED';
      const req = {
        request_id: Date.now(),
        student_id: me ? me.student_id : 'std-101',
        student_name: me ? me.student_name : 'Student',
        student_number: me ? me.student_number : '202408138',
        field_name: 'group_code',
        current_value: cur,
        requested_value: targetGroup,
        reason: reason || '',
        status: 'pending',
        created_at: new Date().toISOString()
      };
      db.corrections = db.corrections || [];
      db.corrections.push(req);
      this.save(db);
      return this.delay({ request_id: req.request_id, status: 'pending' });
    },

    async getPendingCorrections() {
      const db = this.db();
      const list = (db.corrections || []).filter(c => c.status === 'pending');
      return this.delay({ requests: list });
    },

    async resolveCorrection(requestId, decision) {
      const db = this.db();
      const req = (db.corrections || []).find(c => c.request_id == requestId);
      if (req) {
        req.status = decision;
        if (decision === 'approved') {
          const st = db.students.find(s => s.student_id === req.student_id);
          if (st) {
            if (req.field_name === 'student_number') st.student_number = req.requested_value;
            if (req.field_name === 'group_code') st.group_code = req.requested_value === 'UNASSIGNED' ? null : req.requested_value;
            st.version += 1;
          }
        }
        this.save(db);
      }
      return this.delay({ request_id: requestId, status: decision });
    },

    async updateSchedule(code, s) {
      const db = this.db();
      const g = db.groups.find(x => x.group_code === code);
      if (!g) throw new ApiError(404, 'GROUP_NOT_FOUND', 'No such lab group');
      if (!s.start_time || !s.end_time || s.start_time >= s.end_time) throw new ApiError(400, 'VALIDATION_ERROR', 'End time must be after start time');
      Object.assign(g, s);
      this.save(db);
      return this.delay(g);
    },

    async updateAvatar(avatar) {
      const db = this.db();
      const acc = db.accounts.find(a => a.account_id === this.session);
      if (acc) { acc.avatar = avatar; this.save(db); }
      return this.delay({ avatar });
    },

    async logout() { this.session = null; }
  };

  // ---------------------------------------------------------------------
  // Public facade used by app.js
  // ---------------------------------------------------------------------
  const Api = {
    mode: 'unknown',   // 'live' | 'demo'
    AVATARS,
    ApiError,
    DEFAULT_URL,

    getBaseUrl() { return (localStorage.getItem(LS_URL) || DEFAULT_URL).trim().replace(/\/+$/, ''); },
    setBaseUrl(url) {
      let u = (url || '').trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
      localStorage.setItem(LS_URL, u || DEFAULT_URL);
    },

    async detect() {
      try {
        const r = await timeoutFetch(this.getBaseUrl() + '/api/health', {}, 3500);
        const j = await r.json();
        this.mode = r.ok && j && j.status === 'ok' ? 'live' : 'demo';
      } catch (_) {
        this.mode = 'demo';
      }
      return this.mode;
    },

    resetDemoData() { localStorage.removeItem(LS_DB); },

    get impl() { return this.mode === 'live' ? live : demo; }
  };

  ['login', 'registerStudent', 'registerLecturer', 'loadData', 'createStudent', 'updateStudent',
    'deleteStudent', 'requestCorrection', 'requestGroupChange', 'getPendingCorrections', 'resolveCorrection', 'updateSchedule', 'updateAvatar', 'logout'].forEach(fn => {
    Api[fn] = function () { return Api.impl[fn].apply(Api.impl, arguments); };
  });

  window.CCApi = Api;
})();
