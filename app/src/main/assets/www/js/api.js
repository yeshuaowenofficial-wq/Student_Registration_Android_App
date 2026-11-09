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
  const LS_DB = 'cc.demoDb.v2.5';
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

  const pendingNativeRequests = new Map();

  function decodeBase64Utf8(base64) {
    try {
      const binString = atob(base64);
      const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return atob(base64);
    }
  }

  window.__onNativeHttpResponse = function (reqId, payload) {
    const cb = pendingNativeRequests.get(reqId);
    if (!cb) return;
    pendingNativeRequests.delete(reqId);
    try {
      let resObj = {};
      if (typeof payload === 'string') {
        try {
          const jsonStr = decodeBase64Utf8(payload);
          resObj = JSON.parse(jsonStr);
        } catch (_) {
          resObj = JSON.parse(payload);
        }
      } else if (payload && typeof payload === 'object') {
        resObj = payload;
      }

      if (!resObj.status || resObj.status === 0) {
        cb.reject(new Error(resObj.message || 'Cannot reach server'));
        return;
      }

      const resp = {
        ok: resObj.status >= 200 && resObj.status < 300,
        status: resObj.status,
        statusText: resObj.statusText || 'OK',
        text: async () => resObj.body || '',
        json: async () => JSON.parse(resObj.body || '{}'),
        headers: {
          get: (k) => null
        }
      };
      cb.resolve(resp);
    } catch (err) {
      cb.reject(err);
    }
  };

  function timeoutFetch(url, options, ms) {
    const timeoutDuration = ms || 10000;
    // 1. Asynchronous Native Java Bridge (prevents blocking WebView JS/UI thread completely)
    if (typeof window !== 'undefined' && window.Android && typeof window.Android.nativeHttpRequestAsync === 'function') {
      return new Promise((resolve, reject) => {
        const reqId = uuid();
        const timer = setTimeout(() => {
          if (pendingNativeRequests.has(reqId)) {
            pendingNativeRequests.delete(reqId);
            reject(new Error('timeout'));
          }
        }, timeoutDuration + 1000);

        pendingNativeRequests.set(reqId, {
          resolve: (val) => { clearTimeout(timer); resolve(val); },
          reject: (err) => { clearTimeout(timer); reject(err); }
        });

        try {
          const method = (options && options.method) || 'GET';
          const headers = (options && options.headers) || {};
          let bodyStr = null;
          if (options && options.body !== undefined) {
            bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
          }
          window.Android.nativeHttpRequestAsync(reqId, method, url, JSON.stringify(headers), bodyStr, timeoutDuration);
        } catch (err) {
          clearTimeout(timer);
          pendingNativeRequests.delete(reqId);
          reject(err);
        }
      });
    }

    // 2. Synchronous fallback for older app versions
    if (typeof window !== 'undefined' && window.Android && typeof window.Android.nativeHttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        try {
          const method = (options && options.method) || 'GET';
          const headers = (options && options.headers) || {};
          let bodyStr = null;
          if (options && options.body !== undefined) {
            bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
          }
          const resStr = window.Android.nativeHttpRequest(method, url, JSON.stringify(headers), bodyStr, timeoutDuration);
          const resObj = JSON.parse(resStr || '{}');
          if (!resObj.status || resObj.status === 0) {
            reject(new Error(resObj.message || 'Cannot reach server at ' + url));
            return;
          }
          const resp = {
            ok: resObj.status >= 200 && resObj.status < 300,
            status: resObj.status,
            statusText: resObj.statusText || 'OK',
            text: async () => resObj.body || '',
            json: async () => JSON.parse(resObj.body || '{}'),
            headers: {
              get: (k) => null
            }
          };
          resolve(resp);
        } catch (err) {
          reject(err);
        }
      });
    }

    // 3. Standard browser fetch (for desktop PC dev / emulator browser)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutDuration);
      fetch(url, options).then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
    });
  }

  const NUM_RE = /^\d{9}$/;
  const NAME_RE = /^[\p{L}][\p{L}\s.'-]{1,99}$/u;
  const PROGRAMS = ['CS', 'IT', 'ITED', 'DS'];

  let _seedMetaMap = null;
  function getSeedMeta(s) {
    if (!_seedMetaMap) {
      _seedMetaMap = { byNum: new Map(), byNameGrp: new Map(), byName: new Map() };
      try {
        const initial = seedDb().students || [];
        initial.forEach(item => {
          if (item.student_number) _seedMetaMap.byNum.set(item.student_number, item);
          const key = (item.student_name || '').toLowerCase() + '|' + (item.group_code || '');
          _seedMetaMap.byNameGrp.set(key, item);
          _seedMetaMap.byName.set((item.student_name || '').toLowerCase(), item);
        });
      } catch (_) {}
    }
    const num = s.student_number || '';
    if (num && _seedMetaMap.byNum.has(num)) return _seedMetaMap.byNum.get(num);
    const nameKey = (s.student_name || s.name || '').toLowerCase();
    const grp = s.group_code || '';
    if (_seedMetaMap.byNameGrp.has(nameKey + '|' + grp)) return _seedMetaMap.byNameGrp.get(nameKey + '|' + grp);
    if (_seedMetaMap.byName.has(nameKey)) return _seedMetaMap.byName.get(nameKey);
    return null;
  }

  function normStudent(s) {
    const meta = getSeedMeta(s);
    const fullName = s.student_name || s.name || '';
    const parts = fullName.trim().split(/\s+/);
    const fallbackFirst = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || '');
    const fallbackLast = parts.length > 1 ? parts[parts.length - 1] : '';
    return {
      id: s.student_id || s.id,
      student_number: s.student_number || '',
      name: fullName,
      first_name: s.first_name || (meta && meta.first_name) || fallbackFirst,
      last_name: s.last_name || (meta && meta.last_name) || fallbackLast,
      gender: s.gender || (meta && meta.gender) || 'M',
      raw_program: s.raw_program || (meta && meta.raw_program) || s.program_code || 'BSCS',
      slot: s.slot || (meta && meta.slot) || 999,
      program_code: s.program_code,
      group_code: s.group_code || 'UNASSIGNED',
      version: s.version || 1,
      status: s.group_code ? 'CONFIRMED' : 'PENDING'
    };
  }

  function normGroup(g) {
    const rawRoom = String(g.room || '')
      .replace(/^(CS|IT|ITED)\s*[^a-zA-Z0-9\s]+\s*/i, '$1 - ')
      .replace(/â€”|â€“|\u2014|\u2013/g, '-');
    return {
      group_code: g.group_code,
      capacity: Number(g.capacity) || 15,
      active_count: Number(g.active_count) || 0,
      schedule_day: g.schedule_day || null,
      start_time: g.start_time || null,
      end_time: g.end_time || null,
      room: rawRoom
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
  // Database-First Cache Persistence
  // Remote database communicates first; whatever cache is captured from
  // the live database is persisted to localStorage for offline fallback.
  // ---------------------------------------------------------------------
  function persistCapturedDbData(dataset, role) {
    if (!dataset) return;
    try {
      const raw = localStorage.getItem(LS_DB);
      const db = raw ? JSON.parse(raw) : (typeof seedDb === 'function' ? seedDb() : {});
      if (role === 'lecturer') {
        db.hasSyncedFromServer = true;
        if (dataset.groups && dataset.groups.length > 0) {
          db.groups = dataset.groups;
        }
      } else if (dataset.groups && dataset.groups.length > 0) {
        if (!db.groups) db.groups = [];
        const groupMap = new Map();
        db.groups.forEach(g => groupMap.set(g.group_code, g));
        dataset.groups.forEach(g => groupMap.set(g.group_code, g));
        db.groups = Array.from(groupMap.values());
      }
      if (dataset.students && dataset.students.length > 0) {
        if (!db.students) db.students = [];
        const studentMap = new Map();
        // Keep existing cache entries as baseline
        db.students.forEach(s => studentMap.set(s.student_id || (s.student_number || s.student_name), s));
        // Overwrite with fresh, authoritative data captured from MySQL
        dataset.students.forEach(s => {
          const key = s.id || s.student_id || s.student_number;
          studentMap.set(key, {
            student_id: s.id || s.student_id,
            student_number: s.student_number,
            student_name: s.name || s.student_name,
            program_code: s.program_code,
            group_code: s.group_code === 'UNASSIGNED' ? null : s.group_code,
            version: s.version || 1,
            status: s.status || 'active'
          });
        });
        db.students = Array.from(studentMap.values());
      }
      db.lastSyncTimestamp = Date.now();
      localStorage.setItem(LS_DB, JSON.stringify(db));
    } catch (e) {
      console.warn('[Cache] Could not persist DB capture to local storage:', e);
    }
  }

  // ---------------------------------------------------------------------
  // LIVE backend (Node.js + MySQL)
  // ---------------------------------------------------------------------
  const live = {
    token: null,

    getToken() {
      if (this.token && !this.token.startsWith('demo-')) return this.token;
      try {
        const stored = localStorage.getItem('cc_auth_token');
        if (stored && !stored.startsWith('demo-')) {
          this.token = stored;
          return stored;
        }
      } catch (_) {}
      try {
        if (window.Android && window.Android.getToken) {
          const t = window.Android.getToken();
          if (t && !t.startsWith('demo-')) {
            this.token = t;
            return t;
          }
        }
      } catch (_) {}
      return null;
    },

    setToken(t) {
      this.token = t;
      try {
        if (t && !t.startsWith('demo-')) {
          localStorage.setItem('cc_auth_token', t);
        } else {
          localStorage.removeItem('cc_auth_token');
        }
      } catch (_) {}
    },

    hasValidLiveToken() {
      const t = this.getToken();
      return !!(t && !t.startsWith('demo-'));
    },

    async request(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      const tok = this.getToken();
      if (tok) headers.Authorization = 'Bearer ' + tok;
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
      this.setToken(data.token);
      return normUser(data);
    },

    async registerStudent(f) {
      const data = await this.request('POST', '/api/auth/register', {
        claim_code: f.claim, student_name: f.name, student_number: f.number,
        program_code: f.program, username: f.number, password: f.password, avatar: f.avatar
      });
      this.setToken(data.token);
      return normUser(data);
    },

    async registerLecturer(f) {
      const data = await this.request('POST', '/api/auth/register-lecturer', {
        staff_code: f.staffCode, full_name: f.name, username: f.username, password: f.password, avatar: f.avatar
      });
      this.setToken(data.token);
      return normUser(data);
    },

    async loadData(user) {
      // 1. Communicate with the remote database first
      const g = await this.request('GET', '/api/groups');
      const allGroups = (g.groups || []).map(normGroup);
      let students = [];
      let groups = allGroups;

      if (user.role === 'lecturer') {
        const page = await this.request('GET', '/api/students?page_size=500');
        students = (page.students || []).map(normStudent);
      } else {
        const me = await this.request('GET', '/api/students/me');
        const myStudent = normStudent(me);
        students = [myStudent];
        if (me.group_code && me.group_code !== 'UNASSIGNED') {
          groups = allGroups.filter(grp => grp.group_code === me.group_code);
          try {
            const peersRes = await this.request('GET', `/api/groups/${me.group_code}/members`);
            if (peersRes && peersRes.members) {
              const peers = peersRes.members.map(normStudent);
              const map = new Map();
              [myStudent, ...peers].forEach(s => map.set(s.id || s.student_number, s));
              students = Array.from(map.values());
            }
          } catch (_) { /* best effort */ }
        } else {
          groups = [];
        }
      }
      const dataset = { students, groups, isUnsyncedEmptyState: false };
      // 2. Persist whatever cache was captured from the live database into local storage
      persistCapturedDbData({ students, groups: user.role === 'lecturer' ? allGroups : groups }, user.role);
      return dataset;
    },

    async createStudent(f) {
      const res = await this.request('POST', '/api/students', {
        student_name: f.name, student_number: f.number, program_code: f.program,
        group_code: f.group === 'UNASSIGNED' ? null : f.group
      });
      // DB insert succeeded -> capture into local cache
      try {
        const raw = localStorage.getItem(LS_DB);
        if (raw) {
          const db = JSON.parse(raw);
          const grp = f.group === 'UNASSIGNED' ? null : f.group;
          db.students.push({
            student_id: res.student_id,
            student_number: f.number,
            student_name: f.name.trim(),
            program_code: f.program,
            group_code: grp,
            version: 1,
            status: 'active'
          });
          localStorage.setItem(LS_DB, JSON.stringify(db));
        }
      } catch (_) {}
      return res;
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
      // DB update succeeded -> capture into local cache
      try {
        const raw = localStorage.getItem(LS_DB);
        if (raw) {
          const db = JSON.parse(raw);
          const st = db.students.find(s => s.student_id === original.id || (original.student_number && s.student_number === original.student_number));
          if (st) {
            st.student_name = f.name.trim();
            st.program_code = f.program;
            if (role === 'lecturer') st.group_code = f.group === 'UNASSIGNED' ? null : f.group;
            st.version = version;
            localStorage.setItem(LS_DB, JSON.stringify(db));
          }
        }
      } catch (_) {}
      return { version };
    },

    async deleteStudent(id) {
      const res = await this.request('DELETE', `/api/students/${id}`);
      // DB delete succeeded -> capture into local cache
      try {
        const raw = localStorage.getItem(LS_DB);
        if (raw) {
          const db = JSON.parse(raw);
          const st = db.students.find(s => s.student_id === id);
          if (st) {
            st.status = 'deleted';
            st.group_code = null;
            localStorage.setItem(LS_DB, JSON.stringify(db));
          }
        }
      } catch (_) {}
      return res;
    },

    async requestCorrection(studentId, value) {
      return this.request('POST', `/api/students/${studentId}/correction-request`, { requested_value: value });
    },

    async requestGroupChange(targetGroup, reason) {
      return this.request('POST', '/api/groups/request-change', { requested_group: targetGroup, reason });
    },

    async getPendingCorrections() {
      return this.request('GET', '/api/groups/pending-corrections');
    },

    async resolveCorrection(requestId, decision, targetGroup) {
      return this.request('POST', `/api/groups/corrections/${requestId}/resolve`, {
        decision,
        target_group: targetGroup
      });
    },

    async transferStudent(studentId, groupCode, expectedVersion) {
      return this.request('POST', `/api/students/${studentId}/group-transfer`, {
        group_code: groupCode,
        expected_version: expectedVersion !== undefined ? expectedVersion : null
      });
    },

    async createGroup(g) {
      const res = await this.request('POST', '/api/groups', g);
      try {
        const raw = localStorage.getItem(LS_DB);
        if (raw) {
          const db = JSON.parse(raw);
          if (!db.groups) db.groups = [];
          db.groups.push(normGroup(res));
          localStorage.setItem(LS_DB, JSON.stringify(db));
        }
      } catch (_) {}
      return res;
    },

    async updateSchedule(code, s) { return this.request('PUT', `/api/groups/${code}/schedule`, s); },

    async updateAvatar(avatar) { return this.request('PUT', '/api/auth/me/avatar', { avatar }); },

    async logout() {
      try { await this.request('POST', '/api/auth/logout'); } catch (_) { /* best effort */ }
      this.setToken(null);
    }
  };

  // ---------------------------------------------------------------------
  // DEMO backend (offline sample data, same rules as the server)
  // ---------------------------------------------------------------------
  function seedDb() {
    return {
      hasSyncedFromServer: false,
      nextAccount: 3,
      nextStudent: 600,
      accounts: [
        { account_id: 1, username: 'lecturer1', password: 'Lecturer#2026', role: 'lecturer', name: 'Dr. Mwansa', avatar: 'dog-1', student_id: null },
        { account_id: 2, username: '202408138', password: 'Student#2026', role: 'student', name: 'Chanda Mubanga', avatar: 'cat-1', student_id: 'std-101' }
      ],
      students: [
    {
        "student_id": "std-200",
        "student_number": "202402387",
        "student_name": "Mulemwa Muchima",
        "first_name": "Mulemwa",
        "last_name": "Muchima",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-201",
        "student_number": "202406643",
        "student_name": "Edwin Kampamba",
        "first_name": "Edwin",
        "last_name": "Kampamba",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-202",
        "student_number": "202400442",
        "student_name": "Ivwananji Chipasha",
        "first_name": "Ivwananji",
        "last_name": "Chipasha",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-203",
        "student_number": "202305208",
        "student_name": "Alinani Sinyangwe",
        "first_name": "Alinani",
        "last_name": "Sinyangwe",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-204",
        "student_number": "202408399",
        "student_name": "Grace Chilufya",
        "first_name": "Grace",
        "last_name": "Chilufya",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-205",
        "student_number": "202402615",
        "student_name": "Charity Namangolwa",
        "first_name": "Charity",
        "last_name": "Namangolwa",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-206",
        "student_number": "202404528",
        "student_name": "Memory Mutemwa",
        "first_name": "Memory",
        "last_name": "Mutemwa",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-207",
        "student_number": "202409048",
        "student_name": "Mwila Siaciti",
        "first_name": "Mwila",
        "last_name": "Siaciti",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-208",
        "student_number": "202402859",
        "student_name": "Hope Nsana",
        "first_name": "Hope",
        "last_name": "Nsana",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-209",
        "student_number": "202403063",
        "student_name": "Judith Mushabati",
        "first_name": "Judith",
        "last_name": "Mushabati",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-210",
        "student_number": "202406887",
        "student_name": "Mcnaldo Chilanga",
        "first_name": "Mcnaldo",
        "last_name": "Chilanga",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-211",
        "student_number": "202403266",
        "student_name": "Collins Kalela",
        "first_name": "Collins",
        "last_name": "Kalela",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-212",
        "student_number": "202409163",
        "student_name": "Nancy Mailoni",
        "first_name": "Nancy",
        "last_name": "Mailoni",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-213",
        "student_number": "202408720",
        "student_name": "Onester Kalunga",
        "first_name": "Onester",
        "last_name": "Kalunga",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-214",
        "student_number": "202409779",
        "student_name": "Mayamiko Phiri",
        "first_name": "Mayamiko",
        "last_name": "Phiri",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G01",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-215",
        "student_number": "202408882",
        "student_name": "Atupele Andende",
        "first_name": "Atupele",
        "last_name": "Andende",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 16,
        "program_code": "CS",
        "group_code": null,
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-216",
        "student_number": "202400549",
        "student_name": "Joseph Chiwuswa",
        "first_name": "Joseph",
        "last_name": "Chiwuswa",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-217",
        "student_number": "202400526",
        "student_name": "Maluba B Akakandelwa",
        "first_name": "Maluba",
        "last_name": "B Akakandelwa",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-218",
        "student_number": "202403134",
        "student_name": "Emmanuel Viazi",
        "first_name": "Emmanuel",
        "last_name": "Viazi",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-219",
        "student_number": "202408701",
        "student_name": "Memory Tembo",
        "first_name": "Memory",
        "last_name": "Tembo",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-220",
        "student_number": "202401737",
        "student_name": "Salome Sitwala",
        "first_name": "Salome",
        "last_name": "Sitwala",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-221",
        "student_number": "202405690",
        "student_name": "Mwansa Mubanga",
        "first_name": "Mwansa",
        "last_name": "Mubanga",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-222",
        "student_number": "202404540",
        "student_name": "Paul Munene",
        "first_name": "Paul",
        "last_name": "Munene",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-223",
        "student_number": "202408808",
        "student_name": "Blessings Sinkamba",
        "first_name": "Blessings",
        "last_name": "Sinkamba",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-224",
        "student_number": "202308808",
        "student_name": "Joshua Chibale",
        "first_name": "Joshua",
        "last_name": "Chibale",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-225",
        "student_number": "202408439",
        "student_name": "Blessings Tembo",
        "first_name": "Blessings",
        "last_name": "Tembo",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-226",
        "student_number": "202402633",
        "student_name": "Mwaka Hamilemba",
        "first_name": "Mwaka",
        "last_name": "Hamilemba",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-227",
        "student_number": "202408554",
        "student_name": "Luumbi Malambo",
        "first_name": "Luumbi",
        "last_name": "Malambo",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-228",
        "student_number": "202406948",
        "student_name": "Liseli Faustina Kalowa",
        "first_name": "Liseli Faustina",
        "last_name": "Kalowa",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-229",
        "student_number": "202407170",
        "student_name": "Lute Walusungu Gondwe",
        "first_name": "Lute Walusungu",
        "last_name": "Gondwe",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-230",
        "student_number": "202405590",
        "student_name": "Matildah Yusiku",
        "first_name": "Matildah",
        "last_name": "Yusiku",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G02",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-231",
        "student_number": "202404194",
        "student_name": "Gift Chabuka",
        "first_name": "Gift",
        "last_name": "Chabuka",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-232",
        "student_number": "202307232",
        "student_name": "Ruth Kangwa",
        "first_name": "Ruth",
        "last_name": "Kangwa",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-233",
        "student_number": "202406919",
        "student_name": "Jason Mbao",
        "first_name": "Jason",
        "last_name": "Mbao",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-234",
        "student_number": "202404164",
        "student_name": "Chiko Mutale",
        "first_name": "Chiko",
        "last_name": "Mutale",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-235",
        "student_number": "202407862",
        "student_name": "Fabian Muloongo",
        "first_name": "Fabian",
        "last_name": "Muloongo",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-236",
        "student_number": "202402069",
        "student_name": "Richard Mwansa",
        "first_name": "Richard",
        "last_name": "Mwansa",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-237",
        "student_number": "202410371",
        "student_name": "Memory Mwela",
        "first_name": "Memory",
        "last_name": "Mwela",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-238",
        "student_number": "202406543",
        "student_name": "Gillian Mpola",
        "first_name": "Gillian",
        "last_name": "Mpola",
        "gender": "F",
        "raw_program": "IT",
        "slot": 8,
        "program_code": "IT",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-239",
        "student_number": "201901101",
        "student_name": "Christabel Chikomona",
        "first_name": "Christabel",
        "last_name": "Chikomona",
        "gender": "F",
        "raw_program": "ICT WITH EDUCATION",
        "slot": 9,
        "program_code": "ITED",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-240",
        "student_number": "202301795",
        "student_name": "Steven Zulu",
        "first_name": "Steven",
        "last_name": "Zulu",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-241",
        "student_number": "202409282",
        "student_name": "Kapunza Gwenani",
        "first_name": "Kapunza",
        "last_name": "Gwenani",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-242",
        "student_number": "202408164",
        "student_name": "Lenganji Simwanza",
        "first_name": "Lenganji",
        "last_name": "Simwanza",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-243",
        "student_number": "202403669",
        "student_name": "Eustane Chulu",
        "first_name": "Eustane",
        "last_name": "Chulu",
        "gender": "F",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-244",
        "student_number": "202401965",
        "student_name": "Erastas Michelo",
        "first_name": "Erastas",
        "last_name": "Michelo",
        "gender": "M",
        "raw_program": "COMPUTER SCIENCE",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G03",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-245",
        "student_number": "202405342",
        "student_name": "Manda Dickson",
        "first_name": "Manda",
        "last_name": "Dickson",
        "gender": "M",
        "raw_program": "CS",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-246",
        "student_number": "202405228",
        "student_name": "Nemar Kanyondwi",
        "first_name": "Nemar",
        "last_name": "Kanyondwi",
        "gender": "F",
        "raw_program": "CS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-247",
        "student_number": "202402427",
        "student_name": "Michael Mutale",
        "first_name": "Michael",
        "last_name": "Mutale",
        "gender": "M",
        "raw_program": "IT",
        "slot": 3,
        "program_code": "IT",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-248",
        "student_number": "202402839",
        "student_name": "Sikumbuzo Monde",
        "first_name": "Sikumbuzo",
        "last_name": "Monde",
        "gender": "F",
        "raw_program": "CS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-249",
        "student_number": "202107598",
        "student_name": "Cleopatra Ngulube",
        "first_name": "Cleopatra",
        "last_name": "Ngulube",
        "gender": "F",
        "raw_program": "CS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-250",
        "student_number": "202404130",
        "student_name": "Hellen Mwanza",
        "first_name": "Hellen",
        "last_name": "Mwanza",
        "gender": "F",
        "raw_program": "CS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-251",
        "student_number": "202306274",
        "student_name": "Lloyd Bulaya",
        "first_name": "Lloyd",
        "last_name": "Bulaya",
        "gender": "M",
        "raw_program": "CS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-252",
        "student_number": "202407149",
        "student_name": "Gedan Simbeye",
        "first_name": "Gedan",
        "last_name": "Simbeye",
        "gender": "M",
        "raw_program": "CS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-253",
        "student_number": "202408185",
        "student_name": "Muleba Mwashi",
        "first_name": "Muleba",
        "last_name": "Mwashi",
        "gender": "M",
        "raw_program": "CS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-254",
        "student_number": "202402132",
        "student_name": "Nkonde R Zimba",
        "first_name": "Nkonde R",
        "last_name": "Zimba",
        "gender": "F",
        "raw_program": "IT",
        "slot": 10,
        "program_code": "IT",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-255",
        "student_number": "202105977",
        "student_name": "Memory Sokontwe",
        "first_name": "Memory",
        "last_name": "Sokontwe",
        "gender": "F",
        "raw_program": "BICTED",
        "slot": 11,
        "program_code": "ITED",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-256",
        "student_number": "202408941",
        "student_name": "David Kanyama",
        "first_name": "David",
        "last_name": "Kanyama",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-257",
        "student_number": "202302576",
        "student_name": "Frackson Mkandawire",
        "first_name": "Frackson",
        "last_name": "Mkandawire",
        "gender": "M",
        "raw_program": "IT",
        "slot": 13,
        "program_code": "IT",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-258",
        "student_number": "202203671",
        "student_name": "Andrew Moyo",
        "first_name": "Andrew",
        "last_name": "Moyo",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-259",
        "student_number": "202404135",
        "student_name": "Thabo Muliwana",
        "first_name": "Thabo",
        "last_name": "Muliwana",
        "gender": "M",
        "raw_program": "CS",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G04",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-260",
        "student_number": "202402261",
        "student_name": "Mwila Stephen",
        "first_name": "Mwila",
        "last_name": "Stephen",
        "gender": "M",
        "raw_program": "CS",
        "slot": 16,
        "program_code": "CS",
        "group_code": null,
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-261",
        "student_number": "202406213",
        "student_name": "Simazuwo Brian",
        "first_name": "Simazuwo",
        "last_name": "Brian",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-262",
        "student_number": "202406222",
        "student_name": "Sanalumba Wakun’oli",
        "first_name": "Sanalumba",
        "last_name": "Wakun’oli",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-263",
        "student_number": "202406591",
        "student_name": "David Mbilima",
        "first_name": "David",
        "last_name": "Mbilima",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-264",
        "student_number": "202410059",
        "student_name": "Tembo Kunda",
        "first_name": "Tembo",
        "last_name": "Kunda",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-265",
        "student_number": "202407895",
        "student_name": "Chabu Chileleko",
        "first_name": "Chabu",
        "last_name": "Chileleko",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-266",
        "student_number": "202400756",
        "student_name": "Nachinga Thelma",
        "first_name": "Nachinga",
        "last_name": "Thelma",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-267",
        "student_number": "202406797",
        "student_name": "Kamwana Miriam",
        "first_name": "Kamwana",
        "last_name": "Miriam",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-268",
        "student_number": "202409524",
        "student_name": "Mwelwa Maggie",
        "first_name": "Mwelwa",
        "last_name": "Maggie",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-269",
        "student_number": "202200670",
        "student_name": "Mshisha Dada",
        "first_name": "Mshisha",
        "last_name": "Dada",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-270",
        "student_number": "202409126",
        "student_name": "Mukangwa Brian",
        "first_name": "Mukangwa",
        "last_name": "Brian",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-271",
        "student_number": "202408328",
        "student_name": "Shikupa Charles",
        "first_name": "Shikupa",
        "last_name": "Charles",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-272",
        "student_number": "202307112",
        "student_name": "Mwape Prisca",
        "first_name": "Mwape",
        "last_name": "Prisca",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-273",
        "student_number": "202400260",
        "student_name": "Shikabanga Cecilia",
        "first_name": "Shikabanga",
        "last_name": "Cecilia",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-274",
        "student_number": "202403973",
        "student_name": "Nevers Mwaba",
        "first_name": "Nevers",
        "last_name": "Mwaba",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-275",
        "student_number": "202403184",
        "student_name": "Febby Ng'anwe",
        "first_name": "Febby",
        "last_name": "Ng'anwe",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G05",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-276",
        "student_number": "202407184",
        "student_name": "Muyoba Mulako",
        "first_name": "Muyoba",
        "last_name": "Mulako",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-277",
        "student_number": "202400975",
        "student_name": "Owen M. Mukela",
        "first_name": "Owen M.",
        "last_name": "Mukela",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-278",
        "student_number": "202407403",
        "student_name": "Previous Mukosha",
        "first_name": "Previous",
        "last_name": "Mukosha",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-279",
        "student_number": "202400421",
        "student_name": "Immaculate Mwanangombe",
        "first_name": "Immaculate",
        "last_name": "Mwanangombe",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-280",
        "student_number": "202301165",
        "student_name": "Houghton Chibozyi",
        "first_name": "Houghton",
        "last_name": "Chibozyi",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-281",
        "student_number": "202402071",
        "student_name": "Winnia Mwanza",
        "first_name": "Winnia",
        "last_name": "Mwanza",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-282",
        "student_number": "202400957",
        "student_name": "Bosswell Habenzu",
        "first_name": "Bosswell",
        "last_name": "Habenzu",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-283",
        "student_number": "202402043",
        "student_name": "Kamwemba Kulumuku",
        "first_name": "Kamwemba",
        "last_name": "Kulumuku",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-284",
        "student_number": "202409550",
        "student_name": "Wilfred Lungo",
        "first_name": "Wilfred",
        "last_name": "Lungo",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-285",
        "student_number": "202405691",
        "student_name": "Chakuletela Musukwa",
        "first_name": "Chakuletela",
        "last_name": "Musukwa",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-286",
        "student_number": "202403830",
        "student_name": "Charles Chisala",
        "first_name": "Charles",
        "last_name": "Chisala",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-287",
        "student_number": "202407202",
        "student_name": "Namasiku Beauty Siemisa",
        "first_name": "Namasiku Beauty",
        "last_name": "Siemisa",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-288",
        "student_number": "202401889",
        "student_name": "Fridah Muzungu",
        "first_name": "Fridah",
        "last_name": "Muzungu",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-289",
        "student_number": "202406520",
        "student_name": "Mundia Mundia",
        "first_name": "Mundia",
        "last_name": "Mundia",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-290",
        "student_number": "202408897",
        "student_name": "Marcus Malulu",
        "first_name": "Marcus",
        "last_name": "Malulu",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G06",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-291",
        "student_number": "202303351",
        "student_name": "Mwendalubi Mike Manyika",
        "first_name": "Mwendalubi Mike",
        "last_name": "Manyika",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-292",
        "student_number": "202406767",
        "student_name": "Bwalya Manyando",
        "first_name": "Bwalya",
        "last_name": "Manyando",
        "gender": "Female",
        "raw_program": "BSc in Computer Science",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-293",
        "student_number": "202404746",
        "student_name": "Rachael Shabolyo",
        "first_name": "Rachael",
        "last_name": "Shabolyo",
        "gender": "Female",
        "raw_program": "BSc in Computer Science",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-294",
        "student_number": "202408031",
        "student_name": "Edwin Makuya",
        "first_name": "Edwin",
        "last_name": "Makuya",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-295",
        "student_number": "202408025",
        "student_name": "Cryvet Simfukwe",
        "first_name": "Cryvet",
        "last_name": "Simfukwe",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-296",
        "student_number": "202404317",
        "student_name": "Yeshua Owen",
        "first_name": "Yeshua",
        "last_name": "Owen",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-297",
        "student_number": "202407565",
        "student_name": "Reagan Chisanga",
        "first_name": "Reagan",
        "last_name": "Chisanga",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-101",
        "student_number": "202408138",
        "student_name": "Chanda Mubanga",
        "first_name": "Chanda",
        "last_name": "Mubanga",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-298",
        "student_number": "202405883",
        "student_name": "Isaiah Mbangweta",
        "first_name": "Isaiah",
        "last_name": "Mbangweta",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-299",
        "student_number": "202409469",
        "student_name": "Mapalo Mwape",
        "first_name": "Mapalo",
        "last_name": "Mwape",
        "gender": "Female",
        "raw_program": "BSc in Computer Science",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-300",
        "student_number": "202402434",
        "student_name": "Ngosa Florence",
        "first_name": "Ngosa",
        "last_name": "Florence",
        "gender": "Female",
        "raw_program": "BSc in Computer Science",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-301",
        "student_number": "202403931",
        "student_name": "M'manga Modester",
        "first_name": "M'manga",
        "last_name": "Modester",
        "gender": "Female",
        "raw_program": "BSc in Computer Science",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-302",
        "student_number": "202400114",
        "student_name": "Kazembe Sing'ambwa",
        "first_name": "Kazembe",
        "last_name": "Sing'ambwa",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-303",
        "student_number": "202404096",
        "student_name": "Temwini Phiri",
        "first_name": "Temwini",
        "last_name": "Phiri",
        "gender": "Male",
        "raw_program": "Bsc in Computer Science",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-304",
        "student_number": "202401761",
        "student_name": "Caleb Mukelabai Kalimina",
        "first_name": "Caleb Mukelabai",
        "last_name": "Kalimina",
        "gender": "Male",
        "raw_program": "BSc in Computer Science",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G07",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-305",
        "student_number": "202406501",
        "student_name": "Bwalya Marvelous",
        "first_name": "Bwalya",
        "last_name": "Marvelous",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-306",
        "student_number": "202408157",
        "student_name": "Soko Zilombo Choolwe",
        "first_name": "Soko",
        "last_name": "Zilombo Choolwe",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-307",
        "student_number": "202408295",
        "student_name": "Mbewe Mathews",
        "first_name": "Mbewe",
        "last_name": "Mathews",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-308",
        "student_number": "202404634",
        "student_name": "Sakala Blessings",
        "first_name": "Sakala",
        "last_name": "Blessings",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-309",
        "student_number": "202409794",
        "student_name": "Moyo Sibongile",
        "first_name": "Moyo",
        "last_name": "Sibongile",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-310",
        "student_number": "202406011",
        "student_name": "Gumbo Dailess",
        "first_name": "Gumbo",
        "last_name": "Dailess",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-311",
        "student_number": "202409214",
        "student_name": "Shaba Patience",
        "first_name": "Shaba",
        "last_name": "Patience",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-312",
        "student_number": "202400397",
        "student_name": "Chishala Juliet",
        "first_name": "Chishala",
        "last_name": "Juliet",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-313",
        "student_number": "202407247",
        "student_name": "Chileshe Sampa",
        "first_name": "Chileshe",
        "last_name": "Sampa",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-314",
        "student_number": "201802185",
        "student_name": "Kabengele Remmy",
        "first_name": "Kabengele",
        "last_name": "Remmy",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-315",
        "student_number": "202402295",
        "student_name": "Miyambo Emmanuel",
        "first_name": "Miyambo",
        "last_name": "Emmanuel",
        "gender": "M",
        "raw_program": "Information Technology",
        "slot": 11,
        "program_code": "IT",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-316",
        "student_number": "202106741",
        "student_name": "Kanjela Musenge",
        "first_name": "Kanjela",
        "last_name": "Musenge",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G08",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-317",
        "student_number": "202406031",
        "student_name": "Florence Shimpa Musonda",
        "first_name": "Florence Shimpa",
        "last_name": "Musonda",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-318",
        "student_number": "202407879",
        "student_name": "Gerald Gondwe",
        "first_name": "Gerald",
        "last_name": "Gondwe",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-319",
        "student_number": "202400653",
        "student_name": "Bernadette Chanda",
        "first_name": "Bernadette",
        "last_name": "Chanda",
        "gender": "F",
        "raw_program": "IT",
        "slot": 3,
        "program_code": "IT",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-320",
        "student_number": "202403271",
        "student_name": "William Simbeye",
        "first_name": "William",
        "last_name": "Simbeye",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-321",
        "student_number": "202402510",
        "student_name": "Derrick Kabonso",
        "first_name": "Derrick",
        "last_name": "Kabonso",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-322",
        "student_number": "202405283",
        "student_name": "Miti Steven",
        "first_name": "Miti",
        "last_name": "Steven",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-323",
        "student_number": "202409051",
        "student_name": "Kampamba Charity",
        "first_name": "Kampamba",
        "last_name": "Charity",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-324",
        "student_number": "202403132",
        "student_name": "Benzu Himoonde",
        "first_name": "Benzu",
        "last_name": "Himoonde",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-325",
        "student_number": "202405388",
        "student_name": "Frazer Macha",
        "first_name": "Frazer",
        "last_name": "Macha",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-326",
        "student_number": "202408282",
        "student_name": "Timothy Malasha",
        "first_name": "Timothy",
        "last_name": "Malasha",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-327",
        "student_number": "202410672",
        "student_name": "Kalunga Mervis",
        "first_name": "Kalunga",
        "last_name": "Mervis",
        "gender": "F",
        "raw_program": "IT",
        "slot": 11,
        "program_code": "IT",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-328",
        "student_number": "202407064",
        "student_name": "Violet Ngoma",
        "first_name": "Violet",
        "last_name": "Ngoma",
        "gender": "F",
        "raw_program": "BsCS",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-329",
        "student_number": "201701343",
        "student_name": "Mweene Simon",
        "first_name": "Mweene",
        "last_name": "Simon",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-330",
        "student_number": "202406408",
        "student_name": "Chimbala Christopher",
        "first_name": "Chimbala",
        "last_name": "Christopher",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-331",
        "student_number": "202406593",
        "student_name": "Enock Simumba",
        "first_name": "Enock",
        "last_name": "Simumba",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G09",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-332",
        "student_number": "202406805",
        "student_name": "Eustuce Kasongo",
        "first_name": "Eustuce",
        "last_name": "Kasongo",
        "gender": "M",
        "raw_program": "BsCS",
        "slot": 16,
        "program_code": "CS",
        "group_code": null,
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-333",
        "student_number": "202404114",
        "student_name": "Beatrice Chibesa",
        "first_name": "Beatrice",
        "last_name": "Chibesa",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-334",
        "student_number": "202400350",
        "student_name": "Angel Bwalya",
        "first_name": "Angel",
        "last_name": "Bwalya",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-335",
        "student_number": "202400550",
        "student_name": "Evans Saikolo",
        "first_name": "Evans",
        "last_name": "Saikolo",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-336",
        "student_number": "202402843",
        "student_name": "Titus Bwalya",
        "first_name": "Titus",
        "last_name": "Bwalya",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-337",
        "student_number": "202404621",
        "student_name": "Ezron Chiluba",
        "first_name": "Ezron",
        "last_name": "Chiluba",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-338",
        "student_number": "202410470",
        "student_name": "Juliet Mulenga",
        "first_name": "Juliet",
        "last_name": "Mulenga",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-339",
        "student_number": "202402030",
        "student_name": "Ilukena Mundia",
        "first_name": "Ilukena",
        "last_name": "Mundia",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-340",
        "student_number": "202409245",
        "student_name": "Cascious Nyambe",
        "first_name": "Cascious",
        "last_name": "Nyambe",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-341",
        "student_number": "202410007",
        "student_name": "Aquirina Mulauzi",
        "first_name": "Aquirina",
        "last_name": "Mulauzi",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-342",
        "student_number": "202402824",
        "student_name": "Tobias Phiri",
        "first_name": "Tobias",
        "last_name": "Phiri",
        "gender": "M",
        "raw_program": "Information Technology",
        "slot": 10,
        "program_code": "IT",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-343",
        "student_number": "202410384",
        "student_name": "Mary Mula",
        "first_name": "Mary",
        "last_name": "Mula",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-344",
        "student_number": "202407468",
        "student_name": "Weston Mulenga",
        "first_name": "Weston",
        "last_name": "Mulenga",
        "gender": "M",
        "raw_program": "Information Technology",
        "slot": 12,
        "program_code": "IT",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-345",
        "student_number": "202404891",
        "student_name": "Christopher C.chimfwembe",
        "first_name": "Christopher",
        "last_name": "C.chimfwembe",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-346",
        "student_number": "202405964",
        "student_name": "Choolwe Mweembe",
        "first_name": "Choolwe",
        "last_name": "Mweembe",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-347",
        "student_number": "202410253",
        "student_name": "Oscar Chipango",
        "first_name": "Oscar",
        "last_name": "Chipango",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G10",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-348",
        "student_number": "202109428",
        "student_name": "Gaidon Sichone",
        "first_name": "Gaidon",
        "last_name": "Sichone",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 16,
        "program_code": "CS",
        "group_code": null,
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-349",
        "student_number": "202407015",
        "student_name": "Miti Katanga",
        "first_name": "Miti",
        "last_name": "Katanga",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-350",
        "student_number": "202404688",
        "student_name": "Mbasela Fabian",
        "first_name": "Mbasela",
        "last_name": "Fabian",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-351",
        "student_number": "202404172",
        "student_name": "Chola Ben",
        "first_name": "Chola",
        "last_name": "Ben",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-352",
        "student_number": "202403019",
        "student_name": "Hamasukwa Agrippa C.",
        "first_name": "Hamasukwa",
        "last_name": "Agrippa C.",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-353",
        "student_number": "202401150",
        "student_name": "Muunda Mainza",
        "first_name": "Muunda",
        "last_name": "Mainza",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-354",
        "student_number": "202001699",
        "student_name": "Mumbi Chibesa",
        "first_name": "Mumbi",
        "last_name": "Chibesa",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-355",
        "student_number": "",
        "student_name": "Simasiku Abel",
        "first_name": "Simasiku",
        "last_name": "Abel",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-356",
        "student_number": "202403846",
        "student_name": "Chanda Collins",
        "first_name": "Chanda",
        "last_name": "Collins",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-357",
        "student_number": "",
        "student_name": "Traore Mordecai Salim",
        "first_name": "Traore",
        "last_name": "Mordecai Salim",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-358",
        "student_number": "202405943",
        "student_name": "Chilufya Mapalo",
        "first_name": "Chilufya",
        "last_name": "Mapalo",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-359",
        "student_number": "202203897",
        "student_name": "Mwape Kelvin",
        "first_name": "Mwape",
        "last_name": "Kelvin",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-360",
        "student_number": "202206607",
        "student_name": "Kansamba Auxiria",
        "first_name": "Kansamba",
        "last_name": "Auxiria",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-361",
        "student_number": "",
        "student_name": "Makuyu Edwin",
        "first_name": "Makuyu",
        "last_name": "Edwin",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-362",
        "student_number": "202305732",
        "student_name": "Banda Salima",
        "first_name": "Banda",
        "last_name": "Salima",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-363",
        "student_number": "202403844",
        "student_name": "Traore Lamin",
        "first_name": "Traore",
        "last_name": "Lamin",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G11",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-364",
        "student_number": "202303375",
        "student_name": "Daka Racheal",
        "first_name": "Daka",
        "last_name": "Racheal",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 16,
        "program_code": "CS",
        "group_code": null,
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-365",
        "student_number": "202401321",
        "student_name": "Moon Clive",
        "first_name": "Moon",
        "last_name": "Clive",
        "gender": "M",
        "raw_program": "BSIT",
        "slot": 1,
        "program_code": "IT",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-366",
        "student_number": "202404407",
        "student_name": "Zimba Emmanuel",
        "first_name": "Zimba",
        "last_name": "Emmanuel",
        "gender": "M",
        "raw_program": "BSIT",
        "slot": 2,
        "program_code": "IT",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-367",
        "student_number": "202405095",
        "student_name": "Kaonga Memory",
        "first_name": "Kaonga",
        "last_name": "Memory",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-368",
        "student_number": "202405321",
        "student_name": "Mukupa Franscine",
        "first_name": "Mukupa",
        "last_name": "Franscine",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-369",
        "student_number": "202409728",
        "student_name": "Nakanyika Nsungani",
        "first_name": "Nakanyika",
        "last_name": "Nsungani",
        "gender": "F",
        "raw_program": "BSCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-370",
        "student_number": "202406233",
        "student_name": "Chipampe Stanslous",
        "first_name": "Chipampe",
        "last_name": "Stanslous",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-371",
        "student_number": "202401475",
        "student_name": "Mukonta Davis",
        "first_name": "Mukonta",
        "last_name": "Davis",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-372",
        "student_number": "202406877",
        "student_name": "Chishala Alfred",
        "first_name": "Chishala",
        "last_name": "Alfred",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-373",
        "student_number": "202301116",
        "student_name": "Phiri Brian",
        "first_name": "Phiri",
        "last_name": "Brian",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-374",
        "student_number": "202301173",
        "student_name": "Chola Simon",
        "first_name": "Chola",
        "last_name": "Simon",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-375",
        "student_number": "202300654",
        "student_name": "Ng'omba Kangwa",
        "first_name": "Ng'omba",
        "last_name": "Kangwa",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-376",
        "student_number": "202404608",
        "student_name": "Kabutu Ethel",
        "first_name": "Kabutu",
        "last_name": "Ethel",
        "gender": "F",
        "raw_program": "BSIT",
        "slot": 12,
        "program_code": "IT",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-377",
        "student_number": "202409694",
        "student_name": "Mwenda Hamulambo Sostern",
        "first_name": "Mwenda Hamulambo",
        "last_name": "Sostern",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-378",
        "student_number": "202404703",
        "student_name": "Masambu Kalenga",
        "first_name": "Masambu",
        "last_name": "Kalenga",
        "gender": "M",
        "raw_program": "BSCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G12",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-379",
        "student_number": "202408913",
        "student_name": "Silunji Victor",
        "first_name": "Silunji",
        "last_name": "Victor",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-380",
        "student_number": "202404454",
        "student_name": "Sakala Daniel",
        "first_name": "Sakala",
        "last_name": "Daniel",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-381",
        "student_number": "202410021",
        "student_name": "Mawere Saidi",
        "first_name": "Mawere",
        "last_name": "Saidi",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-382",
        "student_number": "202408632",
        "student_name": "Mwanza Taizya",
        "first_name": "Mwanza",
        "last_name": "Taizya",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-383",
        "student_number": "202406171",
        "student_name": "Mwitwa Clement",
        "first_name": "Mwitwa",
        "last_name": "Clement",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-384",
        "student_number": "202408752",
        "student_name": "Banda Agness",
        "first_name": "Banda",
        "last_name": "Agness",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-385",
        "student_number": "202400961",
        "student_name": "N'gandwe Charles",
        "first_name": "N'gandwe",
        "last_name": "Charles",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-386",
        "student_number": "202409714",
        "student_name": "M'soni Deborah",
        "first_name": "M'soni",
        "last_name": "Deborah",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-387",
        "student_number": "202402226",
        "student_name": "Ng'andu Lwendo",
        "first_name": "Ng'andu",
        "last_name": "Lwendo",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-388",
        "student_number": "202400014",
        "student_name": "Chile Bwalya",
        "first_name": "Chile",
        "last_name": "Bwalya",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-389",
        "student_number": "202404480",
        "student_name": "Banda Mphaso",
        "first_name": "Banda",
        "last_name": "Mphaso",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-390",
        "student_number": "202406515",
        "student_name": "Tembo Patience",
        "first_name": "Tembo",
        "last_name": "Patience",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-391",
        "student_number": "202407984",
        "student_name": "Mwambazi Grace",
        "first_name": "Mwambazi",
        "last_name": "Grace",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-392",
        "student_number": "202401433",
        "student_name": "Ndhlovu Godfrey",
        "first_name": "Ndhlovu",
        "last_name": "Godfrey",
        "gender": "M",
        "raw_program": "BCSC",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-393",
        "student_number": "202406496",
        "student_name": "Lungu Rebecca",
        "first_name": "Lungu",
        "last_name": "Rebecca",
        "gender": "F",
        "raw_program": "BCSC",
        "slot": 15,
        "program_code": "CS",
        "group_code": "G13",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-394",
        "student_number": "202406168",
        "student_name": "Jumbe Thabo",
        "first_name": "Jumbe",
        "last_name": "Thabo",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 1,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-395",
        "student_number": "202410082",
        "student_name": "Gondwe Joyce",
        "first_name": "Gondwe",
        "last_name": "Joyce",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-396",
        "student_number": "202401120",
        "student_name": "Kapinga Antonette",
        "first_name": "Kapinga",
        "last_name": "Antonette",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 3,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-397",
        "student_number": "202403000",
        "student_name": "Lungu Josephat",
        "first_name": "Lungu",
        "last_name": "Josephat",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-398",
        "student_number": "202407636",
        "student_name": "Namukanzye Foster",
        "first_name": "Namukanzye",
        "last_name": "Foster",
        "gender": "F",
        "raw_program": "Computer Science",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-399",
        "student_number": "202308118",
        "student_name": "Sikubeka Emmanuel",
        "first_name": "Sikubeka",
        "last_name": "Emmanuel",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-400",
        "student_number": "202410125",
        "student_name": "Judge Ezekiel",
        "first_name": "Judge",
        "last_name": "Ezekiel",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-401",
        "student_number": "202408068",
        "student_name": "Nduba Joel",
        "first_name": "Nduba",
        "last_name": "Joel",
        "gender": "M",
        "raw_program": "Computer Science",
        "slot": 8,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-402",
        "student_number": "202407198",
        "student_name": "Maseba Neo",
        "first_name": "Maseba",
        "last_name": "Neo",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-403",
        "student_number": "202402976",
        "student_name": "Mapulanga Henry",
        "first_name": "Mapulanga",
        "last_name": "Henry",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-404",
        "student_number": "202406795",
        "student_name": "Kalengo Andrew",
        "first_name": "Kalengo",
        "last_name": "Andrew",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 11,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-405",
        "student_number": "202408447",
        "student_name": "Kamfwa Nathan",
        "first_name": "Kamfwa",
        "last_name": "Nathan",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 12,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-406",
        "student_number": "202406183",
        "student_name": "Chansa Sylvester",
        "first_name": "Chansa",
        "last_name": "Sylvester",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-407",
        "student_number": "202301847",
        "student_name": "Njunga Emmanuel",
        "first_name": "Njunga",
        "last_name": "Emmanuel",
        "gender": "M",
        "raw_program": "Bsc Computer Science",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G14",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-408",
        "student_number": "202407073",
        "student_name": "Chabota Siyingwa",
        "first_name": "Chabota",
        "last_name": "Siyingwa",
        "gender": "M",
        "raw_program": "BScIT",
        "slot": 1,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-409",
        "student_number": "202404367",
        "student_name": "Reagan Chikumbutso Mbao",
        "first_name": "Reagan",
        "last_name": "Chikumbutso Mbao",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 2,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-410",
        "student_number": "202406336",
        "student_name": "Fedness Malilwe",
        "first_name": "Fedness",
        "last_name": "Malilwe",
        "gender": "F",
        "raw_program": "BScIT",
        "slot": 3,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-411",
        "student_number": "202408460",
        "student_name": "Musonda Amos",
        "first_name": "Musonda",
        "last_name": "Amos",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 4,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-412",
        "student_number": "202409112",
        "student_name": "Munesu Lemba",
        "first_name": "Munesu",
        "last_name": "Lemba",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 5,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-413",
        "student_number": "202408468",
        "student_name": "Arthur Sinyenga",
        "first_name": "Arthur",
        "last_name": "Sinyenga",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 6,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-414",
        "student_number": "202403876",
        "student_name": "Libuku Libuku",
        "first_name": "Libuku",
        "last_name": "Libuku",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 7,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-415",
        "student_number": "202402399",
        "student_name": "Alicia Kunda Muteba",
        "first_name": "Alicia",
        "last_name": "Kunda Muteba",
        "gender": "F",
        "raw_program": "BScIT",
        "slot": 8,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-416",
        "student_number": "202405510",
        "student_name": "Lutema Jutine Lutangu",
        "first_name": "Lutema",
        "last_name": "Jutine Lutangu",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 9,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-417",
        "student_number": "202407579",
        "student_name": "Lushomo Muteteete",
        "first_name": "Lushomo",
        "last_name": "Muteteete",
        "gender": "F",
        "raw_program": "BScCS",
        "slot": 10,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-418",
        "student_number": "202106055",
        "student_name": "Chirwa Janet",
        "first_name": "Chirwa",
        "last_name": "Janet",
        "gender": "F",
        "raw_program": "BScIT",
        "slot": 11,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-419",
        "student_number": "202408026",
        "student_name": "John Kabemba",
        "first_name": "John",
        "last_name": "Kabemba",
        "gender": "M",
        "raw_program": "BScIT",
        "slot": 12,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-420",
        "student_number": "202403212",
        "student_name": "Victor Lupenga",
        "first_name": "Victor",
        "last_name": "Lupenga",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 13,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-421",
        "student_number": "202407907",
        "student_name": "George Kunda",
        "first_name": "George",
        "last_name": "Kunda",
        "gender": "M",
        "raw_program": "BScCS",
        "slot": 14,
        "program_code": "CS",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    },
    {
        "student_id": "std-422",
        "student_number": "202404116",
        "student_name": "Temwananji Mutambo",
        "first_name": "Temwananji",
        "last_name": "Mutambo",
        "gender": "M",
        "raw_program": "BScIT",
        "slot": 15,
        "program_code": "IT",
        "group_code": "G15",
        "version": 1,
        "status": "active"
    }
],
      groups: [
    {
        "group_code": "G01",
        "capacity": 15,
        "schedule_day": "MON",
        "start_time": "15:00",
        "end_time": "17:00",
        "room": "CS - Old Dining Hall B"
    },
    {
        "group_code": "G02",
        "capacity": 15,
        "schedule_day": "MON",
        "start_time": "15:00",
        "end_time": "17:00",
        "room": "CS - Old Dining Hall B"
    },
    {
        "group_code": "G03",
        "capacity": 15,
        "schedule_day": "TUE",
        "start_time": "07:00",
        "end_time": "09:00",
        "room": "CS - Engineering Lab 3"
    },
    {
        "group_code": "G04",
        "capacity": 15,
        "schedule_day": "TUE",
        "start_time": "07:00",
        "end_time": "09:00",
        "room": "CS - Engineering Lab 3"
    },
    {
        "group_code": "G05",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "13:00",
        "end_time": "15:00",
        "room": "CS - SSS Block-C RM 2"
    },
    {
        "group_code": "G06",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "13:00",
        "end_time": "15:00",
        "room": "CS - SSS Block-C RM 2"
    },
    {
        "group_code": "G07",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "15:00",
        "end_time": "17:00",
        "room": "CS - SSS Block-E RM 1"
    },
    {
        "group_code": "G08",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "15:00",
        "end_time": "17:00",
        "room": "CS - SSS Block-E RM 1"
    },
    {
        "group_code": "G09",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "17:00",
        "end_time": "19:00",
        "room": "IT - Old Dining Hall B"
    },
    {
        "group_code": "G10",
        "capacity": 15,
        "schedule_day": "WED",
        "start_time": "17:00",
        "end_time": "19:00",
        "room": "IT - Old Dining Hall B"
    },
    {
        "group_code": "G11",
        "capacity": 15,
        "schedule_day": "THU",
        "start_time": "07:00",
        "end_time": "09:00",
        "room": "IT - Multi Purpose Hall"
    },
    {
        "group_code": "G12",
        "capacity": 15,
        "schedule_day": "THU",
        "start_time": "07:00",
        "end_time": "09:00",
        "room": "IT - Multi Purpose Hall"
    },
    {
        "group_code": "G13",
        "capacity": 15,
        "schedule_day": "FRI",
        "start_time": "11:00",
        "end_time": "13:00",
        "room": "ITED - SSS Block-B RM 2"
    },
    {
        "group_code": "G14",
        "capacity": 15,
        "schedule_day": "FRI",
        "start_time": "11:00",
        "end_time": "13:00",
        "room": "ITED - SSS Block-B RM 2"
    },
    {
        "group_code": "G15",
        "capacity": 15,
        "schedule_day": "FRI",
        "start_time": "11:00",
        "end_time": "13:00",
        "room": "CS - SSS Block-B RM 2"
    }
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
      if (!PROGRAMS.includes(program)) throw new ApiError(400, 'VALIDATION_ERROR', 'Programme must be CS, IT or ITED.');
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

      if (user.role === 'lecturer') {
        // Lecturer must connect to the live database first before student records populate.
        // If not yet synced from server, return the Empty State.
        if (!db.hasSyncedFromServer) {
          return this.delay({ students: [], groups: [], isUnsyncedEmptyState: true });
        }
        const students = active.map(normStudent);
        const groups = db.groups.map(g => normGroup({ ...g, active_count: this.activeCount(db, g.group_code) }));
        return this.delay({ students, groups, isUnsyncedEmptyState: false });
      } else {
        // Student view on Local DB: ONLY return this individual's group and its members/schedule
        const me = active.find(s => s.student_id === user.studentId || s.student_number === user.studentNumber || s.student_number === user.username);
        const myGroup = me && me.group_code;
        let students = [];
        let groups = [];
        if (myGroup) {
          students = active.filter(s => s.group_code === myGroup).map(normStudent);
          groups = db.groups
            .filter(g => g.group_code === myGroup)
            .map(g => normGroup({ ...g, active_count: this.activeCount(db, g.group_code) }));
        } else if (me) {
          students = [normStudent(me)];
        }
        return this.delay({ students, groups, isUnsyncedEmptyState: false });
      }
    },

    async createStudent(f) {
      const db = this.db();
      this.checkStudentFields(f.name, f.number, f.program);
      if (db.students.some(s => s.student_number === f.number)) throw new ApiError(409, 'DUPLICATE_STUDENT_NUMBER', 'That student number is already in use or reserved');
      const grp = f.group === 'UNASSIGNED' ? null : f.group;
      const grpObj = db.groups.find(g => g.group_code === grp); const cap = grpObj ? grpObj.capacity : 15; if (grp && this.activeCount(db, grp) >= cap) throw new ApiError(409, 'GROUP_FULL', `Group ${grp} is already at capacity (${cap})`);
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
      const grpObj = db.groups.find(g => g.group_code === newGroup); const cap = grpObj ? grpObj.capacity : 15;
      if (role === 'lecturer' && newGroup !== st.group_code && newGroup && this.activeCount(db, newGroup) >= cap) {
        throw new ApiError(409, 'GROUP_FULL', `Lab group ${newGroup} has reached maximum capacity of ${cap} students`);
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

    async resolveCorrection(requestId, decision, targetGroup) {
      const db = this.db();
      const req = (db.corrections || []).find(c => c.request_id == requestId);
      if (req) {
        const finalStatus = (decision === 'rejected') ? 'rejected' : 'approved';
        req.status = finalStatus;
        if (finalStatus === 'approved') {
          const st = db.students.find(s => s.student_id === req.student_id);
          if (st) {
            if (req.field_name === 'student_number') {
              st.student_number = req.requested_value;
            } else if (req.field_name === 'group_code') {
              const assigned = (targetGroup || req.requested_value || '').trim().toUpperCase();
              st.group_code = (assigned === 'UNASSIGNED') ? null : assigned;
              req.requested_value = assigned;
            }
            st.version = (st.version || 1) + 1;
          }
        }
        this.save(db);
      }
      return this.delay({ request_id: requestId, status: (decision === 'rejected') ? 'rejected' : 'approved', target_group: targetGroup });
    },

    async transferStudent(studentId, groupCode, expectedVersion) {
      const db = this.db();
      const st = db.students.find(s => s.student_id === studentId);
      if (!st || st.status !== 'active') throw new ApiError(404, 'NOT_FOUND', 'Student not found');
      const newGroup = groupCode === 'UNASSIGNED' ? null : groupCode;
      if (newGroup) {
        const grpObj = db.groups.find(g => g.group_code === newGroup);
        const cap = grpObj ? grpObj.capacity : 15;
        if (this.activeCount(db, newGroup) >= cap) {
          throw new ApiError(409, 'GROUP_FULL', `Group ${newGroup} is full (max ${cap})`);
        }
      }
      st.group_code = newGroup;
      st.version = (st.version || 1) + 1;
      this.save(db);
      return this.delay({ student_id: st.student_id, group_code: newGroup, version: st.version });
    },

    async createGroup(g) {
      const db = this.db();
      const code = String(g.group_code || '').trim().toUpperCase();
      if (!/^G\d{2,3}$/i.test(code)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Group code must be formatted like G15');
      }
      if (db.groups.some(x => x.group_code === code)) {
        throw new ApiError(409, 'DUPLICATE_GROUP_CODE', `Lab group ${code} already exists`);
      }
      const cap = Math.min(15, Math.max(1, parseInt(g.capacity, 10) || 15));
      if (!g.start_time || !g.end_time || g.start_time >= g.end_time) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'End time must be after start time');
      }
      let roomValue = String(g.room || '').trim();
      if (g.program_code && roomValue && !/^(CS|IT|ITED)\s*[\-]/i.test(roomValue)) {
        roomValue = `${g.program_code} - ${roomValue}`;
      }
      const newGrp = {
        group_code: code,
        capacity: cap,
        active_count: 0,
        schedule_day: g.schedule_day || 'MON',
        start_time: g.start_time,
        end_time: g.end_time,
        room: roomValue
      };
      db.groups.push(newGrp);
      db.groups.sort((a, b) => a.group_code.localeCompare(b.group_code, undefined, { numeric: true }));
      this.save(db);
      return this.delay(newGrp);
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

    getBaseUrl() {
      let u = (localStorage.getItem(LS_URL) || DEFAULT_URL).trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
      return u;
    },
    setBaseUrl(url) {
      let u = (url || '').trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
      localStorage.setItem(LS_URL, u || DEFAULT_URL);
    },

    async detect() {
      try {
        const r = await timeoutFetch(this.getBaseUrl() + '/api/health', {}, 5000);
        if (r && r.ok) {
          const j = await r.json();
          if (j && j.status === 'ok') {
            this.mode = 'live';
            return 'live';
          }
        }
        this.mode = 'demo';
      } catch (_) {
        this.mode = 'demo';
      }
      return this.mode;
    },

    resetDemoData() { localStorage.removeItem(LS_DB); },

    setToken(t) { live.setToken(t); },
    getToken() { return live.getToken(); },
    hasValidLiveToken() { return live.hasValidLiveToken(); },

    fetch: timeoutFetch,

    get impl() { return this.mode === 'live' ? live : demo; }
  };

  Api.saveDbCache = persistCapturedDbData;

  ['login', 'registerStudent', 'registerLecturer', 'loadData', 'createStudent', 'updateStudent',
    'deleteStudent', 'transferStudent', 'requestCorrection', 'requestGroupChange', 'getPendingCorrections', 'resolveCorrection', 'createGroup', 'updateSchedule', 'updateAvatar', 'logout'].forEach(fn => {
    Api[fn] = async function () {
      const args = arguments;
      const requiresAuth = !['login', 'registerStudent', 'registerLecturer'].includes(fn);

      // Unauthenticated operations (login / register) always attempt the live backend first
      if (!requiresAuth) {
        try {
          const res = await live[fn].apply(live, args);
          Api.mode = 'live';
          return res;
        } catch (err) {
          // If the server is truly unreachable, fall back to demo local cache
          if (err && (err.code === 'NETWORK' || err.status === 0 || (err.message && err.message.includes('Cannot reach')))) {
            console.warn(`[Network-First Fallback] Remote server unreachable for ${fn}. Trying local storage cache.`);
            Api.mode = 'demo';
            return demo[fn].apply(demo, args);
          }
          // Business errors from live server (401 credentials, 403 role mismatch, 409 duplicate): rethrow!
          throw err;
        }
      }

      // Authenticated operations: if we hold a live session token, communicate with live database
      if (live.hasValidLiveToken()) {
        try {
          const res = await live[fn].apply(live, args);
          Api.mode = 'live';
          return res;
        } catch (err) {
          if (err && (err.code === 'NETWORK' || err.status === 0 || (err.message && err.message.includes('Cannot reach')))) {
            console.warn(`[Network-First Fallback] Remote DB unreachable for ${fn}. Reading from local storage cache.`);
            Api.mode = 'demo';
            return demo[fn].apply(demo, args);
          }
          if (err && err.status === 401) {
            console.warn(`[Auth Fallback] Live session expired for ${fn}. Executing locally.`);
            Api.mode = 'demo';
            return demo[fn].apply(demo, args);
          }
          throw err;
        }
      }

      // Offline / unauthenticated demo execution
      return demo[fn].apply(demo, args);
    };
  });

  window.CCApi = Api;
})();
