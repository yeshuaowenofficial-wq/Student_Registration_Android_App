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
    exportGroupExcel: function (fileName, groupTitle, rows) {
      if (window.Android && typeof window.Android.exportGroupExcel === 'function') {
        window.Android.exportGroupExcel(fileName, groupTitle, JSON.stringify(rows));
        return;
      }
      // Browser fallback: trigger CSV download that opens in Excel
      const csvLines = [
        `,,,${groupTitle},,,`,
        ...rows.map(r => `,${r.no},${r.firstName || ''},${r.lastName || ''},${r.studentNumber || ''},${r.gender || ''},${r.programme || ''}`)
      ];
      const csvBlob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(csvBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.xlsx$/i, '.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    },
    hideKeyboard: function () {
      if (window.Android && window.Android.hideKeyboard) {
        window.Android.hideKeyboard();
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
              isGroupChange: isGroupChange,
              requestedGroup: req.requested_value,
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
    excel: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h2l2 3 2-3h2"/><path d="M8 17h2l2-3 2 3h2"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
    copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  };

  function openReassignModal(reqId, notifId, title) {
    const reqInput = document.getElementById('reassign-req-id');
    const notifInput = document.getElementById('reassign-notif-id');
    const desc = document.getElementById('reassign-request-desc');
    const select = document.getElementById('reassign-select-group');
    const confirmBtn = document.getElementById('btn-confirm-reassign');

    if (reqInput) reqInput.value = reqId;
    if (notifInput) notifInput.value = notifId;
    if (desc) desc.textContent = `Select an available lab group for ${title.replace('Group Change Request: ', '')}:`;

    if (select) {
      const available = state.groups.filter(g => (g.active_count || 0) < (g.capacity || 15));
      if (available.length === 0) {
        select.innerHTML = '<option value="" disabled selected>No other groups have open capacity</option>';
        if (confirmBtn) confirmBtn.disabled = true;
      } else {
        if (confirmBtn) confirmBtn.disabled = false;
        select.innerHTML = available.map(g => {
          const sched = g.schedule_day ? `${g.schedule_day} ${g.start_time}-${g.end_time}` : 'Schedule TBA';
          const openCount = (g.capacity || 15) - (g.active_count || 0);
          return `<option value="${g.group_code}">${g.group_code} (${openCount} seats open • ${sched} • ${escapeHtml(g.room || 'TBA')})</option>`;
        }).join('');
      }
    }
    openModal('modal-reassign-request');
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
              <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm notif-resolve-btn" data-id="${n.id}" data-reqid="${n.requestId}" data-action="approved" style="padding: 4px 10px; font-size: 0.74rem;">
                  ${SVG_ICONS.check} Approve
                </button>
                <button class="btn btn-secondary btn-sm notif-resolve-btn" data-id="${n.id}" data-reqid="${n.requestId}" data-action="rejected" style="padding: 4px 10px; font-size: 0.74rem; color: var(--color-destructive);">
                  ${SVG_ICONS.close} Deny
                </button>
                ${n.isGroupChange ? `
                  <button class="btn btn-secondary btn-sm notif-reassign-btn" data-id="${n.id}" data-reqid="${n.requestId}" data-title="${escapeHtml(n.title)}" style="padding: 4px 10px; font-size: 0.74rem;">
                    Put in Another Group...
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', function (e) {
        if (e.target.closest('.notif-resolve-btn') || e.target.closest('.notif-reassign-btn')) return;
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
          notifyPrompt('Request ' + (action === 'approved' ? 'Approved' : 'Denied'), `Student request #${reqId} was ${action}.`, action === 'approved' ? 'success' : 'info');
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

    container.querySelectorAll('.notif-reassign-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const reqId = this.getAttribute('data-reqid');
        const notifId = this.getAttribute('data-id');
        const title = this.getAttribute('data-title');
        openReassignModal(reqId, notifId, title);
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
    setupPreLoginServerConfig();
    setupHeaderAvatarClick();
    setupTimetableEditing();
    setupSettingsCustomizers();
    setupMicroInteractions();
    handleOrientationResize();

    // Render avatar selection in register form
    renderAvatarPickerGrid('reg-avatar-grid', 'reg-selected-avatar');

    // Detect server status & initiate consistent background heartbeat
    checkBackendConnection(false);
    startServerHeartbeat();

    // Initial view is Auth Portal
    setUnauthenticatedState();
    updateNotificationBadge();

    // In Beta flavor (Approach 1), trigger background auto-discovery immediately on startup
    try {
      const flavor = (window.Android && window.Android.getAppFlavor) ? window.Android.getAppFlavor() : 'base';
      if (flavor === 'beta') {
        setTimeout(() => {
          if (state.serverMode !== 'live') {
            triggerAutoDiscovery(true);
          }
        }, 1000);
      }
    } catch (_) {}
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

  // Consistent prescribed interval ping (every 5 seconds) to immediately detect disconnect or reconnection
  let serverHeartbeatInterval = null;
  let consecutiveHeartbeatFailures = 0;

  function startServerHeartbeat() {
    if (serverHeartbeatInterval) clearInterval(serverHeartbeatInterval);
    serverHeartbeatInterval = setInterval(async () => {
      if (document.hidden || isCheckingConnection) return;
      try {
        const doFetch = (window.CCApi && window.CCApi.fetch) ? window.CCApi.fetch : fetch;
        const res = await doFetch(window.CCApi.getBaseUrl() + '/api/health', { method: 'GET' }, 6000);
        if (res.ok) {
          consecutiveHeartbeatFailures = 0;
          if (state.serverMode !== 'live') {
            await checkBackendConnection(false, false);
          } else if (state.isAuthenticated && state.currentUser && state.currentUser.role === 'lecturer') {
            fetchLecturerPendingRequests();
          }
        } else {
          throw new Error('HTTP ' + res.status);
        }
      } catch (_) {
        consecutiveHeartbeatFailures++;
        if (consecutiveHeartbeatFailures >= 3 && state.serverMode === 'live') {
          // Detected service stopped / server disconnected after 3 consecutive missed pings!
          state.serverMode = 'demo';
          window.CCApi.mode = 'demo';
          const pill = document.getElementById('server-status-pill');
          if (pill) {
            pill.textContent = 'Local Demo Mode';
            pill.className = 'badge badge-group';
          }
          const syncStatusEl = document.getElementById('stat-sync-status');
          if (syncStatusEl) {
            syncStatusEl.textContent = state.isUnsyncedEmptyState ? 'Not Synced' : 'Local Cache';
            syncStatusEl.style.color = 'var(--color-warning)';
          }
          const banner = document.getElementById('offline-banner');
          if (banner) banner.classList.add('active');
          const bannerLabel = document.getElementById('offline-banner-label');
          if (bannerLabel) {
            bannerLabel.textContent = `Server Offline at ${window.CCApi.getBaseUrl()} — Using Local DB`;
          }
          notifyPrompt('Server Disconnected', `Lost connection to backend server at ${window.CCApi.getBaseUrl()}. Switched to offline state.`, 'destructive');
          startBackoffCountdown();
        }
      }
    }, 15000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.isAuthenticated && state.serverMode === 'live') {
      checkBackendConnection(false, false);
    }
  });

  async function checkBackendConnection(showNotification = true, isUserTriggered = false) {
    if (isCheckingConnection && !isUserTriggered) return;
    isCheckingConnection = true;

    const pill = document.getElementById('server-status-pill');
    const banner = document.getElementById('offline-banner');
    const bannerLabel = document.getElementById('offline-banner-label');

    if (pill) {
      pill.textContent = 'Checking...';
      pill.className = 'badge';
    }

    try {
      const prevMode = state.serverMode;
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
        syncStatusEl.textContent = mode === 'live' ? 'Live DB' : (state.isUnsyncedEmptyState ? 'Not Synced' : 'Local Cache');
        syncStatusEl.style.color = mode === 'live' ? 'var(--color-success)' : 'var(--color-warning)';
      }

      if (mode === 'live') {
        consecutiveHeartbeatFailures = 0;
        backoffRetryDelaySec = 15;
        stopBackoffCountdown();
        if (banner) banner.classList.remove('active');

        // If authenticated and just reconnected or was in unsynced empty state, automatically pull fresh DB data
        if (state.isAuthenticated && (prevMode !== 'live' || state.isUnsyncedEmptyState)) {
          await loadAppDataset();
          renderDashboard();
          renderGroupsView();
          renderStudentList();
        }

        if (showNotification) {
          notifyPrompt('Server Connected (200 OK)', `Connected to Node.js/MySQL backend at ${window.CCApi.getBaseUrl()}`, 'success');
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
            `Cannot reach server at ${window.CCApi.getBaseUrl()}. Next scheduled retry in ${backoffRetryDelaySec}s.`,
            'warning'
          );
        }

        // Schedule next backoff retry with countdown (15s -> 30s -> 60s -> 120s max)
        startBackoffCountdown();
        backoffRetryDelaySec = Math.min(120, backoffRetryDelaySec * 2);
      }
    } finally {
      isCheckingConnection = false;
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

        await withNetworkLoader('Authenticating & syncing...', async () => {
          try {
            const user = await window.CCApi.login(identifier, pass, state.authRole);
            state.currentUser = user;
            state.serverMode = window.CCApi.mode;
            if (user && user.token) window.CCApi.setToken(user.token);
            NativeBridge.saveSession(user.token, user.role, user.studentId, user.accountId);
            await loadAppDataset();
            setAuthenticatedState();

            if (window.CCApi.mode === 'live') {
              notifyPrompt('Sign In Successful (200 OK)', `Welcome back, ${user.name}! Connected to Live MySQL Server.`, 'success');
            } else if (user.role === 'lecturer' && state.isUnsyncedEmptyState) {
              notifyPrompt('Signed In (Offline — Empty State)', `Welcome, ${user.name}. Server not yet connected — connect to your MySQL server to load student records.`, 'warning');
              checkBackendConnection(false, false);
            } else {
              notifyPrompt('Signed In (Offline Local DB)', `Welcome, ${user.name}! Operating in local mode (${user.role.toUpperCase()}).`, 'info');
              checkBackendConnection(false, false);
            }
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

        await withNetworkLoader('Creating account & syncing...', async () => {
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
            state.serverMode = window.CCApi.mode;
            if (user && user.token) window.CCApi.setToken(user.token);
            NativeBridge.saveSession(user.token, user.role, user.studentId, user.accountId);
            await loadAppDataset();
            setAuthenticatedState();

            if (window.CCApi.mode === 'live') {
              notifyPrompt('Account Created (201 Created)', `Welcome, ${user.name}! Your profile is registered on the MySQL server.`, 'success');
            } else {
              notifyPrompt('Account Created (Offline Local DB)', `Welcome, ${user.name}! Registered in local mode.`, 'info');
            }
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
      state.isUnsyncedEmptyState = Boolean(data.isUnsyncedEmptyState);
      state.serverMode = window.CCApi.mode;
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

    let searchDebounceTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        const val = this.value;
        if (clearBtn) {
          clearBtn.classList.toggle('active', val.length > 0);
        }
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.searchQuery = val.trim().toLowerCase();
          renderStudentList();
        }, 150);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
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
  // Real Async Network Loader & LatticeLoader
  // =========================================================================
  let latticeTimerInterval = null;
  let globalLoaderInterval = null;

  async function withNetworkLoader(label, asyncFn) {
    const overlay = document.getElementById('global-loader-overlay');
    const labelEl = document.getElementById('global-loader-label');
    const timerEl = document.getElementById('global-loader-timer');
    const rosterLoader = document.getElementById('roster-loader');
    const rosterTimer = document.getElementById('loader-timer');
    const listEl = document.getElementById('students-roster-list');

    if (labelEl) labelEl.textContent = label || 'Communicating with server...';
    if (timerEl) timerEl.textContent = '0.0s';
    if (rosterTimer) rosterTimer.textContent = '0.0s';

    if (overlay) overlay.classList.add('active');
    if (rosterLoader && state.activeTab === 'students') {
      rosterLoader.classList.add('active');
      if (listEl) listEl.style.opacity = '0.3';
    }

    const startTime = Date.now();
    clearInterval(globalLoaderInterval);
    globalLoaderInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      if (timerEl) timerEl.textContent = elapsed;
      if (rosterTimer) rosterTimer.textContent = elapsed;
    }, 100);

    try {
      const result = await asyncFn();
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs < 260) {
        await new Promise(r => setTimeout(r, 260 - elapsedMs));
      }
      return result;
    } finally {
      clearInterval(globalLoaderInterval);
      if (overlay) overlay.classList.remove('active');
      if (rosterLoader) rosterLoader.classList.remove('active');
      if (listEl) listEl.style.opacity = '1';
    }
  }

  function showLatticeLoader(duration = 650, callback) {
    withNetworkLoader('Processing request...', async () => {
      if (callback) await callback();
    });
  }

  function buildLecturerUnsyncedEmptyHtml() {
    return `
      <div class="empty-state active" style="display: flex; margin-top: 4px; padding: 28px 18px;">
        <div class="empty-state-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
        </div>
        <h3 style="margin-bottom: 14px;">Database not connected</h3>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
          <button type="button" class="btn btn-secondary btn-sm btn-empty-open-server-cfg" style="width: auto;">
            Configure Server IP
          </button>
          <button type="button" class="btn btn-primary btn-sm shiny-btn btn-empty-sync-now" style="width: auto;">
            Connect &amp; Sync Now
          </button>
        </div>
      </div>
    `;
  }

  function bindEmptyStateActions(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.btn-empty-open-server-cfg').forEach(btn => {
      btn.addEventListener('click', () => {
        const cfgBtn = document.getElementById('btn-prelogin-settings');
        if (cfgBtn) cfgBtn.click();
        else openModal('modal-server-config');
      });
    });
    rootEl.querySelectorAll('.btn-empty-sync-now').forEach(btn => {
      btn.addEventListener('click', () => {
        triggerSync();
      });
    });
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
    const rosterFilterRow = document.getElementById('roster-filter-row');
    const searchInput = document.getElementById('search-students');
    if (!container) return;

    const isLecturer = state.currentUser && state.currentUser.role === 'lecturer';

    // Student role: hide lecturer-wide programme & 14-group filters; only search within their own group
    if (rosterFilterRow) {
      rosterFilterRow.style.display = isLecturer ? '' : 'none';
    }
    if (searchInput) {
      searchInput.placeholder = isLecturer
        ? 'Search by student name or 9-digit number...'
        : 'Search my group members by name or number...';
    }

    // Lecturer Unsynced Empty State (before connecting to live server)
    if (isLecturer && state.isUnsyncedEmptyState && state.students.length === 0) {
      if (activeFilterBar) activeFilterBar.style.display = 'none';
      if (countBadge) countBadge.textContent = '0 students';
      if (emptyState) emptyState.classList.remove('active');
      container.innerHTML = buildLecturerUnsyncedEmptyHtml('No student records loaded yet. Connect to the MySQL server to load the 208 students.');
      bindEmptyStateActions(container);
      return;
    }

    // Update Active Filter Pill Bar (Lecturer only)
    if (activeFilterBar && activeFilterText) {
      const activeParts = [];
      if (isLecturer && state.groupFilter !== 'ALL') activeParts.push(`Group: ${state.groupFilter}`);
      if (isLecturer && state.programFilter !== 'ALL') activeParts.push(`Programme: ${state.programFilter}`);
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
        (student.student_number || '').includes(state.searchQuery);

      if (!isLecturer) {
        return matchSearch;
      }

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

    container.innerHTML = filtered.map(s => {
      const groupLabel = s.group_code === 'UNASSIGNED' ? 'Unassigned' : s.group_code;
      const groupClass = s.group_code === 'UNASSIGNED' ? 'badge-unassigned' : 'badge-group';
      const isSelf = state.currentUser && (s.id === state.currentUser.studentId || (s.student_number && (s.student_number === state.currentUser.studentNumber || s.student_number === state.currentUser.username)));

      return `
        <div class="student-card" data-id="${s.id}" style="${isSelf && !isLecturer ? 'border-left: 4px solid var(--color-accent);' : ''}">
          <div class="student-card-left">
            <div class="student-avatar">${s.name.charAt(0)}</div>
            <div class="student-info">
              <h3>${escapeHtml(s.name)} ${isSelf && !isLecturer ? '<span class="badge badge-group" style="margin-left: 4px;">YOU</span>' : ''}</h3>
              <div class="student-number">${s.student_number || 'No ID'}${isLecturer ? ` • v${s.version}` : ''}</div>
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
      if (state.searchQuery) {
        // Subtle instantaneous fade when searching/filtering for max responsiveness
        anime({
          targets: '.student-card:nth-child(-n+8)',
          opacity: [0.35, 1],
          duration: 120,
          easing: 'easeOutQuad'
        });
      } else {
        // Stagger only the first 10 visible cards on initial view (eliminates 200+ DOM element animation lag)
        anime({
          targets: '.student-card:nth-child(-n+10)',
          translateY: [12, 0],
          opacity: [0, 1],
          delay: anime.stagger(25),
          duration: 200,
          easing: 'easeOutQuad'
        });
      }
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

    await withNetworkLoader('Deleting student record...', async () => {
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
    });
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

    const openAddGroupBtn = document.getElementById('btn-open-add-group');
    if (openAddGroupBtn) {
      openAddGroupBtn.addEventListener('click', function () {
        // Suggest next sequential group code (e.g. G16)
        let maxNum = 15;
        state.groups.forEach(g => {
          const m = /^G(\d+)$/i.exec(g.group_code || '');
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        });
        const nextCode = 'G' + String(maxNum + 1).padStart(2, '0');
        const codeInput = document.getElementById('add-group-code');
        const capInput = document.getElementById('add-group-capacity');
        if (codeInput) codeInput.value = nextCode;
        if (capInput) capInput.value = '15';
        openModal('add-group-modal');
      });
    }

    const addGroupForm = document.getElementById('add-group-form');
    if (addGroupForm) {
      addGroupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        createNewLabGroup();
      });
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
        await withNetworkLoader('Submitting correction request...', async () => {
          try {
            await window.CCApi.requestCorrection(state.currentUser.studentId, reqNum);
            notifyPrompt('Correction Submitted', `Request to update number to ${reqNum} submitted to instructor.`, 'success');
            document.getElementById('correction-requested-num').value = '';
          } catch (err) {
            notifyPrompt('Submission Error', err.message || 'Could not submit correction request.', 'destructive');
          }
        });
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
        notifyPrompt('Viewing Group Members', `Displaying your classmates in lab group ${groupCode}.`, 'info');
      });
    }

    // Request Group Change Modal Opener & Submission
    const btnOpenReqTransfer = document.getElementById('btn-open-request-transfer');
    if (btnOpenReqTransfer) {
      btnOpenReqTransfer.addEventListener('click', function () {
        populateTransferGroupOptions();
        openModal('request-transfer-modal');
      });
    }

    const requestTransferForm = document.getElementById('request-transfer-form');
    if (requestTransferForm) {
      requestTransferForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const targetGroup = document.getElementById('transfer-target-group').value;
        const reason = document.getElementById('transfer-reason').value.trim();
        if (!targetGroup) {
          notifyPrompt('Selection Required', 'Please select a valid open lab group.', 'warning');
          return;
        }

        await withNetworkLoader('Sending group transfer request...', async () => {
          try {
            await window.CCApi.requestGroupChange(targetGroup, reason);
            closeModal('request-transfer-modal');
            requestTransferForm.reset();
            notifyPrompt(
              window.CCApi.mode === 'live' ? 'Transfer Request Sent (201)' : 'Transfer Request Saved (Local)',
              `Your request to move to Group ${targetGroup} has been recorded for your lecturer.`,
              'success'
            );
          } catch (err) {
            notifyPrompt('Request Failed', err.message || 'Could not send group transfer request.', 'destructive');
          }
        });
      });
    }

    // Reassign / Put in Another Group Form (Lecturer)
    const reassignForm = document.getElementById('reassign-request-form');
    if (reassignForm) {
      reassignForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const reqId = document.getElementById('reassign-req-id').value;
        const notifId = document.getElementById('reassign-notif-id').value;
        const targetGroup = document.getElementById('reassign-select-group').value;
        if (!targetGroup) return;

        await withNetworkLoader('Reassigning student group...', async () => {
          try {
            await window.CCApi.resolveCorrection(reqId, 'reassign', targetGroup);
            state.notifications = state.notifications.filter(n => n.id !== notifId);
            closeModal('modal-reassign-request');
            notifyPrompt('Student Reassigned', `Student moved to Group ${targetGroup}.`, 'success');
            await loadAppDataset();
            renderDashboard();
            renderGroupsView();
            renderStudentList();
            renderNotificationsList();
            updateNotificationBadge();
          } catch (err) {
            notifyPrompt('Reassignment Failed', err.message || 'Could not reassign group.', 'destructive');
          }
        });
      });
    }

    // Add Member to Non-Full Group Form (Lecturer)
    const addMemberForm = document.getElementById('add-group-member-form');
    if (addMemberForm) {
      addMemberForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const targetGroup = document.getElementById('add-member-target-group').value;
        const studentId = document.getElementById('add-member-student-select').value;
        const student = state.students.find(s => s.id === studentId);
        if (!student) {
          notifyPrompt('Selection Required', 'Please choose a student to add.', 'warning');
          return;
        }

        await withNetworkLoader(`Assigning ${student.name} to Group ${targetGroup}...`, async () => {
          try {
            await window.CCApi.transferStudent(student.id, targetGroup, student.version);
            closeModal('modal-add-group-member');
            notifyPrompt('Member Added (200 OK)', `${student.name} (${student.student_number}) is now in Group ${targetGroup}.`, 'success');
            await loadAppDataset();
            renderDashboard();
            renderGroupsView();
            renderStudentList();
          } catch (err) {
            notifyPrompt('Assignment Failed', err.message || 'Could not add student to group.', 'destructive');
          }
        });
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

    await withNetworkLoader('Saving student changes...', async () => {
      try {
        await window.CCApi.updateStudent(student, { name, program, group }, state.currentUser.role);
        closeModal('edit-student-modal');
        notifyPrompt(
          window.CCApi.mode === 'live' ? 'Record Updated (200 OK)' : 'Record Updated (Local Cache)',
          `Profile updated for ${name}.`,
          'success'
        );
        await loadAppDataset();
        renderDashboard();
        renderGroupsView();
        renderStudentList();
      } catch (err) {
        notifyPrompt('Update Failed', err.message || 'Could not update student record.', 'destructive');
      }
    });
  }

  async function addNewStudent() {
    const name = document.getElementById('add-student-name').value.trim();
    const number = document.getElementById('add-student-number').value.trim();
    const program = document.getElementById('add-program').value;
    const group = document.getElementById('add-group').value;

    await withNetworkLoader('Enrolling new student...', async () => {
      try {
        const res = await window.CCApi.createStudent({ name, number, program, group });
        closeModal('add-student-modal');
        document.getElementById('add-student-form').reset();
        if (res.claim_code) {
          copyToClipboard(res.claim_code, 'Claim Code', false);
        }
        notifyPrompt(
          window.CCApi.mode === 'live' ? 'Student Registered (201 Created)' : 'Student Added (Local Cache)',
          `${name} enrolled. Claim code ${res.claim_code} copied to clipboard!`,
          'success'
        );
        await loadAppDataset();
        renderDashboard();
        renderGroupsView();
        renderStudentList();
      } catch (err) {
        notifyPrompt('Creation Failed', err.message || 'Could not register student.', 'destructive');
      }
    });
  }

  async function createNewLabGroup() {
    const code = (document.getElementById('add-group-code')?.value || '').trim().toUpperCase();
    const capacity = parseInt(document.getElementById('add-group-capacity')?.value || '15', 10);
    const program = document.getElementById('add-group-program')?.value || 'CS';
    const day = document.getElementById('add-group-day')?.value || 'MON';
    const start = document.getElementById('add-group-start')?.value || '09:00';
    const end = document.getElementById('add-group-end')?.value || '11:00';
    const room = (document.getElementById('add-group-room')?.value || '').trim();

    if (!/^G\d{2,3}$/i.test(code)) {
      notifyPrompt('Invalid Group Code', 'Group code must start with G followed by 2–3 digits (e.g. G15).', 'destructive');
      return;
    }
    if (Number.isNaN(capacity) || capacity < 1 || capacity > 15) {
      notifyPrompt('Capacity Rule (Max 15)', 'Each lab group can have at most 15 members.', 'destructive');
      return;
    }

    await withNetworkLoader(`Creating lab group ${code}...`, async () => {
      try {
        await window.CCApi.createGroup({
          group_code: code,
          capacity: capacity,
          program_code: program,
          schedule_day: day,
          start_time: start,
          end_time: end,
          room: room
        });
        closeModal('add-group-modal');
        document.getElementById('add-group-form')?.reset();
        await loadAppDataset();
        renderDashboard();
        renderGroupsView();
        renderStudentList();
        notifyPrompt(
          window.CCApi.mode === 'live' ? 'Lab Group Created (201 Created)' : 'Lab Group Created (Local Cache)',
          `Group ${code} (${program} • Max ${capacity} seats • ${day} ${start}-${end}) is now active.`,
          'success'
        );
      } catch (err) {
        notifyPrompt('Group Creation Failed', err.message || 'Could not create new lab group.', 'destructive');
      }
    });
  }

  function syncDynamicGroupSelects() {
    if (!state.groups || state.groups.length === 0) return;
    const codes = state.groups.map(g => g.group_code);
    const firstCode = codes[0] || 'G01';
    const lastCode = codes[codes.length - 1] || 'G14';

    const filterSelect = document.getElementById('filter-group-select');
    if (filterSelect) {
      const cur = filterSelect.value || state.groupFilter || 'ALL';
      filterSelect.innerHTML = `<option value="ALL">All Groups</option>` +
        codes.map(c => `<option value="${c}">${c}</option>`).join('') +
        `<option value="UNASSIGNED">Unassigned</option>`;
      if ([...codes, 'ALL', 'UNASSIGNED'].includes(cur)) filterSelect.value = cur;
    }

    ['edit-group', 'add-group'].forEach(selId => {
      const sel = document.getElementById(selId);
      if (sel) {
        const cur = sel.value;
        sel.innerHTML = `<option value="UNASSIGNED">Unassigned</option>` +
          codes.map(c => `<option value="${c}">${c}</option>`).join('');
        if ([...codes, 'UNASSIGNED'].includes(cur)) sel.value = cur;
      }
    });

    populateTransferGroupOptions();
  }

  function populateTransferGroupOptions() {
    const transferSelect = document.getElementById('transfer-target-group');
    if (!transferSelect) return;

    let myGroup = '';
    if (state.currentUser) {
      myGroup = state.currentUser.group || '';
      if (!myGroup && state.students.length > 0) {
        const myRecord = state.students.find(s =>
          s.id === state.currentUser.studentId ||
          s.student_number === state.currentUser.studentNumber ||
          s.student_number === state.currentUser.username
        );
        if (myRecord) myGroup = myRecord.group_code || '';
      }
    }

    // Filter available groups only: NOT current group, and NOT full (active_count < capacity)
    const availableGroups = state.groups.filter(g => {
      const cap = g.capacity || 15;
      const count = g.active_count !== undefined ? g.active_count : state.students.filter(s => s.group_code === g.group_code).length;
      return g.group_code !== myGroup && count < cap;
    });

    const submitBtn = document.querySelector('#request-transfer-form button[type="submit"]');

    if (availableGroups.length === 0) {
      transferSelect.innerHTML = '<option value="" disabled selected>No groups currently have open seats (15 member cap reached)</option>';
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (submitBtn) submitBtn.disabled = false;
      const cur = transferSelect.value;
      transferSelect.innerHTML = availableGroups.map(g => {
        const cap = g.capacity || 15;
        const count = g.active_count !== undefined ? g.active_count : state.students.filter(s => s.group_code === g.group_code).length;
        const openSeats = cap - count;
        const sched = g.schedule_day ? `${g.schedule_day} ${g.start_time} - ${g.end_time}` : 'Schedule TBA';
        return `<option value="${g.group_code}">${g.group_code} (${openSeats} seat${openSeats === 1 ? '' : 's'} open • ${sched} • ${escapeHtml(g.room || 'TBA')})</option>`;
      }).join('');
      if (cur && availableGroups.some(g => g.group_code === cur)) transferSelect.value = cur;
    }
  }

  function openAddMemberModal(groupCode) {
    const grp = state.groups.find(g => g.group_code === groupCode);
    if (!grp) return;
    const count = grp.active_count !== undefined ? grp.active_count : state.students.filter(s => s.group_code === groupCode).length;
    const cap = grp.capacity || 15;
    const openSpots = Math.max(0, cap - count);

    const hiddenTarget = document.getElementById('add-member-target-group');
    const titleEl = document.getElementById('add-member-modal-title');
    const subEl = document.getElementById('add-member-modal-sub');
    const select = document.getElementById('add-member-student-select');
    const submitBtn = document.getElementById('btn-submit-add-member');

    if (hiddenTarget) hiddenTarget.value = groupCode;
    if (titleEl) titleEl.textContent = `Add Member to Group ${groupCode}`;
    if (subEl) {
      subEl.textContent = `Group ${groupCode} has ${openSpots} spot${openSpots === 1 ? '' : 's'} available (${count}/${cap} active). Choose a student:`;
    }

    if (select) {
      const candidates = state.students.filter(s => s.group_code !== groupCode && s.status === 'active');
      if (candidates.length === 0) {
        select.innerHTML = '<option value="" disabled selected>No other active students available</option>';
        if (submitBtn) submitBtn.disabled = true;
      } else {
        if (submitBtn) submitBtn.disabled = false;
        // Sort candidates: unassigned students first, then alphabetically
        candidates.sort((a, b) => {
          const aUn = (!a.group_code || a.group_code === 'UNASSIGNED') ? 0 : 1;
          const bUn = (!b.group_code || b.group_code === 'UNASSIGNED') ? 0 : 1;
          if (aUn !== bUn) return aUn - bUn;
          return a.name.localeCompare(b.name);
        });

        select.innerHTML = candidates.map(s => {
          const isUnassigned = !s.group_code || s.group_code === 'UNASSIGNED';
          const tag = isUnassigned ? '[Unassigned]' : `[Currently in ${s.group_code}]`;
          const transferNote = isUnassigned ? '' : ` — will transfer to ${groupCode}`;
          return `<option value="${s.id}">${tag} ${escapeHtml(s.name)} (${s.student_number} • ${s.program_code})${transferNote}</option>`;
        }).join('');
      }
    }

    openModal('modal-add-group-member');
  }

  // =========================================================================
  // Lab Groups View & Weekly Schedule (Focused Student vs Lecturer View)
  // =========================================================================
  function renderGroupsView() {
    const dashboardContainer = document.getElementById('dashboard-groups-container');
    const detailedContainer = document.getElementById('detailed-groups-container');
    const weeklyScheduleContainer = document.getElementById('weekly-schedule-container');
    const groupsHeaderTitle = document.getElementById('groups-header-title');
    const groupsHeaderDesc = document.getElementById('groups-header-desc');
    const weeklyScheduleTitle = document.getElementById('weekly-schedule-title');
    const dashboardGroupsTitle = document.getElementById('dashboard-groups-title');
    const btnDashboardViewAll = document.getElementById('btn-dashboard-view-all-groups');

    const isLecturer = state.currentUser && state.currentUser.role === 'lecturer';
    const btnOpenAddGroup = document.getElementById('btn-open-add-group');
    if (btnOpenAddGroup) {
      btnOpenAddGroup.style.display = isLecturer ? '' : 'none';
    }
    syncDynamicGroupSelects();

    if (groupsHeaderTitle) {
      groupsHeaderTitle.textContent = isLecturer ? 'Lab Groups Management' : 'My Lab Group & Schedule';
    }
    if (groupsHeaderDesc) {
      groupsHeaderDesc.textContent = '';
      groupsHeaderDesc.style.display = 'none';
    }
    if (weeklyScheduleTitle) {
      weeklyScheduleTitle.textContent = isLecturer ? 'Weekly Lab Schedule & Timetable' : 'My Group Timetable Slot';
    }

    // 1. Lecturer Unsynced Empty State (when offline before connecting to server)
    if (isLecturer && state.isUnsyncedEmptyState && state.groups.length === 0) {
      if (dashboardGroupsTitle) dashboardGroupsTitle.textContent = 'Lab Capacity Overview';
      if (btnDashboardViewAll) btnDashboardViewAll.style.display = 'none';
      const emptyHtml = buildLecturerUnsyncedEmptyHtml();
      if (dashboardContainer) {
        dashboardContainer.innerHTML = emptyHtml;
        bindEmptyStateActions(dashboardContainer);
      }
      if (detailedContainer) {
        detailedContainer.innerHTML = emptyHtml;
        bindEmptyStateActions(detailedContainer);
      }
      if (weeklyScheduleContainer) {
        weeklyScheduleContainer.innerHTML = `
          <div style="text-align: center; padding: 18px; color: var(--color-text-muted); font-weight: 600;">
            Database not connected
          </div>
        `;
      }
      return;
    }

    // 2. Student Focused View: Only show their own group's schedule & members (no bombardment)
    if (!isLecturer) {
      const myRecord = state.students.find(s => s.id === state.currentUser?.studentId || s.student_number === state.currentUser?.studentNumber || s.student_number === state.currentUser?.username) || state.students[0];
      const myGroupCode = myRecord ? myRecord.group_code : 'UNASSIGNED';
      const myGroupObj = state.groups.find(g => g.group_code === myGroupCode) || state.groups[0];

      if (dashboardGroupsTitle) {
        dashboardGroupsTitle.textContent = myGroupCode !== 'UNASSIGNED'
          ? `Group ${myGroupCode} Schedule & Members (${state.students.length})`
          : 'My Group Assignment';
      }
      if (btnDashboardViewAll) btnDashboardViewAll.style.display = 'none';

      const scheduleLabel = myGroupObj && myGroupObj.schedule_day
        ? `${myGroupObj.schedule_day} ${myGroupObj.start_time} - ${myGroupObj.end_time}`
        : 'Schedule TBA';
      const roomLabel = (myGroupObj && myGroupObj.room) || 'Room TBA';
      const count = state.students.length;
      const cap = (myGroupObj && myGroupObj.capacity) || 15;
      const pct = Math.min(100, (count / cap) * 100);

      const singleGroupCardHtml = myGroupObj ? `
        <div class="card spotlight-card" style="margin-bottom: 12px; border: 1px solid var(--color-border);">
          <div class="group-progress-item">
            <div class="group-progress-header">
              <span class="group-badge">
                <strong>Group ${myGroupObj.group_code}</strong> • ${escapeHtml(roomLabel)}
              </span>
              <span class="capacity-counter">
                ${count} / ${cap} Members
              </span>
            </div>
            <div class="progress-track" style="margin-top: 6px;">
              <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
            <p style="font-size: 0.8rem; color: var(--color-primary); font-weight: 600; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
              ${SVG_ICONS.clock}<span>${escapeHtml(scheduleLabel)} • ${escapeHtml(roomLabel)}</span>
            </p>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 10px;">
            <button type="button" class="btn btn-secondary btn-sm group-export-excel-btn" data-group="${myGroupObj.group_code}" style="flex: 1; font-size: 0.74rem; padding: 5px 10px;">
              ${SVG_ICONS.excel} Export Excel
            </button>
          </div>
        </div>
      ` : `
        <div style="padding: 16px; text-align: center; color: var(--color-text-muted);">
          You are not yet assigned to a lab group.
        </div>
      `;

      const membersCompactHtml = state.students.map(s => {
        const isSelf = state.currentUser && (s.id === state.currentUser.studentId || (s.student_number && (s.student_number === state.currentUser.studentNumber || s.student_number === state.currentUser.username)));
        return `
          <div class="student-card" style="padding: 10px 14px; margin-bottom: 8px; ${isSelf ? 'border-left: 4px solid var(--color-accent);' : ''}">
            <div class="student-card-left">
              <div class="student-avatar" style="width: 36px; height: 36px; font-size: 0.85rem;">${s.name.charAt(0)}</div>
              <div class="student-info">
                <h3 style="font-size: 0.88rem;">${escapeHtml(s.name)} ${isSelf ? '<span class="badge badge-group" style="margin-left: 4px;">YOU</span>' : ''}</h3>
                <div class="student-number" style="font-size: 0.75rem;">${s.student_number || 'No ID'} • ${s.program_code}</div>
              </div>
            </div>
            <span class="badge badge-group">${s.group_code}</span>
          </div>
        `;
      }).join('');

      if (dashboardContainer) {
        dashboardContainer.innerHTML = `
          ${singleGroupCardHtml}
          <div style="margin-top: 6px;">
            ${membersCompactHtml}
          </div>
        `;
      }

      if (detailedContainer) {
        detailedContainer.innerHTML = singleGroupCardHtml;
      }

      document.querySelectorAll('.group-export-excel-btn').forEach(btn => {
        btn.addEventListener('click', function () {
          const group = this.getAttribute('data-group');
          exportGroupToExcel(group);
        });
      });

      if (weeklyScheduleContainer) {
        weeklyScheduleContainer.innerHTML = myGroupObj ? `
          <div class="schedule-slot-item">
            <div class="schedule-slot-details">
              <strong>Group ${myGroupObj.group_code}:</strong> ${escapeHtml(scheduleLabel)} • <em>${escapeHtml(roomLabel)}</em>
            </div>
          </div>
        ` : `<div style="padding: 12px; color: var(--color-text-muted);">No group timetable assigned yet.</div>`;
      }
      return;
    }

    // 3. Lecturer Full View (when synced or cached from server)
    if (dashboardGroupsTitle) dashboardGroupsTitle.textContent = 'Lab Capacity Overview (15 Max Rule)';
    if (btnDashboardViewAll) btnDashboardViewAll.style.display = '';

    const activeJump = state.groupJumpFilter || 'ALL';

    const pillsHtml = `
      <div class="group-jump-pills-row" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 12px; -webkit-overflow-scrolling: touch; scrollbar-width: none;">
        <button type="button" class="btn btn-secondary btn-sm group-jump-btn ${activeJump === 'ALL' ? 'active-jump' : ''}" data-jump="ALL" style="border-radius: 16px; font-size: 0.72rem; padding: 4px 10px; white-space: nowrap; ${activeJump === 'ALL' ? 'background: var(--color-primary); color: #fff;' : ''}">All (${state.groups.length})</button>
        ${state.groups.map(g => `
          <button type="button" class="btn btn-secondary btn-sm group-jump-btn ${activeJump === g.group_code ? 'active-jump' : ''}" data-jump="${g.group_code}" style="border-radius: 16px; font-size: 0.72rem; padding: 4px 10px; white-space: nowrap; ${activeJump === g.group_code ? 'background: var(--color-primary); color: #fff;' : ''}">${g.group_code}</button>
        `).join('')}
      </div>
    `;

    const visibleGroups = activeJump === 'ALL' ? state.groups : state.groups.filter(g => g.group_code === activeJump);

    const cardsHtml = visibleGroups.map(g => {
      const members = state.students.filter(s => s.group_code === g.group_code);
      const count = g.active_count || members.length;
      const cap = g.capacity || 15;
      const pct = Math.min(100, (count / cap) * 100);
      const isFull = count >= cap;
      const isNearFull = count >= (cap - 2);

      let counterClass = isFull ? 'full' : (isNearFull ? 'warning' : '');
      let barClass = isFull ? 'full' : (isNearFull ? 'warning' : '');

      const scheduleLabel = g.schedule_day
        ? `${g.schedule_day} ${g.start_time} - ${g.end_time}`
        : 'Schedule pending';

      return `
        <div class="card spotlight-card" style="margin-bottom: 0;">
          <div class="group-progress-item">
            <div class="group-progress-header">
              <span class="group-badge">
                <strong>${g.group_code}</strong> • ${escapeHtml(g.room || 'TBA')}
              </span>
              <span class="capacity-counter ${counterClass}">
                ${count} / ${cap} Active ${isFull ? '(FULL)' : `(${cap - count} Open)`}
              </span>
            </div>
            <div class="progress-track" style="margin-top: 6px;">
              <div class="progress-bar-fill ${barClass}" style="width: ${pct}%"></div>
            </div>
            <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 6px; display: flex; align-items: center; gap: 4px;">
              ${SVG_ICONS.clock}<span>${escapeHtml(scheduleLabel)}</span>
            </p>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap;">
            ${!isFull ? `
              <button type="button" class="btn btn-primary btn-sm group-add-member-btn" data-group="${g.group_code}" style="flex: 1 1 100%; font-size: 0.72rem; padding: 5px 8px; margin-bottom: 2px;">
                + Add Member
              </button>
            ` : ''}
            <button type="button" class="btn btn-secondary btn-sm group-roster-filter-btn" data-group="${g.group_code}" style="flex: 1; font-size: 0.72rem; padding: 4px 8px;">
              ${SVG_ICONS.filter} Filter Roster
            </button>
            <button type="button" class="btn btn-secondary btn-sm group-export-excel-btn" data-group="${g.group_code}" data-count="${count}" style="flex: 1; font-size: 0.72rem; padding: 4px 8px;">
              ${SVG_ICONS.excel} Export Excel
            </button>
          </div>
        </div>
      `;
    }).join('');

    const gridHtml = `
      ${pillsHtml}
      <div class="groups-responsive-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">
        ${cardsHtml}
      </div>
    `;

    if (dashboardContainer) dashboardContainer.innerHTML = gridHtml;
    if (detailedContainer) detailedContainer.innerHTML = gridHtml;

    document.querySelectorAll('.group-jump-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        state.groupJumpFilter = this.getAttribute('data-jump');
        renderGroupsView();
      });
    });

    // Render Weekly Lab Schedule Container grouped by Programme
    if (weeklyScheduleContainer) {
      const isItGroup = g => /^IT\s*[\-]/i.test(g.room || '') || ['G09','G10','G11','G12'].includes(g.group_code);
      const isItedGroup = g => /^ITED\s*[\-]/i.test(g.room || '') || ['G13','G14'].includes(g.group_code);
      const progBuckets = [
        { code: 'CS', title: 'Computer Science (CS)', filter: g => !isItGroup(g) && !isItedGroup(g) },
        { code: 'IT', title: 'Information Technology (IT)', filter: isItGroup },
        { code: 'ITED', title: 'ICT with Education (ITED)', filter: isItedGroup }
      ];

      weeklyScheduleContainer.innerHTML = progBuckets.map(bucket => {
        const bGroups = state.groups.filter(bucket.filter);
        if (bGroups.length === 0) return '';
        const rows = bGroups.map(g => {
          const day = g.schedule_day || 'TBA';
          const times = (g.start_time && g.end_time) ? `${g.start_time} - ${g.end_time}` : 'TBA';
          const room = g.room || 'Laboratory TBA';
          const count = g.active_count || state.students.filter(s => s.group_code === g.group_code).length;
          const cap = g.capacity || 15;
          const statusTag = count >= cap ? `<span class="badge status-4xx" style="margin-left: 6px; font-size: 0.68rem;">${count}/${cap} FULL</span>` : `<span class="badge status-2xx" style="margin-left: 6px; font-size: 0.68rem;">${count}/${cap} OPEN</span>`;

          return `
            <div class="schedule-slot-item">
              <div class="schedule-slot-details">
                <strong>Group ${g.group_code}:</strong> ${day} ${times} • <em>${escapeHtml(room)}</em> ${statusTag}
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

        return `
          <div style="margin-bottom: 14px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.03em; padding: 6px 10px; background: var(--color-primary-subtle); border-radius: 6px; margin-bottom: 6px;">
              ${escapeHtml(bucket.title)}
            </div>
            ${rows}
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

    document.querySelectorAll('.group-export-excel-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const group = this.getAttribute('data-group');
        exportGroupToExcel(group);
      });
    });

    document.querySelectorAll('.group-add-member-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const group = this.getAttribute('data-group');
        openAddMemberModal(group);
      });
    });
  }

  function exportGroupToExcel(groupCode) {
    const grpNum = parseInt(String(groupCode).replace(/^G0?/i, ''), 10) || groupCode;
    const groupTitle = `GROUP ${grpNum}`;
    const members = state.students
      .filter(s => s.group_code === groupCode)
      .slice()
      .sort((a, b) => (a.slot || 999) - (b.slot || 999));

    const totalSlots = 15;
    const rows = [];
    for (let i = 0; i < totalSlots; i++) {
      const m = members[i];
      if (m) {
        const parts = (m.name || '').trim().split(/\s+/);
        const fName = m.first_name || (parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || ''));
        const lName = m.last_name || (parts.length > 1 ? parts[parts.length - 1] : '');
        rows.push({
          no: i + 1,
          firstName: fName,
          lastName: lName,
          studentNumber: m.student_number || '',
          gender: m.gender || 'M',
          programme: m.raw_program || m.program_code || 'BSCS'
        });
      } else {
        rows.push({
          no: i + 1,
          firstName: '',
          lastName: '',
          studentNumber: '',
          gender: '',
          programme: ''
        });
      }
    }

    const fileName = `Group_${groupCode}_Roster.xlsx`;
    NativeBridge.exportGroupExcel(fileName, groupTitle, rows);
    notifyPrompt(
      'Excel Sheet Exported',
      `Generated ${fileName} (${members.length} enrolled member${members.length === 1 ? '' : 's'}).`,
      'success'
    );
  }

  // =========================================================================
  // Lecturer Timetable Slot Editing
  // =========================================================================
  function setupTimetableEditing() {
    const form = document.getElementById('edit-schedule-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const groupCode = (document.getElementById('edit-schedule-group').value || '').trim().toUpperCase();
      const day = (document.getElementById('edit-schedule-day').value || 'MON').trim().toUpperCase().slice(0, 3);
      const rawStart = document.getElementById('edit-schedule-start').value;
      const rawEnd = document.getElementById('edit-schedule-end').value;
      const room = document.getElementById('edit-schedule-room').value.trim();

      const normTime = (t) => {
        if (!t) return '';
        const m = String(t).trim().match(/^([01]\d|2[0-3]):[0-5]\d/);
        return m ? m[0] : '';
      };
      const start = normTime(rawStart);
      const end = normTime(rawEnd);

      if (!start || !end) {
        notifyPrompt('Invalid Time', 'Please enter valid start and end times in 24h format (HH:MM).', 'destructive');
        return;
      }
      if (start >= end) {
        notifyPrompt('Time Order Error', 'End time must be later than start time.', 'destructive');
        return;
      }

      await withNetworkLoader('Updating timetable slot...', async () => {
        try {
          await window.CCApi.updateSchedule(groupCode, {
            schedule_day: day,
            start_time: start,
            end_time: end,
            room: room
          });
          closeModal('edit-schedule-modal');
          notifyPrompt(
            window.CCApi.mode === 'live' ? 'Timetable Updated (200 OK)' : 'Timetable Updated (Local Cache)',
            `Lab slot for ${groupCode} updated to ${day} ${start}-${end}.`,
            'success'
          );
          await loadAppDataset();
          renderGroupsView();
        } catch (err) {
          notifyPrompt('Timetable Error', err.message || 'Could not update lab schedule.', 'destructive');
        }
      });
    });
  }

  function openEditScheduleModal(groupCode) {
    const group = state.groups.find(g => g.group_code === groupCode);
    if (!group) return;

    const normTime = (t, fallback) => {
      if (!t) return fallback;
      const m = String(t).trim().match(/^([01]\d|2[0-3]):[0-5]\d/);
      return m ? m[0] : fallback;
    };

    document.getElementById('edit-schedule-title').textContent = `Edit Timetable Slot • Group ${groupCode}`;
    document.getElementById('edit-schedule-group').value = groupCode;
    document.getElementById('edit-schedule-day').value = (group.schedule_day || 'MON').toUpperCase().slice(0, 3);
    document.getElementById('edit-schedule-start').value = normTime(group.start_time, '10:00');
    document.getElementById('edit-schedule-end').value = normTime(group.end_time, '12:00');
    document.getElementById('edit-schedule-room').value = group.room || '';

    openModal('edit-schedule-modal');
  }

  // =========================================================================
  // Dashboard Rendering
  // =========================================================================
  function renderDashboard() {
    if (!state.currentUser) return;

    const isLecturer = state.currentUser.role === 'lecturer';
    const lecturerStatsGrid = document.getElementById('lecturer-stats-grid');
    const totalStudentsEl = document.getElementById('stat-total-students');
    const assignedCountEl = document.getElementById('stat-assigned-students');
    const totalGroupsEl = document.getElementById('stat-total-groups');
    const syncStatusEl = document.getElementById('stat-sync-status');
    const userGreetingEl = document.getElementById('user-greeting');
    const userSubtitleEl = document.getElementById('user-subtitle');
    const studentProfileWidget = document.getElementById('student-profile-widget');

    // Only show campus-wide 4-card stats grid to Lecturer (do not bombard Student)
    if (lecturerStatsGrid) {
      lecturerStatsGrid.style.display = isLecturer ? '' : 'none';
    }

    if (isLecturer) {
      if (totalStudentsEl) animateCountUp(totalStudentsEl, state.students.length);
      const assigned = state.students.filter(s => s.group_code !== 'UNASSIGNED').length;
      if (assignedCountEl) assignedCountEl.textContent = `${assigned}/${state.students.length}`;
      if (totalGroupsEl) totalGroupsEl.textContent = String(state.groups.length);
      if (syncStatusEl) {
        const isLive = window.CCApi && window.CCApi.mode === 'live';
        syncStatusEl.textContent = isLive ? 'Live DB' : (state.isUnsyncedEmptyState ? 'Not Synced' : 'Local Cache');
        syncStatusEl.style.color = isLive ? 'var(--color-success)' : 'var(--color-warning)';
      }
    }

    if (userGreetingEl) userGreetingEl.textContent = state.currentUser.name;
    if (userSubtitleEl) {
      userSubtitleEl.textContent = isLecturer
        ? 'Instructor Roster & Capacity Manager'
        : 'My Lab Group & Class Schedule';
    }

    if (studentProfileWidget) {
      const isStudent = state.currentUser.role === 'student';
      studentProfileWidget.style.display = isStudent ? 'block' : 'none';
      if (isStudent) {
        const studentRecord = state.students.find(s => s.id === state.currentUser.studentId || s.student_number === state.currentUser.studentNumber || s.student_number === state.currentUser.username) || state.students[0];
        if (studentRecord) {
          document.getElementById('student-profile-num').textContent = studentRecord.student_number;
          document.getElementById('student-profile-prog').textContent = studentRecord.program_code;
          const myG = state.groups.find(g => g.group_code === studentRecord.group_code);
          const sched = myG && myG.schedule_day ? ` (${myG.schedule_day} ${myG.start_time}-${myG.end_time} • ${myG.room})` : '';
          document.getElementById('student-profile-grp').textContent = `${studentRecord.group_code}${sched}`;
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
          state.isOffline ? 'Offline Mode Active' : 'Checking Network Connection',
          state.isOffline ? 'Working locally. Pending changes are saved to durable queue.' : 'Attempting to synchronize with MySQL server...',
          state.isOffline ? 'warning' : 'info'
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
    withNetworkLoader('Synchronizing with MySQL server...', async () => {
      const mode = await window.CCApi.detect();
      state.serverMode = mode;
      await loadAppDataset();
      renderDashboard();
      renderGroupsView();
      renderStudentList();
      await checkBackendConnection(false, false);

      if (window.CCApi.mode === 'live') {
        notifyPrompt(
          'Sync Completed (200 OK)',
          `Synchronized ${state.students.length} student record(s) from ${window.CCApi.getBaseUrl()}.`,
          'success'
        );
      } else {
        NativeBridge.vibrate(50);
        notifyPrompt(
          'Sync Failed — Server Unreachable',
          `Could not connect to database at ${window.CCApi.getBaseUrl()}. Verify Server IP & Wi-Fi.`,
          'destructive'
        );
      }
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
    const btnAutoDetectSettings = document.getElementById('btn-auto-detect-settings');

    if (serverUrlInput) {
      serverUrlInput.value = window.CCApi.getBaseUrl();
    }

    if (btnAutoDetectSettings) {
      btnAutoDetectSettings.addEventListener('click', function () {
        triggerAutoDiscovery(false);
      });
    }

    if (btnSaveServerUrl) {
      btnSaveServerUrl.addEventListener('click', async function () {
        const url = serverUrlInput.value.trim();
        window.CCApi.setBaseUrl(url);
        notifyPrompt('Server URL Saved', `Base endpoint updated to ${window.CCApi.getBaseUrl()}`, 'info');
        await withNetworkLoader('Connecting to server...', async () => {
          await checkBackendConnection(true, true);
        });
      });
    }

    if (btnTestServerConn) {
      btnTestServerConn.addEventListener('click', async function () {
        await withNetworkLoader('Testing server connection...', async () => {
          await checkBackendConnection(true, true);
        });
      });
    }
  }

  // =========================================================================
  // UDP Auto-Discovery & Subnet Fallback Mechanism (Approach 1)
  // =========================================================================
  let isDiscovering = false;
  async function triggerAutoDiscovery(silent = false) {
    if (isDiscovering) return;
    isDiscovering = true;
    setTimeout(() => { isDiscovering = false; }, 8000);

    const statusPill = document.getElementById('modal-cfg-status-pill');
    if (statusPill && !silent) {
      statusPill.textContent = 'Searching network...';
      statusPill.className = 'badge badge-group';
    }
    if (!silent) {
      notifyPrompt('Server Auto-Discovery', 'Broadcasting UDP ping (port 41234) on Wi-Fi...', 'info');
    }

    if (window.Android && typeof window.Android.discoverServer === 'function') {
      window.Android.discoverServer();
    } else {
      // Browser / dev fallback: test localhost and Android emulator host
      const candidates = ['http://127.0.0.1:3000', 'http://10.0.2.2:3000'];
      let foundUrl = null;
      for (const u of candidates) {
        try {
          const doFetch = (window.CCApi && window.CCApi.fetch) ? window.CCApi.fetch : fetch;
          const r = await doFetch(u + '/api/health', { method: 'GET' }, 1200);
          if (r.ok) {
            foundUrl = u;
            break;
          }
        } catch (_) {}
      }
      isDiscovering = false;
      if (window.onServerDiscovered) {
        window.onServerDiscovered(foundUrl, foundUrl ? 'fallback' : null);
      }
    }
  }

  // Global callback invoked by Android NativeBridge (UDP or Subnet scan)
  window.onServerDiscovered = async function (serverUrl, method) {
    isDiscovering = false;
    const inputUrl = document.getElementById('modal-cfg-url');
    const statusPill = document.getElementById('modal-cfg-status-pill');
    const serverUrlInput = document.getElementById('server-url-input');

    if (serverUrl) {
      if (inputUrl) inputUrl.value = serverUrl;
      if (serverUrlInput) serverUrlInput.value = serverUrl;
      window.CCApi.setBaseUrl(serverUrl);
      window.CCApi.mode = 'live';
      state.serverMode = 'live';
      consecutiveHeartbeatFailures = 0;
      if (statusPill) {
        statusPill.textContent = 'Found (' + (method === 'udp' ? 'UDP' : 'Subnet') + ')';
        statusPill.className = 'badge status-2xx';
      }
      notifyPrompt('Server Located!', `Connected to ${serverUrl} via ${method === 'udp' ? 'UDP Auto-Discovery' : 'Subnet Scan'}.`, 'success');
      await checkBackendConnection(true, true);
    } else {
      if (statusPill) {
        statusPill.textContent = 'Unreachable';
        statusPill.className = 'badge badge-unassigned';
      }
      notifyPrompt('Discovery Timeout', 'No server responded on local Wi-Fi. Check Wi-Fi or enter IP manually.', 'warning');
    }
  };

  // =========================================================================
  // Pre-Login Server & Network Configuration Modal
  // =========================================================================
  function setupPreLoginServerConfig() {
    const btnHeader = document.getElementById('btn-prelogin-settings');
    const btnAuth = document.getElementById('btn-auth-server-settings');
    const modalId = 'modal-server-config';
    const inputUrl = document.getElementById('modal-cfg-url');
    const statusPill = document.getElementById('modal-cfg-status-pill');
    const btnTest = document.getElementById('btn-modal-cfg-test');
    const btnSave = document.getElementById('btn-modal-cfg-save');
    const btnPresetEmu = document.getElementById('btn-quick-preset-emu');
    const btnPresetLocal = document.getElementById('btn-quick-preset-local');
    const btnAutoDetect = document.getElementById('btn-quick-auto-detect');

    function openServerModal() {
      if (inputUrl) inputUrl.value = window.CCApi.getBaseUrl();
      if (statusPill) {
        const isLive = state.serverMode === 'live';
        statusPill.textContent = isLive ? 'Online (Connected)' : 'Server Unreachable';
        statusPill.className = 'badge ' + (isLive ? 'status-2xx' : 'badge-unassigned');
      }
      openModal(modalId);
    }

    if (btnHeader) btnHeader.addEventListener('click', openServerModal);
    if (btnAuth) btnAuth.addEventListener('click', openServerModal);

    if (btnAutoDetect) {
      btnAutoDetect.addEventListener('click', () => {
        triggerAutoDiscovery(false);
      });
    }

    if (btnPresetEmu) {
      btnPresetEmu.addEventListener('click', () => {
        if (inputUrl) inputUrl.value = 'http://10.0.2.2:3000';
      });
    }
    if (btnPresetLocal) {
      btnPresetLocal.addEventListener('click', () => {
        if (inputUrl) inputUrl.value = 'http://127.0.0.1:3000';
      });
    }

    if (btnTest) {
      btnTest.addEventListener('click', async () => {
        let testUrl = (inputUrl ? inputUrl.value : '').trim().replace(/\/+$/, '');
        if (!testUrl) {
          notifyPrompt('Validation', 'Please enter a valid URL', 'warning');
          return;
        }
        if (!/^https?:\/\//i.test(testUrl)) testUrl = 'http://' + testUrl;
        if (inputUrl) inputUrl.value = testUrl;

        if (statusPill) {
          statusPill.textContent = 'Pinging...';
          statusPill.className = 'badge badge-group';
        }
        await withNetworkLoader('Pinging ' + testUrl + '...', async () => {
          try {
            const doFetch = (window.CCApi && window.CCApi.fetch) ? window.CCApi.fetch : fetch;
            const res = await doFetch(testUrl + '/api/health', { method: 'GET' }, 8000);
            if (res.ok) {
              const data = await res.json();
              if (statusPill) {
                statusPill.textContent = 'Connected (HTTP 200)';
                statusPill.className = 'badge status-2xx';
              }
              // Immediately commit verified working connection to app state
              window.CCApi.setBaseUrl(testUrl);
              window.CCApi.mode = 'live';
              state.serverMode = 'live';
              const serverUrlInput = document.getElementById('server-url-input');
              if (serverUrlInput) serverUrlInput.value = testUrl;
              const mainPill = document.getElementById('server-status-pill');
              if (mainPill) {
                mainPill.textContent = 'Live MySQL Server';
                mainPill.className = 'badge status-2xx';
              }
              const banner = document.getElementById('offline-banner');
              if (banner) banner.classList.remove('active');
              stopBackoffCountdown();
              consecutiveHeartbeatFailures = 0;
              notifyPrompt('Connection Success (200 OK)', 'Server active: ' + (data.app || data.service || 'Campus Companion API'), 'success');
            } else {
              throw new Error('HTTP ' + res.status);
            }
          } catch (err) {
            if (statusPill) {
              statusPill.textContent = 'Unreachable';
              statusPill.className = 'badge badge-unassigned';
            }
            notifyPrompt('Ping Failed', 'Could not reach ' + testUrl + '/api/health. Check Wi-Fi or firewall.', 'destructive');
          }
        });
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        let newUrl = (inputUrl ? inputUrl.value : '').trim().replace(/\/+$/, '');
        if (newUrl) {
          if (!/^https?:\/\//i.test(newUrl)) newUrl = 'http://' + newUrl;
          window.CCApi.setBaseUrl(newUrl);
          window.CCApi.mode = 'live';
          state.serverMode = 'live';
          const serverUrlInput = document.getElementById('server-url-input');
          if (serverUrlInput) serverUrlInput.value = newUrl;
          notifyPrompt('Configuration Saved', 'Active server URL: ' + newUrl, 'info');
          closeModal(modalId);
          await withNetworkLoader('Connecting to ' + newUrl + '...', async () => {
            await checkBackendConnection(true, true);
          });
        }
      });
    }
  }

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

    // 4. Close Soft Keyboard on Enter / Go / Search Key across all inputs
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        const el = e.target;
        if (!el || el.tagName === 'TEXTAREA') return;
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
          const form = el.closest('form');
          if (!form) {
            e.preventDefault();
          }
          setTimeout(() => {
            try { el.blur(); } catch (_) {}
            NativeBridge.hideKeyboard();
          }, 10);
        }
      }
    });

    // Also close keyboard whenever any form submits
    document.addEventListener('submit', function () {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (_) {}
      }
      NativeBridge.hideKeyboard();
    });
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
    const cleaned = String(str || '')
      .replace(/^(CS|IT|ITED)\s*[^a-zA-Z0-9\s()]+\s*/i, '$1 - ')
      .replace(/â€”|â€“|\u2014|\u2013/g, '-')
      .replace(/â€¢/g, '•');
    return cleaned.replace(/[&<>"']/g, function (m) {
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
