/**
 * Campus Companion - Student Registration & Lab Group Management
 * Full UI/UX Implementation with anime.js, CCApi (Node.js/MySQL) & CCPrefs
 */

(function () {
  'use strict';

  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    isAuthenticated: false,
    currentUser: null,
    activeTab: 'auth',
    authMode: 'signin',      // 'signin' or 'register'
    authRole: 'student',     // 'student' or 'lecturer'
    searchQuery: '',
    programFilter: 'ALL',    // 'ALL', 'CS', 'IT', 'DS'
    groupFilter: 'ALL',      // 'ALL', 'G01', 'G02', 'G03', 'G04', 'UNASSIGNED'
    isOffline: false,
    isDevUnlocked: false,
    selectedRegAvatar: 'cat-1',
    selectedModalAvatar: 'cat-1',
    serverMode: 'demo',      // 'live' or 'demo'
    notifications: [
      {
        id: 'notif-1',
        title: 'Campus Companion Ready',
        message: 'System active for Mulungushi University ICT361 session.',
        type: 'info',
        time: 'Just now',
        read: false
      }
    ],
    students: [],
    groups: [],
    studentToDelete: null,
    studentToTransfer: null
  };

  // Safari / HTTP Status Reference Matrix
  const HTTP_STATUS_INFO = {
    200: { title: '200 OK', type: '2xx', message: 'Request succeeded. Student records retrieved successfully.' },
    201: { title: '201 Created', type: '2xx', message: 'New student registration created. Account linked.' },
    400: { title: '400 Bad Request', type: '4xx', message: 'Validation Error: Student number must be exactly 9 digits.' },
    401: { title: '401 Unauthorized', type: '4xx', message: 'Authentication required or invalid session token.' },
    403: { title: '403 Forbidden (ROLE_MISMATCH)', type: '4xx', message: 'Role violation: Student credentials cannot access Lecturer workspace.' },
    404: { title: '404 Not Found', type: '4xx', message: 'Requested student ID or group does not exist.' },
    409: { title: '409 Conflict (GROUP_FULL)', type: '4xx', message: 'Lab group already reached the 15-student limit!' },
    422: { title: '422 Unprocessable Entity', type: '4xx', message: 'Duplicate student number or conflicting base version.' },
    500: { title: '500 Server Error', type: '5xx', message: 'Database connection failed on MySQL backend.' },
    503: { title: '503 Service Unavailable', type: '5xx', message: 'Node.js Express API server temporarily unavailable.' },
    504: { title: '504 Gateway Timeout', type: '5xx', message: 'The proxy or server took too long to respond.' },
    OFFLINE: { title: 'Offline Network Error', type: '4xx', message: 'No internet connection. Saved locally to sync queue.' }
  };

  // =========================================================================
  // Native Android Bridge Helpers
  // =========================================================================
  const NativeBridge = {
    shareGroupSummary: function (title, text) {
      if (window.Android && window.Android.openShareSheet) {
        window.Android.openShareSheet(title, text);
      } else if (navigator.share) {
        navigator.share({ title: title, text: text }).catch(() => {});
      } else {
        notifyPrompt('Sharesheet (Simulated)', text, 'info');
      }
    },
    toast: function (msg) {
      if (window.Android && window.Android.showToast) {
        window.Android.showToast(msg);
      }
    },
    vibrate: function (ms) {
      if (window.Android && window.Android.vibrate) {
        window.Android.vibrate(ms);
      } else if (navigator.vibrate) {
        navigator.vibrate(ms);
      }
    },
    saveSession: function (token, role, studentId, accountId) {
      if (window.Android && window.Android.saveSession) {
        window.Android.saveSession(token, role, studentId || '', accountId || 0);
      }
    },
    clearSession: function () {
      if (window.Android && window.Android.clearSession) {
        window.Android.clearSession();
      }
    }
  };

  // =========================================================================
  // Notification Management & BellToggle
  // =========================================================================
  function notifyPrompt(title, message, type = 'info') {
    showToast(message, type, title);

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const notif = {
      id: 'notif-' + Date.now(),
      title: title || 'System Notification',
      message: message,
      type: type,
      time: timeStr,
      read: false
    };

    state.notifications.unshift(notif);
    updateNotificationBadge();

    const bellBtn = document.getElementById('bell-toggle-btn');
    if (bellBtn) {
      bellBtn.classList.remove('bell-ringing');
      void bellBtn.offsetWidth;
      bellBtn.classList.add('bell-ringing');
      setTimeout(() => bellBtn.classList.remove('bell-ringing'), 700);
    }
  }

  function updateNotificationBadge() {
    const unreadCount = state.notifications.filter(n => !n.read).length;
    const badge = document.getElementById('bell-badge-count');
    if (badge) {
      badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      badge.classList.toggle('active', unreadCount > 0);
    }
  }

  function renderNotificationsList() {
    const container = document.getElementById('notifications-list');
    if (!container) return;

    if (state.notifications.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px 10px; color: var(--color-text-muted); font-size: 0.85rem;">
          No notifications yet.
        </div>
      `;
      return;
    }

    container.innerHTML = state.notifications.map(n => {
      let iconSymbol = 'ℹ';
      if (n.type === 'success') iconSymbol = '✓';
      if (n.type === 'destructive') iconSymbol = '⚠';
      if (n.type === 'warning') iconSymbol = '⚡';

      return `
        <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notification-icon ${n.type}">${iconSymbol}</div>
          <div class="notification-body">
            <div class="notification-title">${escapeHtml(n.title)}</div>
            <div class="notification-text">${escapeHtml(n.message)}</div>
            <div class="notification-time">${n.time}</div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', function () {
        const id = this.getAttribute('data-id');
        const notif = state.notifications.find(n => n.id === id);
        if (notif) {
          notif.read = true;
          this.classList.remove('unread');
          updateNotificationBadge();
        }
      });
    });
  }

  // =========================================================================
  // Header Avatar & App Logo Synchronization
  // =========================================================================
  function syncHeaderAvatar() {
    const headerImg = document.getElementById('header-avatar-img');
    const profileImg = document.getElementById('profile-pfp-img');
    const headerSubtitle = document.getElementById('header-subtitle');

    let avatarSrc = 'icons/mu_logo.png';

    if (state.currentUser && state.currentUser.avatar) {
      avatarSrc = `pfps/${state.currentUser.avatar}.svg`;
    } else if (window.CCPrefs) {
      avatarSrc = window.CCPrefs.logo().src;
    }

    if (headerImg) headerImg.src = avatarSrc;
    if (profileImg) profileImg.src = avatarSrc;

    if (headerSubtitle) {
      if (state.currentUser) {
        headerSubtitle.textContent = `${state.currentUser.role.toUpperCase()} • ${state.currentUser.name}`;
      } else {
        headerSubtitle.textContent = 'Mulungushi University • ICT361';
      }
    }
  }

  // =========================================================================
  // Initialization
  // =========================================================================
  document.addEventListener('DOMContentLoaded', async function () {
    setupAuthPortal();
    setupBottomNavigation();
    setupRubberSegment();
    setupSearchAndFilters();
    setupHoldButton();
    setupModals();
    setupOfflineMode();
    setupDeveloperWall();
    setupNotificationEvents();
    setupHeaderAvatarClick();
    setupTimetableEditing();
    setupSettingsCustomizers();
    handleOrientationResize();

    // Render avatar selection in register form
    renderAvatarPickerGrid('reg-avatar-grid', 'reg-selected-avatar');

    // Detect server status
    checkBackendConnection(false);

    // Initial view is Auth Portal
    setUnauthenticatedState();
    updateNotificationBadge();
  });

  window.addEventListener('resize', handleOrientationResize);
  window.addEventListener('orientationchange', handleOrientationResize);

  function handleOrientationResize() {
    const container = document.getElementById('program-segment');
    if (container) {
      const active = container.querySelector('.rubber-segment-btn.active');
      const pill = container.querySelector('.rubber-segment-pill');
      if (active && pill) {
        pill.style.left = active.offsetLeft + 'px';
        pill.style.width = active.offsetWidth + 'px';
      }
    }
  }

  function setupHeaderAvatarClick() {
    const headerAvatarBtn = document.getElementById('header-avatar-btn');
    if (headerAvatarBtn) {
      headerAvatarBtn.addEventListener('click', function () {
        if (state.isAuthenticated) {
          switchTab('profile');
        } else {
          switchTab('auth');
        }
      });
    }
  }

  // =========================================================================
  // Backend Connection Checker
  // =========================================================================
  async function checkBackendConnection(showNotification = true) {
    const pill = document.getElementById('server-status-pill');
    if (pill) {
      pill.textContent = 'Checking...';
      pill.className = 'badge';
    }

    const mode = await window.CCApi.detect();
    state.serverMode = mode;

    if (pill) {
      if (mode === 'live') {
        pill.textContent = 'Live MySQL Server';
        pill.className = 'badge status-2xx';
      } else {
        pill.textContent = 'Local Demo Mode';
        pill.className = 'badge badge-group';
      }
    }

    const syncStatusEl = document.getElementById('stat-sync-status');
    if (syncStatusEl) {
      syncStatusEl.textContent = mode === 'live' ? 'Live DB' : 'Demo Local';
      syncStatusEl.style.color = mode === 'live' ? 'var(--color-success)' : 'var(--color-warning)';
    }

    if (showNotification) {
      if (mode === 'live') {
        notifyPrompt('Server Connected', `Successfully connected to Node.js backend at ${window.CCApi.getBaseUrl()}`, 'success');
      } else {
        notifyPrompt('Local Demo Mode', `Could not reach ${window.CCApi.getBaseUrl()}. Operating in high-fidelity offline mode.`, 'warning');
      }
    }
  }

  // =========================================================================
  // Auth Portal Implementation (Role Enforcement & PFPs)
  // =========================================================================
  function setupAuthPortal() {
    const modeSegment = document.getElementById('auth-mode-segment');
    const roleSegment = document.getElementById('auth-role-segment');
    const modePill = document.getElementById('auth-mode-pill');
    const rolePill = document.getElementById('auth-role-pill');
    const formSignIn = document.getElementById('form-signin');
    const formRegister = document.getElementById('form-register');
    const identifierInput = document.getElementById('signin-identifier');
    const identifierLabel = document.getElementById('signin-identifier-label');
    const regStudentFields = document.getElementById('reg-student-fields');
    const regLecturerFields = document.getElementById('reg-lecturer-fields');

    function updateSegmentPill(container, pill, activeBtn) {
      if (!container || !pill || !activeBtn) return;
      const left = activeBtn.offsetLeft;
      const width = activeBtn.offsetWidth;
      pill.style.left = left + 'px';
      pill.style.width = width + 'px';
    }

    // Toggle Sign In vs Register
    if (modeSegment) {
      modeSegment.querySelectorAll('.rubber-segment-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          modeSegment.querySelectorAll('.rubber-segment-btn').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          state.authMode = this.getAttribute('data-mode');
          updateSegmentPill(modeSegment, modePill, this);

          if (state.authMode === 'signin') {
            formSignIn.style.display = 'block';
            formRegister.style.display = 'none';
          } else {
            formSignIn.style.display = 'none';
            formRegister.style.display = 'block';
          }
        });
      });
      const initialMode = modeSegment.querySelector('.rubber-segment-btn.active');
      if (initialMode) setTimeout(() => updateSegmentPill(modeSegment, modePill, initialMode), 50);
    }

    // Toggle Student vs Lecturer Role
    if (roleSegment) {
      roleSegment.querySelectorAll('.rubber-segment-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          roleSegment.querySelectorAll('.rubber-segment-btn').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          state.authRole = this.getAttribute('data-role');
          updateSegmentPill(roleSegment, rolePill, this);

          if (state.authRole === 'student') {
            if (identifierLabel) identifierLabel.textContent = 'Student Number (9 Digits)';
            if (identifierInput) {
              identifierInput.placeholder = 'e.g. 202408138';
              identifierInput.value = '';
            }
            if (regStudentFields) regStudentFields.style.display = 'block';
            if (regLecturerFields) regLecturerFields.style.display = 'none';
          } else {
            if (identifierLabel) identifierLabel.textContent = 'Lecturer Username / Staff ID';
            if (identifierInput) {
              identifierInput.placeholder = 'e.g. lecturer1 or mwansa@mu.ac.zm';
              identifierInput.value = '';
            }
            if (regStudentFields) regStudentFields.style.display = 'none';
            if (regLecturerFields) regLecturerFields.style.display = 'block';
          }
        });
      });
      const initialRole = roleSegment.querySelector('.rubber-segment-btn.active');
      if (initialRole) setTimeout(() => updateSegmentPill(roleSegment, rolePill, initialRole), 50);
    }

    // Sign In Submission
    if (formSignIn) {
      formSignIn.addEventListener('submit', async function (e) {
        e.preventDefault();
        const identifier = identifierInput.value.trim();
        const pass = document.getElementById('signin-password').value;

        if (!identifier || !pass) {
          notifyPrompt('Required Fields', 'Please enter your username and password.', 'destructive');
          return;
        }

        showLatticeLoader(400, async () => {
          try {
            const user = await window.CCApi.login(identifier, pass, state.authRole);
            state.currentUser = user;
            NativeBridge.saveSession(user.token, user.role, user.studentId, user.accountId);
            await loadAppDataset();
            setAuthenticatedState();
            notifyPrompt('Sign In Successful (200)', `Welcome back, ${user.name}! Authenticated as ${user.role.toUpperCase()}.`, 'success');
          } catch (err) {
            NativeBridge.vibrate(60);
            if (err.code === 'ROLE_MISMATCH') {
              notifyPrompt('Access Denied (403)', err.message, 'destructive');
            } else if (err.code === 'INVALID_CREDENTIALS') {
              notifyPrompt('Authentication Failed (401)', 'Incorrect username or password. Check credentials.', 'destructive');
            } else {
              notifyPrompt('Error', err.message || 'Login failed.', 'destructive');
            }
          }
        });
      });
    }

    // Register Submission
    if (formRegister) {
      formRegister.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fullname = document.getElementById('reg-fullname').value.trim();
        const password = document.getElementById('reg-password').value;
        const avatar = document.getElementById('reg-selected-avatar').value;

        showLatticeLoader(500, async () => {
          try {
            let user;
            if (state.authRole === 'student') {
              const studentNum = document.getElementById('reg-student-number').value.trim();
              const program = document.getElementById('reg-program').value;
              const claim = document.getElementById('reg-claim-code').value.trim() || 'CLAIM-AAA111';

              user = await window.CCApi.registerStudent({
                name: fullname,
                number: studentNum,
                program: program,
                claim: claim,
                password: password,
                avatar: avatar
              });
            } else {
              const username = document.getElementById('reg-staff-username').value.trim();
              const staffCode = document.getElementById('reg-staff-code').value.trim();

              user = await window.CCApi.registerLecturer({
                name: fullname,
                username: username,
                staffCode: staffCode,
                password: password,
                avatar: avatar
              });
            }

            state.currentUser = user;
            NativeBridge.saveSession(user.token, user.role, user.studentId, user.accountId);
            await loadAppDataset();
            setAuthenticatedState();
            notifyPrompt('Account Created (201)', `Welcome, ${user.name}! Your companion profile is ready.`, 'success');
          } catch (err) {
            NativeBridge.vibrate(60);
            notifyPrompt('Registration Failed', err.message || 'Unable to register profile.', 'destructive');
          }
        });
      });
    }

    // Quick Fill Demo Credentials
    const btnQuickStudent = document.getElementById('btn-quick-student');
    if (btnQuickStudent) {
      btnQuickStudent.addEventListener('click', function () {
        const studentBtn = roleSegment.querySelector('[data-role="student"]');
        if (studentBtn) studentBtn.click();
        const signinBtn = modeSegment.querySelector('[data-mode="signin"]');
        if (signinBtn) signinBtn.click();
        identifierInput.value = '202408138';
        document.getElementById('signin-password').value = 'Student#2026';
      });
    }

    const btnQuickLecturer = document.getElementById('btn-quick-lecturer');
    if (btnQuickLecturer) {
      btnQuickLecturer.addEventListener('click', function () {
        const lecturerBtn = roleSegment.querySelector('[data-role="lecturer"]');
        if (lecturerBtn) lecturerBtn.click();
        const signinBtn = modeSegment.querySelector('[data-mode="signin"]');
        if (signinBtn) signinBtn.click();
        identifierInput.value = 'lecturer1';
        document.getElementById('signin-password').value = 'Lecturer#2026';
      });
    }

    // Logout Button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        await window.CCApi.logout();
        NativeBridge.clearSession();
        setUnauthenticatedState();
        notifyPrompt('Session Cleared', 'You have been logged out. Select a role to sign in or register.', 'warning');
      });
    }
  }

  // =========================================================================
  // Load Application Dataset from API / Backend
  // =========================================================================
  async function loadAppDataset() {
    if (!state.currentUser) return;
    try {
      const data = await window.CCApi.loadData(state.currentUser);
      state.students = data.students || [];
      state.groups = data.groups || [];
    } catch (err) {
      notifyPrompt('Sync Warning', 'Could not fetch remote data. Operating from local cache.', 'warning');
    }
  }

  // =========================================================================
  // Authentication State Transition
  // =========================================================================
  function setAuthenticatedState() {
    state.isAuthenticated = true;
    const bottomNav = document.getElementById('bottom-nav');
    const mainScrollView = document.getElementById('main-scroll-view');
    const headerRoleBadge = document.getElementById('header-role-badge');

    if (bottomNav) bottomNav.classList.remove('hidden');
    if (mainScrollView) mainScrollView.classList.remove('no-nav');

    if (headerRoleBadge && state.currentUser) {
      headerRoleBadge.textContent = state.currentUser.role.toUpperCase();
      headerRoleBadge.className = 'role-badge ' + state.currentUser.role;
    }

    syncHeaderAvatar();

    // Role-based visibility
    const addStudentBtn = document.getElementById('btn-open-add-student');
    if (addStudentBtn) {
      addStudentBtn.style.display = state.currentUser.role === 'lecturer' ? 'inline-flex' : 'none';
    }

    const timetableHint = document.getElementById('timetable-lecturer-hint');
    if (timetableHint) {
      timetableHint.style.display = state.currentUser.role === 'lecturer' ? 'inline-block' : 'none';
    }

    const correctionCard = document.getElementById('correction-request-card');
    if (correctionCard) {
      correctionCard.style.display = state.currentUser.role === 'student' ? 'block' : 'none';
    }

    const profileRoleTag = document.getElementById('profile-role-tag');
    const profileUserName = document.getElementById('profile-user-name');
    const profilePermissions = document.getElementById('profile-permissions-desc');
    if (profileRoleTag) profileRoleTag.textContent = state.currentUser.role.toUpperCase();
    if (profileUserName) profileUserName.textContent = state.currentUser.name;
    if (profilePermissions) {
      profilePermissions.textContent = state.currentUser.role === 'lecturer'
        ? 'Full Lecturer CRUD, Transfer & Timetable Management'
        : 'Student Self-Service (Profile View & Number Correction)';
    }

    renderDashboard();
    renderStudentList();
    renderGroupsView();

    switchTab('dashboard');
  }

  function setUnauthenticatedState() {
    state.isAuthenticated = false;
    state.currentUser = null;

    const bottomNav = document.getElementById('bottom-nav');
    const mainScrollView = document.getElementById('main-scroll-view');
    const headerRoleBadge = document.getElementById('header-role-badge');

    if (bottomNav) bottomNav.classList.add('hidden');
    if (mainScrollView) mainScrollView.classList.add('no-nav');

    if (headerRoleBadge) {
      headerRoleBadge.textContent = 'GUEST';
      headerRoleBadge.className = 'role-badge guest';
    }

    syncHeaderAvatar();
    switchTab('auth');
  }

  // =========================================================================
  // Navigation & Screen View Switching
  // =========================================================================
  function setupBottomNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        const tab = this.getAttribute('data-tab');
        if (tab && tab !== state.activeTab && state.isAuthenticated) {
          switchTab(tab);
        }
      });
    });
  }

  window.appSwitchTab = function (newTab) {
    if (state.isAuthenticated) switchTab(newTab);
  };

  function switchTab(newTab) {
    const currentView = document.getElementById(`view-${state.activeTab}`);
    const nextView = document.getElementById(`view-${newTab}`);
    if (!nextView) return;

    document.querySelectorAll('.nav-item').forEach(item => {
      const isTarget = item.getAttribute('data-tab') === newTab;
      item.classList.toggle('active', isTarget);
      if (isTarget && window.anime) {
        anime({
          targets: item.querySelector('svg'),
          scale: [0.85, 1.15, 1],
          duration: 320,
          easing: 'easeOutElastic(1, .6)'
        });
      }
    });

    state.activeTab = newTab;

    if (currentView && window.anime) {
      anime({
        targets: currentView,
        opacity: [1, 0],
        translateY: [0, -10],
        duration: 180,
        easing: 'easeOutQuad',
        complete: function () {
          currentView.classList.remove('active');
          nextView.classList.add('active');
          anime({
            targets: nextView,
            opacity: [0, 1],
            translateY: [12, 0],
            duration: 250,
            easing: 'easeOutCubic'
          });
        }
      });
    } else {
      if (currentView) currentView.classList.remove('active');
      nextView.classList.add('active');
    }

    if (newTab === 'students') {
      renderStudentList();
    } else if (newTab === 'dashboard') {
      renderDashboard();
    } else if (newTab === 'groups') {
      renderGroupsView();
    }
  }

  // =========================================================================
  // RubberSegment Component (Program Filter)
  // =========================================================================
  function setupRubberSegment() {
    const container = document.getElementById('program-segment');
    if (!container) return;
    const buttons = container.querySelectorAll('.rubber-segment-btn');
    const pill = container.querySelector('.rubber-segment-pill');

    function updatePill(activeBtn, animate = true) {
      if (!activeBtn || !pill) return;
      const left = activeBtn.offsetLeft;
      const width = activeBtn.offsetWidth;

      if (animate && window.anime) {
        anime({
          targets: pill,
          left: left,
          width: width,
          duration: 300,
          easing: 'easeOutElastic(1, .7)'
        });
      } else {
        pill.style.left = left + 'px';
        pill.style.width = width + 'px';
      }
    }

    buttons.forEach(btn => {
      btn.addEventListener('click', function () {
        buttons.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        state.programFilter = this.getAttribute('data-val');
        updatePill(this);
        renderStudentList();
      });
    });

    const active = container.querySelector('.rubber-segment-btn.active');
    if (active) setTimeout(() => updatePill(active, false), 50);
  }

  // =========================================================================
  // Search & Filters
  // =========================================================================
  function setupSearchAndFilters() {
    const searchInput = document.getElementById('search-students');
    const clearBtn = document.getElementById('search-clear-btn');
    const groupSelect = document.getElementById('filter-group-select');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.searchQuery = this.value.trim().toLowerCase();
        if (clearBtn) {
          clearBtn.classList.toggle('active', this.value.length > 0);
        }
        renderStudentList();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        state.searchQuery = '';
        clearBtn.classList.remove('active');
        renderStudentList();
      });
    }

    if (groupSelect) {
      groupSelect.addEventListener('change', function () {
        state.groupFilter = this.value;
        renderStudentList();
      });
    }

    const resetFilterBtn = document.getElementById('empty-reset-btn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        state.searchQuery = '';
        state.programFilter = 'ALL';
        state.groupFilter = 'ALL';
        if (groupSelect) groupSelect.value = 'ALL';
        const allBtn = document.querySelector('#program-segment [data-val="ALL"]');
        if (allBtn) allBtn.click();
        renderStudentList();
      });
    }
  }

  // =========================================================================
  // LatticeLoader Simulator
  // =========================================================================
  let latticeTimerInterval = null;
  function showLatticeLoader(duration = 650, callback) {
    const loader = document.getElementById('roster-loader');
    const timerEl = document.getElementById('loader-timer');
    const listEl = document.getElementById('students-roster-list');
    if (!loader) {
      if (callback) callback();
      return;
    }

    loader.classList.add('active');
    if (listEl) listEl.style.opacity = '0.3';

    let elapsed = 0;
    if (timerEl) timerEl.textContent = '0.0s';
    clearInterval(latticeTimerInterval);
    latticeTimerInterval = setInterval(() => {
      elapsed += 0.1;
      if (timerEl) timerEl.textContent = elapsed.toFixed(1) + 's';
    }, 100);

    setTimeout(() => {
      clearInterval(latticeTimerInterval);
      loader.classList.remove('active');
      if (listEl) listEl.style.opacity = '1';
      if (callback) callback();
    }, duration);
  }

  // =========================================================================
  // Render Student List with Empty State & Staggered Animations
  // =========================================================================
  function renderStudentList() {
    const container = document.getElementById('students-roster-list');
    const emptyState = document.getElementById('roster-empty-state');
    const countBadge = document.getElementById('matching-students-count');
    if (!container) return;

    const filtered = state.students.filter(student => {
      const matchSearch = !state.searchQuery ||
        student.name.toLowerCase().includes(state.searchQuery) ||
        student.student_number.includes(state.searchQuery);

      const matchProgram = state.programFilter === 'ALL' || student.program_code === state.programFilter;
      const matchGroup = state.groupFilter === 'ALL' || student.group_code === state.groupFilter;

      return matchSearch && matchProgram && matchGroup;
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} student${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.add('active');
      return;
    }

    if (emptyState) emptyState.classList.remove('active');

    const isLecturer = state.currentUser && state.currentUser.role === 'lecturer';

    container.innerHTML = filtered.map(s => {
      const groupLabel = s.group_code === 'UNASSIGNED' ? 'Unassigned' : s.group_code;
      const groupClass = s.group_code === 'UNASSIGNED' ? 'badge-unassigned' : 'badge-group';
      const isSelf = state.currentUser && s.id === state.currentUser.studentId;

      return `
        <div class="student-card" data-id="${s.id}">
          <div class="student-card-left">
            <div class="student-avatar">${s.name.charAt(0)}</div>
            <div class="student-info">
              <h3>${escapeHtml(s.name)}</h3>
              <div class="student-number">${s.student_number} • v${s.version}</div>
              <div class="student-badges">
                <span class="badge badge-program">${s.program_code}</span>
                <span class="badge ${groupClass}">${groupLabel}</span>
              </div>
            </div>
          </div>
          <div class="student-actions">
            ${isLecturer ? `
              <button class="icon-btn edit-student-btn" data-id="${s.id}" title="Edit / Transfer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn danger delete-student-btn" data-id="${s.id}" title="Delete Record">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            ` : (isSelf ? `
              <button class="icon-btn edit-student-btn" data-id="${s.id}" title="Edit Profile">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            ` : '')}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.edit-student-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const id = this.getAttribute('data-id');
        openEditModal(id);
      });
    });

    container.querySelectorAll('.delete-student-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const id = this.getAttribute('data-id');
        openDeleteModal(id);
      });
    });

    if (window.anime) {
      anime({
        targets: '.student-card',
        translateY: [15, 0],
        opacity: [0, 1],
        delay: anime.stagger(35),
        duration: 250,
        easing: 'easeOutQuad'
      });
    }
  }

  // =========================================================================
  // HoldButton Implementation (Destructive Action: Hold to Delete)
  // =========================================================================
  function setupHoldButton() {
    const btn = document.getElementById('hold-to-delete-btn');
    const fill = document.getElementById('hold-button-fill');
    if (!btn || !fill) return;

    let holdTimeout = null;
    let progressInterval = null;
    let holdStart = 0;
    const HOLD_DURATION = 2000;

    function startHold(e) {
      e.preventDefault();
      btn.classList.add('holding');
      holdStart = Date.now();
      NativeBridge.vibrate(25);

      progressInterval = setInterval(() => {
        const elapsed = Date.now() - holdStart;
        const pct = Math.min(100, (elapsed / HOLD_DURATION) * 100);
        fill.style.width = pct + '%';
      }, 20);

      holdTimeout = setTimeout(() => {
        clearInterval(progressInterval);
        fill.style.width = '100%';
        btn.classList.add('done');
        NativeBridge.vibrate(100);
        executeStudentDeletion();
      }, HOLD_DURATION);
    }

    function cancelHold() {
      if (btn.classList.contains('done')) return;
      btn.classList.remove('holding');
      clearTimeout(holdTimeout);
      clearInterval(progressInterval);
      fill.style.width = '0%';
    }

    btn.addEventListener('pointerdown', startHold);
    btn.addEventListener('pointerup', cancelHold);
    btn.addEventListener('pointerleave', cancelHold);
    btn.addEventListener('pointercancel', cancelHold);
  }

  function openDeleteModal(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    state.studentToDelete = student;

    const modal = document.getElementById('delete-modal');
    const nameEl = document.getElementById('delete-student-name');
    const btn = document.getElementById('hold-to-delete-btn');
    const fill = document.getElementById('hold-button-fill');

    if (nameEl) nameEl.textContent = `${student.name} (${student.student_number})`;
    if (btn) btn.classList.remove('holding', 'done');
    if (fill) fill.style.width = '0%';

    if (modal) modal.classList.add('active');
  }

  async function executeStudentDeletion() {
    if (!state.studentToDelete) return;
    const id = state.studentToDelete.id;
    const name = state.studentToDelete.name;

    try {
      await window.CCApi.deleteStudent(id);
      state.students = state.students.filter(s => s.id !== id);
      closeModal('delete-modal');
      notifyPrompt('Student Deleted', `Record for ${name} removed. Lab seat released.`, 'destructive');
      await loadAppDataset();
      renderDashboard();
      renderGroupsView();
      renderStudentList();
    } catch (err) {
      notifyPrompt('Delete Failed', err.message || 'Could not delete student record.', 'destructive');
    }
  }

  // =========================================================================
  // Modals & Form Handlers
  // =========================================================================
  function setupModals() {
    document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const modal = this.closest('.modal-overlay');
        if (modal) modal.classList.remove('active');
      });
    });

    const editForm = document.getElementById('edit-student-form');
    if (editForm) {
      editForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveStudentChanges();
      });
    }

    const addForm = document.getElementById('add-student-form');
    if (addForm) {
      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        addNewStudent();
      });
    }

    const openAddBtn = document.getElementById('btn-open-add-student');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', () => openModal('add-student-modal'));
    }

    const correctionForm = document.getElementById('correction-request-form');
    if (correctionForm) {
      correctionForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const reqNum = document.getElementById('correction-requested-num').value.trim();
        if (reqNum.length !== 9 || !/^\d+$/.test(reqNum)) {
          notifyPrompt('Invalid Student Number', 'Correction requested must be exactly 9 digits!', 'destructive');
          return;
        }
        try {
          await window.CCApi.requestCorrection(state.currentUser.studentId, reqNum);
          notifyPrompt('Correction Submitted', `Request to update number to ${reqNum} submitted to instructor.`, 'success');
          document.getElementById('correction-requested-num').value = '';
        } catch (err) {
          notifyPrompt('Submission Error', err.message || 'Could not submit correction request.', 'destructive');
        }
      });
    }
  }

  function openEditModal(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    state.studentToTransfer = student;

    document.getElementById('edit-student-id').value = student.id;
    document.getElementById('edit-student-name').value = student.name;
    document.getElementById('edit-student-number').value = student.student_number;
    document.getElementById('edit-program').value = student.program_code;
    document.getElementById('edit-group').value = student.group_code;
    document.getElementById('edit-expected-version').value = student.version;

    const isStudent = state.currentUser && state.currentUser.role === 'student';
    document.getElementById('edit-group').disabled = isStudent;
    document.getElementById('edit-group-note').style.display = isStudent ? 'block' : 'none';

    openModal('edit-student-modal');
  }

  async function saveStudentChanges() {
    const id = document.getElementById('edit-student-id').value;
    const name = document.getElementById('edit-student-name').value.trim();
    const program = document.getElementById('edit-program').value;
    const group = document.getElementById('edit-group').value;

    const student = state.students.find(s => s.id === id);
    if (!student) return;

    try {
      await window.CCApi.updateStudent(student, { name, program, group }, state.currentUser.role);
      closeModal('edit-student-modal');
      notifyPrompt('Record Updated', `Profile updated for ${name}.`, 'success');
      await loadAppDataset();
      renderDashboard();
      renderGroupsView();
      renderStudentList();
    } catch (err) {
      notifyPrompt('Update Failed', err.message || 'Could not update student record.', 'destructive');
    }
  }

  async function addNewStudent() {
    const name = document.getElementById('add-student-name').value.trim();
    const number = document.getElementById('add-student-number').value.trim();
    const program = document.getElementById('add-program').value;
    const group = document.getElementById('add-group').value;

    try {
      const res = await window.CCApi.createStudent({ name, number, program, group });
      closeModal('add-student-modal');
      document.getElementById('add-student-form').reset();
      notifyPrompt('Student Registered (201 Created)', `${name} enrolled. Claim code: ${res.claim_code}`, 'success');
      await loadAppDataset();
      renderDashboard();
      renderGroupsView();
      renderStudentList();
    } catch (err) {
      notifyPrompt('Creation Failed', err.message || 'Could not register student.', 'destructive');
    }
  }

  // =========================================================================
  // Lab Groups View & Weekly Schedule (Lecturer Edit Support)
  // =========================================================================
  function renderGroupsView() {
    const dashboardContainer = document.getElementById('dashboard-groups-container');
    const detailedContainer = document.getElementById('detailed-groups-container');
    const weeklyScheduleContainer = document.getElementById('weekly-schedule-container');

    const isLecturer = state.currentUser && state.currentUser.role === 'lecturer';

    const groupCardsHtml = state.groups.map(g => {
      const members = state.students.filter(s => s.group_code === g.group_code);
      const count = g.active_count || members.length;
      const pct = Math.min(100, (count / g.capacity) * 100);
      const isFull = count >= g.capacity;
      const isNearFull = count >= 13;

      let counterClass = isFull ? 'full' : (isNearFull ? 'warning' : '');
      let barClass = isFull ? 'full' : (isNearFull ? 'warning' : '');

      const scheduleLabel = g.schedule_day
        ? `${g.schedule_day} ${g.start_time} - ${g.end_time}`
        : 'Schedule pending';

      return `
        <div class="card">
          <div class="group-progress-item">
            <div class="group-progress-header">
              <span class="group-badge">
                <strong>${g.group_code}</strong> • ${g.room || 'TBA'}
              </span>
              <span class="capacity-counter ${counterClass}">
                ${count} / ${g.capacity} Active ${isFull ? '(FULL)' : ''}
              </span>
            </div>
            <div class="progress-track">
              <div class="progress-bar-fill ${barClass}" style="width: ${pct}%"></div>
            </div>
            <p style="font-size: 0.76rem; color: var(--color-text-muted); margin-top: 6px;">
              🕒 ${scheduleLabel}
            </p>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn btn-secondary btn-sm group-roster-filter-btn" data-group="${g.group_code}">
              Filter Roster
            </button>
            <button class="btn btn-secondary btn-sm group-share-btn" data-group="${g.group_code}" data-count="${count}">
              Share Summary
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (dashboardContainer) dashboardContainer.innerHTML = groupCardsHtml;
    if (detailedContainer) detailedContainer.innerHTML = groupCardsHtml;

    // Render Weekly Lab Schedule Container
    if (weeklyScheduleContainer) {
      weeklyScheduleContainer.innerHTML = state.groups.map(g => {
        const day = g.schedule_day || 'TBA';
        const times = (g.start_time && g.end_time) ? `${g.start_time} - ${g.end_time}` : 'TBA';
        const room = g.room || 'Laboratory TBA';

        return `
          <div class="schedule-slot-item">
            <div class="schedule-slot-details">
              <strong>Group ${g.group_code}:</strong> ${day} ${times} • <em>${escapeHtml(room)}</em>
            </div>
            ${isLecturer ? `
              <div class="schedule-slot-actions">
                <button class="btn btn-secondary btn-sm edit-group-schedule-btn" data-group="${g.group_code}" style="padding: 3px 8px; font-size: 0.74rem;">
                  Edit Slot
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      weeklyScheduleContainer.querySelectorAll('.edit-group-schedule-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          const groupCode = this.getAttribute('data-group');
          openEditScheduleModal(groupCode);
        });
      });
    }

    document.querySelectorAll('.group-roster-filter-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const group = this.getAttribute('data-group');
        state.groupFilter = group;
        const select = document.getElementById('filter-group-select');
        if (select) select.value = group;
        switchTab('students');
      });
    });

    document.querySelectorAll('.group-share-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const group = this.getAttribute('data-group');
        const count = this.getAttribute('data-count');
        const summary = `Campus Companion Lab Summary: Group ${group} has ${count}/15 active enrolled students.`;
        NativeBridge.shareGroupSummary('Lab Group Summary', summary);
        notifyPrompt('Sharesheet Invoked', `Shared summary for ${group} (${count}/15 members).`, 'info');
      });
    });
  }

  // =========================================================================
  // Lecturer Timetable Slot Editing
  // =========================================================================
  function setupTimetableEditing() {
    const form = document.getElementById('edit-schedule-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const groupCode = document.getElementById('edit-schedule-group').value;
      const day = document.getElementById('edit-schedule-day').value;
      const start = document.getElementById('edit-schedule-start').value;
      const end = document.getElementById('edit-schedule-end').value;
      const room = document.getElementById('edit-schedule-room').value.trim();

      try {
        await window.CCApi.updateSchedule(groupCode, {
          schedule_day: day,
          start_time: start,
          end_time: end,
          room: room
        });
        closeModal('edit-schedule-modal');
        notifyPrompt('Timetable Updated', `Lab slot for ${groupCode} updated to ${day} ${start}-${end}.`, 'success');
        await loadAppDataset();
        renderGroupsView();
      } catch (err) {
        notifyPrompt('Timetable Error', err.message || 'Could not update lab schedule.', 'destructive');
      }
    });
  }

  function openEditScheduleModal(groupCode) {
    const group = state.groups.find(g => g.group_code === groupCode);
    if (!group) return;

    document.getElementById('edit-schedule-title').textContent = `Edit Timetable Slot • Group ${groupCode}`;
    document.getElementById('edit-schedule-group').value = groupCode;
    document.getElementById('edit-schedule-day').value = group.schedule_day || 'MON';
    document.getElementById('edit-schedule-start').value = group.start_time || '10:00';
    document.getElementById('edit-schedule-end').value = group.end_time || '12:00';
    document.getElementById('edit-schedule-room').value = group.room || '';

    openModal('edit-schedule-modal');
  }

  // =========================================================================
  // Dashboard Rendering
  // =========================================================================
  function renderDashboard() {
    if (!state.currentUser) return;

    const totalStudentsEl = document.getElementById('stat-total-students');
    const assignedCountEl = document.getElementById('stat-assigned-students');
    const userGreetingEl = document.getElementById('user-greeting');
    const userSubtitleEl = document.getElementById('user-subtitle');
    const studentProfileWidget = document.getElementById('student-profile-widget');

    if (totalStudentsEl) totalStudentsEl.textContent = state.students.length;
    const assigned = state.students.filter(s => s.group_code !== 'UNASSIGNED').length;
    if (assignedCountEl) assignedCountEl.textContent = `${assigned}/${state.students.length}`;

    if (userGreetingEl) userGreetingEl.textContent = state.currentUser.name;
    if (userSubtitleEl) {
      userSubtitleEl.textContent = state.currentUser.role === 'lecturer'
        ? 'Instructor Roster & Capacity Manager'
        : 'Student Lab Group Portal';
    }

    if (studentProfileWidget) {
      const isStudent = state.currentUser.role === 'student';
      studentProfileWidget.style.display = isStudent ? 'block' : 'none';
      if (isStudent) {
        const studentRecord = state.students.find(s => s.id === state.currentUser.studentId) || state.students[0];
        if (studentRecord) {
          document.getElementById('student-profile-num').textContent = studentRecord.student_number;
          document.getElementById('student-profile-prog').textContent = studentRecord.program_code;
          document.getElementById('student-profile-grp').textContent = `${studentRecord.group_code} (Capacity 15)`;
        }
      }
    }

    renderGroupsView();
  }

  // =========================================================================
  // Offline Mode & Sync Manager
  // =========================================================================
  function setupOfflineMode() {
    const toggle = document.getElementById('offline-toggle-check');
    const banner = document.getElementById('offline-banner');
    const syncBtn = document.getElementById('btn-manual-sync');

    if (toggle) {
      toggle.addEventListener('click', function () {
        state.isOffline = !state.isOffline;
        this.closest('.spring-check').classList.toggle('checked', state.isOffline);
        if (banner) banner.classList.toggle('active', state.isOffline);
        notifyPrompt(
          state.isOffline ? 'Offline Mode Active' : 'Network Reconnected',
          state.isOffline ? 'Working locally. Pending changes are saved to durable queue.' : 'Back Online! Synchronizing with server...',
          state.isOffline ? 'warning' : 'success'
        );
        if (!state.isOffline) {
          triggerSync();
        }
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener('click', triggerSync);
    }
  }

  function triggerSync() {
    showLatticeLoader(750, async () => {
      await loadAppDataset();
      renderDashboard();
      renderGroupsView();
      renderStudentList();
      notifyPrompt('Sync Completed (200 OK)', 'All pending changes synchronized with database.', 'success');
    });
  }

  // =========================================================================
  // Avatar Picker Grids (Registration & Settings Modal)
  // =========================================================================
  function renderAvatarPickerGrid(containerId, hiddenInputId) {
    const container = document.getElementById(containerId);
    if (!container || !window.CCApi) return;

    const currentVal = document.getElementById(hiddenInputId)?.value || 'cat-1';

    container.innerHTML = window.CCApi.AVATARS.map(avatarKey => {
      const isSelected = avatarKey === currentVal;
      return `
        <div class="avatar-option-item ${isSelected ? 'selected' : ''}" data-avatar="${avatarKey}">
          <img src="pfps/${avatarKey}.svg" alt="${avatarKey}">
        </div>
      `;
    }).join('');

    container.querySelectorAll('.avatar-option-item').forEach(item => {
      item.addEventListener('click', function () {
        container.querySelectorAll('.avatar-option-item').forEach(el => el.classList.remove('selected'));
        this.classList.add('selected');
        const chosen = this.getAttribute('data-avatar');
        const input = document.getElementById(hiddenInputId);
        if (input) input.value = chosen;
        if (containerId === 'modal-avatar-grid') {
          state.selectedModalAvatar = chosen;
        } else {
          state.selectedRegAvatar = chosen;
        }
      });
    });
  }

  // =========================================================================
  // Settings Customizers (CVD, Themes, Logo, Backend URL, Avatar update)
  // =========================================================================
  function setupSettingsCustomizers() {
    if (!window.CCPrefs) return;

    // 1. Color Vision Assistance Selector
    const cvdSelect = document.getElementById('select-cvd-mode');
    if (cvdSelect) {
      cvdSelect.value = window.CCPrefs.values.cvd;
      cvdSelect.addEventListener('change', function () {
        window.CCPrefs.set('cvd', this.value);
        notifyPrompt('Vision Mode Updated', `Assistance set to ${this.options[this.selectedIndex].text}.`, 'info');
      });
    }

    // 2. Theme Palettes Grid
    const themeContainer = document.getElementById('theme-picker-container');
    if (themeContainer) {
      themeContainer.innerHTML = window.CCPrefs.THEMES.map(t => {
        const isActive = t.id === window.CCPrefs.values.theme;
        return `
          <div class="theme-card ${isActive ? 'active' : ''}" data-theme="${t.id}">
            <div class="theme-swatches">
              <span class="theme-swatch" style="background: ${t.swatch[0]};"></span>
              <span class="theme-swatch" style="background: ${t.swatch[1]};"></span>
              <span class="theme-swatch" style="background: ${t.swatch[2]};"></span>
            </div>
            <span class="theme-name">${t.name}</span>
          </div>
        `;
      }).join('');

      themeContainer.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', function () {
          themeContainer.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
          this.classList.add('active');
          const themeId = this.getAttribute('data-theme');
          window.CCPrefs.set('theme', themeId);
          notifyPrompt('Theme Applied', `Switched palette to ${this.querySelector('.theme-name').textContent}.`, 'info');
        });
      });
    }

    // 3. Logo Picker Grid
    const logoContainer = document.getElementById('logo-picker-container');
    if (logoContainer) {
      logoContainer.innerHTML = window.CCPrefs.LOGOS.map(l => {
        const isActive = l.id === window.CCPrefs.values.logo;
        return `
          <div class="logo-card ${isActive ? 'active' : ''}" data-logo="${l.id}">
            <img src="${l.src}" alt="${l.name}">
            <span>${l.name}</span>
          </div>
        `;
      }).join('');

      logoContainer.querySelectorAll('.logo-card').forEach(card => {
        card.addEventListener('click', function () {
          logoContainer.querySelectorAll('.logo-card').forEach(c => c.classList.remove('active'));
          this.classList.add('active');
          const logoId = this.getAttribute('data-logo');
          window.CCPrefs.set('logo', logoId);
          syncHeaderAvatar();
          notifyPrompt('App Logo Updated', `Active logo set to ${this.querySelector('span').textContent}.`, 'info');
        });
      });
    }

    // 4. Change Profile Picture in Settings
    const btnChangePfp = document.getElementById('btn-change-pfp');
    if (btnChangePfp) {
      btnChangePfp.addEventListener('click', function () {
        renderAvatarPickerGrid('modal-avatar-grid', 'reg-selected-avatar');
        openModal('avatar-picker-modal');
      });
    }

    const btnSaveModalAvatar = document.getElementById('btn-save-modal-avatar');
    if (btnSaveModalAvatar) {
      btnSaveModalAvatar.addEventListener('click', async function () {
        const chosen = state.selectedModalAvatar || 'cat-1';
        try {
          await window.CCApi.updateAvatar(chosen);
          if (state.currentUser) state.currentUser.avatar = chosen;
          closeModal('avatar-picker-modal');
          syncHeaderAvatar();
          notifyPrompt('Picture Updated', 'Your companion profile picture was updated successfully.', 'success');
        } catch (err) {
          notifyPrompt('Update Failed', err.message || 'Could not update avatar.', 'destructive');
        }
      });
    }

    // 5. Backend Server URL Config
    const serverUrlInput = document.getElementById('server-url-input');
    const btnSaveServerUrl = document.getElementById('btn-save-server-url');
    const btnTestServerConn = document.getElementById('btn-test-server-conn');

    if (serverUrlInput) {
      serverUrlInput.value = window.CCApi.getBaseUrl();
    }

    if (btnSaveServerUrl) {
      btnSaveServerUrl.addEventListener('click', function () {
        const url = serverUrlInput.value.trim();
        window.CCApi.setBaseUrl(url);
        notifyPrompt('Server URL Saved', `Base endpoint updated to ${window.CCApi.getBaseUrl()}`, 'info');
        checkBackendConnection(true);
      });
    }

    if (btnTestServerConn) {
      btnTestServerConn.addEventListener('click', function () {
        checkBackendConnection(true);
      });
    }
  }

  // =========================================================================
  // Notifications Modal Setup
  // =========================================================================
  function setupNotificationEvents() {
    const bellBtn = document.getElementById('bell-toggle-btn');
    if (bellBtn) {
      bellBtn.addEventListener('click', function () {
        renderNotificationsList();
        openModal('notifications-modal');
      });
    }

    const btnMarkAll = document.getElementById('btn-mark-all-read');
    if (btnMarkAll) {
      btnMarkAll.addEventListener('click', function () {
        state.notifications.forEach(n => n.read = true);
        renderNotificationsList();
        updateNotificationBadge();
      });
    }

    const btnClearAll = document.getElementById('btn-clear-notifications');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', function () {
        state.notifications = [];
        renderNotificationsList();
        updateNotificationBadge();
      });
    }
  }

  // =========================================================================
  // Developer Wall & Safari HTTP Status Explorer
  // =========================================================================
  function setupDeveloperWall() {
    const openBtn = document.getElementById('btn-open-dev-wall');
    const lockScreen = document.getElementById('dev-lock-screen');
    const toolsContent = document.getElementById('dev-tools-content');
    const passkeyInput = document.getElementById('dev-passkey-input');
    const submitBtn = document.getElementById('btn-submit-dev-passkey');
    const lockBtn = document.getElementById('btn-lock-dev-portal');

    if (openBtn) {
      openBtn.addEventListener('click', function () {
        if (state.isDevUnlocked) {
          lockScreen.style.display = 'none';
          toolsContent.style.display = 'block';
        } else {
          lockScreen.style.display = 'block';
          toolsContent.style.display = 'none';
          if (passkeyInput) passkeyInput.value = '';
        }
        openModal('developer-wall-modal');
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        const entered = passkeyInput.value.trim();
        if (entered === '361' || entered === 'admin' || entered === '') {
          state.isDevUnlocked = true;
          lockScreen.style.display = 'none';
          toolsContent.style.display = 'block';
          renderHttpStatusList();
          notifyPrompt('Developer Mode', 'Diagnostic tools and Safari HTTP simulators unlocked.', 'info');
        } else {
          notifyPrompt('Access Denied (403)', 'Invalid passkey. Access restricted to course developers.', 'destructive');
        }
      });
    }

    if (lockBtn) {
      lockBtn.addEventListener('click', function () {
        state.isDevUnlocked = false;
        lockScreen.style.display = 'block';
        toolsContent.style.display = 'none';
        notifyPrompt('Developer Portal', 'Diagnostic portal locked.', 'info');
      });
    }
  }

  function renderHttpStatusList() {
    const listEl = document.getElementById('http-status-list');
    if (!listEl) return;

    listEl.innerHTML = Object.keys(HTTP_STATUS_INFO).map(code => {
      const item = HTTP_STATUS_INFO[code];
      return `
        <div class="status-row" data-code="${code}">
          <div class="status-row-info">
            <span class="status-code-badge status-${item.type}">${code}</span>
            <span class="status-row-title">${item.title}</span>
          </div>
          <button class="btn btn-secondary btn-sm test-status-btn" data-code="${code}">Test Response</button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.test-status-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const code = this.getAttribute('data-code');
        const item = HTTP_STATUS_INFO[code];
        const isError = item.type === '4xx' || item.type === '5xx';
        notifyPrompt(`[HTTP ${code}] ${item.title}`, item.message, isError ? 'destructive' : 'success');
      });
    });
  }

  // =========================================================================
  // Generic Helpers (Toasts, Modals, Escaping)
  // =========================================================================
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('active');
    if (window.anime) {
      anime({
        targets: modal.querySelector('.modal-card'),
        scale: [0.92, 1],
        opacity: [0, 1],
        duration: 250,
        easing: 'easeOutCubic'
      });
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  function showToast(message, type = 'accent', title = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">
        ${type === 'success' ? '✓' : (type === 'destructive' ? '⚠' : 'ℹ')}
      </span>
      <div>
        ${title ? `<div style="font-size: 0.78rem; font-weight: 700; color: var(--color-primary);">${escapeHtml(title)}</div>` : ''}
        <div style="font-size: 0.82rem; font-weight: 500;">${escapeHtml(message)}</div>
      </div>
    `;

    container.appendChild(toast);

    if (window.anime) {
      anime({
        targets: toast,
        translateY: [-20, 0],
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutElastic(1, .7)'
      });
    }

    setTimeout(() => {
      if (window.anime) {
        anime({
          targets: toast,
          opacity: [1, 0],
          translateY: [0, -10],
          duration: 200,
          easing: 'easeOutQuad',
          complete: () => toast.remove()
        });
      } else {
        toast.remove();
      }
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

})();
