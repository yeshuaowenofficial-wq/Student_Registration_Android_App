# Campus Companion (BaseV2) — Android Lab Registration System
**Mulungushi University • ICT361 Android Group Project**

---

## 1. Project Overview

Campus Companion is an offline-capable, real-time lab group registration and scheduling Android application designed for Mulungushi University computer science and IT students and lecturers.

- **Variant**: `BaseV2` (Official Stable Reference Release)
- **Application ID (Package)**: `com.example.ict361_lab`
- **Application Name**: `Campus Companion`
- **Default Visual Theme**: Mulungushi Purple (`classic` palette: `#F8F7FC`, `#50207A`, `#838CE5`)
- **Default App Icon**: Mulungushi University Crest (`mu`)
- **Standalone Experimental Beta Variant**: `BetaV1` (`com.example.ict361_lab.beta`), featuring UDP auto-discovery on port 41234, navy-sky theme, and graduation cap icon. Both apps can be installed side-by-side on the same device.

---

## 2. Pre-Compiled Deliverables

The production debug APKs are ready for direct installation:
- **Base App**: `baseV2.apk` (in this directory and `Downloads\Project\baseV2.apk`)
- **Beta App**: `BetaV1.apk` (in `Downloads\Project\BetaV1.apk`)

To install directly to a connected phone or emulator via ADB:
```powershell
adb install -r baseV2.apk
```

---

## 3. Demo Accounts & Credentials

### Lecturer Account
- **Role Tab**: Lecturer
- **Username**: `lecturer1`
- **Password**: `Lecturer#2026`
- **Name**: Dr. Mwansa
- **Capabilities**: Add new lab groups (`+ Add Group`), edit timetable schedules, assign/reassign students, approve/reject student lab transfer requests.

### Student Account
- **Role Tab**: Student
- **Username**: `202408138`
- **Password**: `Student#2026`
- **Name**: Chanda Mubanga (CS, Group G07)
- **Capabilities**: View own assigned group members and timetable slot, submit group transfer requests (choose preferred target group), submit student number correction requests.

### Self-Registration Codes
- **Lecturer Staff Invite Code**: `MU-STAFF-2026`
- **Student Claim Codes**: `MU-STUDENT-2026` (or `CLAIM-AAA111`)

---

## 4. Connecting to the Node.js / MySQL Backend

### A. Android Studio Emulator
1. Tap the gear icon in the top right of the Sign-In screen (or open **Settings -> Backend Server Connection**).
2. Set the URL to:
   ```
   http://10.0.2.2:3000
   ```
3. Tap **Test Connection** or **Save URL**.

### B. Physical Phone on Wi-Fi (Home / University Wi-Fi / Hotspot)
1. Ensure your laptop and phone are connected to the same Wi-Fi network.
2. Find your laptop's IPv4 address by running `ipconfig` in PowerShell (e.g. `192.168.1.37` or `172.16.x.x`).
3. In the app's server configuration screen, set:
   ```
   http://<YOUR-LAPTOP-IP>:3000
   ```
4. Tap **Test Connection**.

### C. Physical Phone via USB Cable (ADB Reverse)
If Wi-Fi isolation blocks connections on your local network:
1. Connect phone via USB with USB Debugging enabled.
2. Run in PowerShell on laptop:
   ```powershell
   adb reverse tcp:3000 tcp:3000
   ```
3. In the app, set the URL to `http://127.0.0.1:3000`.

---

## 5. University Wi-Fi (172.x.x.x Range) & Windows Firewall Setup

When connecting over University Wi-Fi (`172.16.0.0/12`):
1. **Windows Firewall Rule**: Windows classifies University Wi-Fi as a **Public Network**, blocking incoming connections by default. Open port 3000 by running PowerShell as Administrator:
   ```powershell
   New-NetFirewallRule -DisplayName "Campus Companion API (3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```
2. **Cleartext Traffic**: Android 9+ blocks cleartext HTTP to private IPs by default. This app is configured with `android:usesCleartextTraffic="true"` and `<base-config cleartextTrafficPermitted="true">` in `network_security_config.xml`, allowing seamless HTTP communication on `172.x.x.x`.

---

## 6. Concurrency, Offline & Fault Tolerance Design

The system is engineered to solve three critical real-world concurrency challenges:

### Challenge 1: Competing Requests for the Last Place in a Lab Group
- **Problem**: When a group (e.g. G01) has 14/15 members, two phones simultaneously submitting a join/transfer request could overfill the group.
- **Solution**: The backend executes an ACID transaction with pessimistic row-locking:
  ```sql
  SELECT group_id, capacity FROM lab_groups WHERE group_code = :code FOR UPDATE;
  ```
  The active member count is verified inside the lock. If full, the transaction rolls back and returns HTTP `409 GROUP_FULL`. Exactly one phone succeeds; the other is gracefully informed.

### Challenge 2: Network Drop After Database Update & Server Restarts
- **Problem**: The server commits a student transfer, but the network drops before the HTTP response reaches the phone. Or the server crashes and restarts. The phone retries the request.
- **Solution**: Mutating requests send an `X-Operation-Id` header (client-generated UUID). The backend stores completed response receipts in the MySQL `operation_receipts` table. On retry, the server replays the stored response without re-executing any side effects.

### Challenge 3: Stale Offline Edits After Remote Changes
- **Problem**: A user edits student details or submits a group request while offline. In the meantime, another lecturer modified the record, deleted the student, or filled the group.
- **Solution**: Optimistic Concurrency Control using an integer `version` column on all student records. The client sends `expected_version`. If the server record has changed, the server rejects with HTTP `409 VERSION_CONFLICT` (or `409 STUDENT_DELETED` / `409 GROUP_FULL`), preventing stale offline data from overwriting newer changes.

---

## 7. Starting the Backend Server

1. Open PowerShell and navigate to the backend folder:
   ```powershell
   cd backend
   ```
2. Install dependencies (if not already done):
   ```powershell
   npm install
   ```
3. Import the consolidated schema and seed data into MySQL:
   ```powershell
   mysql -u root -p < sql\v2.0_schema_and_spreadsheet_seed.sql
   ```
4. Start the server:
   ```powershell
   npm start
   ```
5. Verify in your browser: `http://localhost:3000/api/health`

---

## 8. Mobile Performance & Fluidity Architecture

To guarantee smooth 60fps operation across all Android devices (from budget phones to Google Pixel 6a / flagship devices):
1. **Asynchronous Native Network Bridge (`nativeHttpRequestAsync`)**: Direct native Wi-Fi HTTP client executes on a background `ExecutorService` thread pool. Results are delivered via Base64 callbacks, completely decoupling network I/O from the WebView V8 JavaScript thread and UI render pipeline.
2. **CSS Content Containment**: The student roster (208+ records) leverages CSS `content-visibility: auto` and `contain: layout style`, allowing Chromium to bypass rendering off-screen DOM nodes until scrolled into view.
3. **Capped Viewport Animations**: Anime.js stagger animations are constrained to the top 10 viewport cards (`.student-card:nth-child(-n+10)`), eliminating the 7.3-second animation frame penalty previously caused by animating 208 cards concurrently.
4. **Debounced Search Inputs**: Search filters use a 150ms debounce to prevent thrashing DOM re-renders on every keystroke.
5. **Adaptive Background Heartbeat**: Connection checks poll every 15 seconds (down from 5s) and pause automatically when the app is backgrounded (`visibilitychange`).
6. **Hardware Acceleration**: Declared `android:hardwareAccelerated="true"` in `AndroidManifest.xml` and enabled hardware layer rendering on the WebView (`View.LAYER_TYPE_HARDWARE`).
