require('dotenv').config();
const express = require('express');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');
const studentRoutes = require('./routes/student.routes');
const groupRoutes = require('./routes/group.routes');

const app = express();
app.use(helmet());
app.use(express.json());

// NOTE: run this behind HTTPS in front of the remote backend (e.g. a
// reverse proxy with a TLS cert) — the API itself does not terminate TLS.

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/groups', groupRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Central error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR', message: 'Unexpected server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

module.exports = app;
