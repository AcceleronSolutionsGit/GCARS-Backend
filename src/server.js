/**
 * ============================================================
 *  G-CARS 2 — Express Application Entry Point
 * ============================================================
 *  Bootstraps the Express server, registers global middleware,
 *  mounts all API route groups, and starts listening on the
 *  configured port.
 *
 *  Route map:
 *    /api/auth        → Authentication (login, token, me)
 *    /api/requests    → CAPEX/OPEX request lifecycle
 *    /api/masters     → Read-only master data (assets, SBUs…)
 *    /api/reports     → Dashboard & export reports
 *    /api/superadmin  → User management & system configuration
 * ============================================================
 */

const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');

const app = express();

// ── CORS ──────────────────────────────────────────────────────
// Allow requests from the Vite dev server (frontend).
// Credentials must be true for cookie-based sessions if ever used.
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174'], credentials: true }));

// ── Body Parsers ──────────────────────────────────────────────
// Increase JSON limit to 10 MB to support bulk upload payloads.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static Files ──────────────────────────────────────────────
// Serve uploaded files (e.g. attachments) at /uploads/<filename>
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/requests',   require('./routes/requests'));
app.use('/api/masters',    require('./routes/masters'));
app.use('/api/reports',    require('./routes/reports'));
app.use('/api/superadmin', require('./routes/superadmin'));

// ── Health Check ──────────────────────────────────────────────
// Used by load balancers / monitoring to verify the service is up.
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    app:       'G-CARS 2 API',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── 404 Handler ───────────────────────────────────────────────
// Catches any request that did not match a registered route.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// ── Global Error Handler ──────────────────────────────────────
// Catches unhandled errors thrown inside route handlers.
// Must have exactly 4 parameters for Express to treat it as an error handler.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Server Start ──────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 G-CARS 2 API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
