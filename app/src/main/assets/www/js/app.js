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

  async function fetchLecturerPendingRequests() {
    if (!state.currentUser || state.currentUser.role !== 'lecturer' || !window.CCApi.getPendingCorrections) return;
    try {
      const res = await window.CCApi.getPendingCorrections();
      if (res && res.requests && res.requests.length > 0) {
        res.requests.forEach(req => {
          const notifId = 'req-' + req.request_id;
          if (!state.notifications.some(n => n.id === notifId)) {
            const isGroupChange = req.field_name === 'group_code';
            const title = isGroupChange ? `Group Change Request: ${req.student_name}` : `Number Correction: ${req.student_name}`;
            const message = isGroupChange
              ? `Student ${req.student_number} requested transfer from ${req.current_value} to Group ${req.requested_value}.`
              : `Student requested changing number from ${req.current_value} to ${req.requested_value}.`;

            state.notifications.unshift({
              id: notifId,
              requestId: req.request_id,
              isActionable: true,
              title: title,
              message: message,
              type: 'warning',
              time: 'Pending approval',
              read: false
            });
          }
        });
        updateNotificationBadge();
      }
    } catch (_) { /* offline / demo best effort */ }
  }

  // Crisp Flaticon-style inline SVG icon set
  const SVG_ICONS = {
    info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>',
    bolt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    close: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    filter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    share: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
    copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  };

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
      let iconSvg = SVG_ICONS.info;
      if (n.type === 'success') iconSvg = SVG_ICONS.check;
      if (n.type === 'destructive') iconSvg = SVG_ICONS.alert;
      if (n.type === 'warning') iconSvg = SVG_ICONS.bolt;

      return `
        <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
          <div class="notification-icon ${n.type}">${iconSvg}</div>
          <div class="notification-body">
            <div class="notification-title">${escapeHtml(n.title)}</div>
            <div class="notification-text">${escapeHtml(n.message)}</div>
            <div class="notification-time">${n.time}</div>
            ${n.isActionable ? `
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button class="btn btn-primary btn-sm notif-resolve-btn" data-id="${n.id}" data-reqid="${n.requestId}" data-action="approved" style="padding: 4px 10px; font-size: 0.74rem;">
                  ${SVG_ICONS.check} Approve
                </button>
                <button class="btn btn-secondary btn-sm notif-resolve-btn" data-id="${n.id}" data-reqid="${n.requestId}" data-action="rejected" style="padding: 4px 10px; font-size: 0.74rem; color: var(--color-destructive);">
                  ${SVG_ICONS.close} Reject
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', function (e) {
        if (e.target.closest('.notif-resolve-btn')) return;
        const id = this.getAttribute('data-id');
        const notif = state.notifications.find(n => n.id === id);
        if (notif) {
          notif.read = true;
          this.classList.remove('unread');
          updateNotificationBadge();
        }
      });
    });

    container.querySelectorAll('.notif-resolve-btn').forEach(btn => {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        const reqId = this.getAttribute('data-reqid');
        const action = this.getAttribute('data-action');
        const notifId = this.getAttribute('data-id');

        try {
          await window.CCApi.resolveCorrection(reqId, action);
          state.notifications = state.notifications.filter(n => n.id !== notifId);
          notifyPrompt('Request ' + (action === 'approved' ? 'Approved' : 'Rejected'), `Student request #${reqId} was ${action}.`, action === 'approved' ? 'success' : 'info');
          await loadAppDataset();
          renderDashboard();
          renderGroupsView();
          renderStudentList();
          renderNotificationsList();
          updateNotificationBadge();
        } catch (err) {
          notifyPrompt('Resolution Failed', err.message || 'Could not action request.', 'destructive');
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
    setupMicroInteractions();
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
  // Backend Connection Checker & Backoff Retry Scheduler
  // =========================================================================
  let backoffRetryDelaySec = 15; // Initial backoff: 15s -> 30s -> 60s -> 120s
  let backoffCountdownInterval = null;
  let nextRetryTimestamp = null;
  let isCheckingConnection = false;

  function stopBackoffCountdown() {
    if (backoffCountdownInterval) {
      clearInterval(backoffCountdownInterval);
      backoffCountdownInterval = null;
    }
    const cdEl = document.getElementById('offline-retry-countdown');
    if (cdEl) cdEl.textContent = '';
  }

  function startBackoffCountdown() {
    stopBackoffCountdown();
    nextRetryTimestamp = Date.now() + (backoffRetryDelaySec * 1000);

    const updateLabel = () => {
      const remainingSec = Math.max(0, Math.ceil((nextRetryTimestamp - Date.now()) / 1000));
      const cdEl = document.getElementById('offline-retry-countdown');
      if (cdEl) {
        cdEl.textContent = `Auto-retry in ${remainingSec}s`;
      }
      if (remainingSec <= 0) {
        stopBackoffCountdown();
        checkBackendConnection(false); // Scheduled retry without popup spam
      }
    };

    updateLabel();
    backoffCountdownInterval = setInterval(updateLabel, 1000);
  }

  async function checkBackendConnection(showNotification = true, isUserTriggered = false) {
    if (isCheckingConnection) return;
    isCheckingConnection = true;

    const pill = document.getElementById('server-status-pill');
    const banner = document.getElementById('offline-banner');
    const bannerLabel = document.getElementById('offline-banner-label');

    if (pill) {
      pill.textContent = 'Checking...';
      pill.className = 'badge';
    }

    const mode = await window.CCApi.detect();
    state.serverMode = mode;
    isCheckingConnection = false;

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

    if (mode === 'live') {
      // Server is online! Reset backoff schedule
      backoffRetryDelaySec = 15;
      stopBackoffCountdown();
      if (banner) banner.classList.remove('active');

      if (showNotification) {
        notifyPrompt('Server Connected', `Successfully connected to Node.js backend at ${window.CCApi.getBaseUrl()}`, 'success');
      }
    } else {
      // Server is offline: activate banner with backoff countdown
      if (banner) {
        banner.classList.add('active');
        if (bannerLabel) {
          bannerLabel.textContent = `Server Offline at ${window.CCApi.getBaseUrl()} — Using Local DB`;
        }
      }

      if (showNotification || isUserTriggered) {
        notifyPrompt(
          'Operating Offline (Local DB)',
          `Cannot reach server at ${window.CCApi.getBaseUrl()}. Next scheduled retry in ${backoffRetryDelaySec}s. Instant retries paused to save resources.`,
          'warning'
        );
      }

      // Schedule next backoff retry with countdown (15s -> 30s -> 60s -> 120s max)
      startBackoffCountdown();
      backoffRetryDelaySec = Math.min(120, backoffRetryDelaySec * 2);
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
            } else if (err.code === 'NETWORK' || !window.navigator.onLine || state.serverMode === 'demo') {
              notifyPrompt(
                'Server Unreachable — Offline Mode Available',
                'Unable to contact remote server. You can sign in using demo credentials (e.g. Student 202408138 / Student#2026 or Lecturer lecturer1 / Lecturer#2026) in Local DB.',
                'warning'
              );
              checkBackendConnection(false, true);
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
      if (state.currentUser.role === 'lecturer') {
        await fetchLecturerPendingRequests();
      }
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

    if (state.activeTab !== newTab) {
      if (!window._tabHistory) window._tabHistory = [];
      if (state.activeTab && state.activeTab !== 'auth') {
        window._tabHistory.push(state.activeTab);
        if (window._tabHistory.length > 20) window._tabHistory.shift();
      }
    }

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

    const resetAllFilters = function () {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      if (clearBtn) clearBtn.classList.remove('active');
      state.programFilter = 'ALL';
      state.groupFilter = 'ALL';
      if (groupSelect) groupSelect.value = 'ALL';
      const allBtn = document.querySelector('#program-segment [data-val="ALL"]');
      if (allBtn) allBtn.click();
      renderStudentList();
    };

    const resetFilterBtn = document.getElementById('empty-reset-btn');
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener('click', resetAllFilters);
    }

    const quickClearBtn = document.getElementById('btn-quick-clear-filters');
    if (quickClearBtn) {
      quickClearBtn.addEventListener('click', resetAllFilters);
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
    const activeFilterBar = document.getElementById('active-filter-bar');
    const activeFilterText = document.getElementById('active-filter-text');
    if (!container) return;

    // Update Active Filter Pill Bar
    if (activeFilterBar && activeFilterText) {
      const activeParts = [];
      if (state.groupFilter !== 'ALL') activeParts.push(`Group: ${state.groupFilter}`);
      if (state.programFilter !== 'ALL') activeParts.push(`Programme: ${state.programFilter}`);
      if (state.searchQuery) activeParts.push(`Query: "${state.searchQuery}"`);

      if (activeParts.length > 0) {
        activeFilterBar.style.display = 'flex';
        activeFilterText.textContent = `Filtered by ${activeParts.join(' • ')}`;
      } else {
        activeFilterBar.style.display = 'none';
      }
    }

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

    // View My Group Members Button
    const btnViewMyPeers = document.getElementById('btn-view-my-peers');
    if (btnViewMyPeers) {
      btnViewMyPeers.addEventListener('click', function () {
        if (!state.currentUser) return;
        const myRecord = state.students.find(s => s.id === state.currentUser.studentId) || state.students[0];
        const groupCode = myRecord ? myRecord.group_code : 'ALL';
        state.groupFilter = groupCode;
        const filterGroupSelect = document.getElementById('filter-group-select');
        if (filterGroupSelect) filterGroupSelect.value = groupCode;
        switchTab('students');
        notifyPrompt('Viewing Group Members', `Displaying all enrolled classmates in lab group ${groupCode}.`, 'info');
      });
    }

    // Request Group Change Modal Opener & Submission
    const btnOpenReqTransfer = document.getElementById('btn-open-request-transfer');
    if (btnOpenReqTransfer) {
      btnOpenReqTransfer.addEventListener('click', function () {
        openModal('request-transfer-modal');
      });
    }

    const requestTransferForm = document.getElementById('request-transfer-form');
    if (requestTransferForm) {
      requestTransferForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const targetGroup = document.getElementById('transfer-target-group').value;
        const reason = document.getElementById('transfer-reason').value.trim();

        try {
          await window.CCApi.requestGroupChange(targetGroup, reason);
          closeModal('request-transfer-modal');
          requestTransferForm.reset();
          notifyPrompt(
            'Transfer Request Sent (201)',
            `Your request to move to Group ${targetGroup} has been delivered to your lecturer's notification queue.`,
            'success'
          );
        } catch (err) {
          notifyPrompt('Request Failed', err.message || 'Could not send group transfer request.', 'destructive');
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
      if (res.claim_code) {
        copyToClipboard(res.claim_code, 'Claim Code', false);
      }
      notifyPrompt('Student Registered (201 Created)', `${name} enrolled. Claim code ${res.claim_code} copied to clipboard!`, 'success');
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
        <div class="card spotlight-card">
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
            <p style="font-size: 0.76rem; color: var(--color-text-muted); margin-top: 6px; display: flex; align-items: center;">
              ${SVG_ICONS.clock}<span>${escapeHtml(scheduleLabel)}</span>
            </p>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn btn-secondary btn-sm group-roster-filter-btn" data-group="${g.group_code}">
              ${SVG_ICONS.filter} Filter Roster
            </button>
            <button class="btn btn-secondary btn-sm group-share-btn" data-group="${g.group_code}" data-count="${count}">
              ${SVG_ICONS.share} Share Summary
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

    if (totalStudentsEl) animateCountUp(totalStudentsEl, state.students.length);
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
      bellBtn.addEventListener('click', async function () {
        await fetchLecturerPendingRequests();
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

    const iconSvg = type === 'success'
      ? SVG_ICONS.check
      : (type === 'destructive' ? SVG_ICONS.alert : (type === 'warning' ? SVG_ICONS.bolt : SVG_ICONS.info));

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">
        ${iconSvg}
      </span>
      <div>
        ${title ? `<div class="toast-title" style="font-size: 0.78rem; font-weight: 700; color: var(--color-primary);">${escapeHtml(title)}</div>` : ''}
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

  // =========================================================================
  // QoL & ReactBits.dev Micro-Interactions
  // =========================================================================
  function setupMicroInteractions() {
    // 1. Password Visibility Toggle Buttons (eye / eye-off SVG)
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const targetId = this.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        this.innerHTML = isHidden ? SVG_ICONS.eyeOff : SVG_ICONS.eye;
        NativeBridge.vibrate(10);
      });
    });

    // 2. One-Tap Copy Student Number Button
    const copyStudentNumBtn = document.getElementById('btn-copy-student-num');
    if (copyStudentNumBtn) {
      copyStudentNumBtn.addEventListener('click', function () {
        const numEl = document.getElementById('student-profile-num');
        if (!numEl) return;
        const text = numEl.textContent.trim();
        copyToClipboard(text, 'Student Number', true);
        this.classList.add('copied');
        this.innerHTML = SVG_ICONS.check;
        setTimeout(() => {
          this.classList.remove('copied');
          this.innerHTML = SVG_ICONS.copy;
        }, 1400);
      });
    }

    // 3. ReactBits Spotlight Card Pointer/Touch Coordinate Tracking
    document.addEventListener('pointermove', function (e) {
      const card = e.target.closest('.spotlight-card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    }, { passive: true });
  }

  function copyToClipboard(text, label = 'Value', showToastFeedback = true) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    NativeBridge.vibrate(15);
    if (showToastFeedback) {
      showToast(`${label} (${text}) copied to clipboard`, 'success', 'Copied');
    }
  }

  function animateCountUp(el, targetVal) {
    if (!el) return;
    const end = parseInt(targetVal, 10) || 0;
    if (window.anime) {
      const obj = { val: 0 };
      anime({
        targets: obj,
        val: end,
        round: 1,
        duration: 550,
        easing: 'easeOutExpo',
        update: function () {
          el.textContent = obj.val;
        }
      });
    } else {
      el.textContent = end;
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // Predictable back button bridge for Android
  window.handleAndroidBack = function () {
    // 1. If any modal is active, close the topmost modal
    const activeModals = document.querySelectorAll('.modal-overlay.active');
    if (activeModals && activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      topModal.classList.remove('active');
      return true; // Handled
    }

    // 2. If authenticated and not on dashboard, step back in tab history
    if (state.isAuthenticated && window._tabHistory && window._tabHistory.length > 0) {
      const prevTab = window._tabHistory.pop();
      if (prevTab && prevTab !== state.activeTab) {
        switchTab(prevTab);
        return true; // Handled
      }
    }

    // 3. If authenticated and on dashboard, return false to let Android exit/minimize
    return false;
  };

})();
