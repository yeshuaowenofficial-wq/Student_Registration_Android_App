require('dotenv').config();
const express = require('express');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/student.routes');
const groupRoutes = require('./routes/group.routes');
const courseRoutes = require('./routes/course.routes');
const gradeRoutes = require('./routes/grade.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const timetableRoutes = require('./routes/timetable.routes');

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS — the Android app's UI runs inside a WebView loaded from
// file:///android_asset, so its requests arrive with Origin "null".
// Auth is by bearer token (no cookies), so allowing any origin is safe here.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Operation-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// NOTE: run this behind HTTPS in front of the remote backend (e.g. a
// reverse proxy with a TLS cert) — the API itself does not terminate TLS.

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timetable', timetableRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Campus Companion' }));

// Central error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR', message: 'Unexpected server error' });
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 = reachable from the emulator (10.0.2.2) AND from phones on the same Wi-Fi.
app.listen(PORT, '0.0.0.0', () => console.log(`Campus Companion API listening on port ${PORT}`));

module.exports = app;
