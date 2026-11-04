/**
 * ============================================================
 *  G-CARS 2 — Authentication Routes
 * ============================================================
 *  Handles user authentication and session management.
 *
 *  Routes:
 *    POST /api/auth/login           – Log in and receive a JWT
 *    POST /api/auth/change-password – Change the current user's password
 *    GET  /api/auth/me              – Fetch the authenticated user's profile
 * ============================================================
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db      = require('../db');
const router  = express.Router();

// ── Rate Limiting for Authentication ─────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                  // 30 login attempts per IP per window
  message: { success: false, message: 'Too many login attempts from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────
/**
 * Authenticate a user and return a signed JWT.
 *
 * Accepts either email address OR username in the `email` field.
 * Handles two storage formats transparently:
 *   • Bcrypt hashes (starts with '$2') — compared via bcrypt.compare()
 *   • Plain-text passwords (legacy / imported users) — compared directly,
 *     then immediately re-hashed and saved so the account is migrated
 *     to bcrypt on the user's very next login with zero manual steps.
 *
 * @route  POST /api/auth/login
 * @access Public
 * @body   { email: string, password: string }
 * @returns { success, token, user: { id, username, email, emp_no, user_type, roles, permissions } }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`[Auth] Login attempt for: "${email}"`);

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    // Look up the user by email or username; must be Active
    const [rows] = await db.query(
      `SELECT u.*, me.name 
       FROM users u 
       LEFT JOIN capex_master_employee me ON u.emp_no = me.emp_no 
       WHERE (u.email = ? OR u.username = ?) AND u.status = "Active" LIMIT 1`,
      [email, email]
    );

    if (!rows.length) {
      console.warn(`[Auth] User not found or inactive: "${email}"`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];

    // ── Password verification with automatic bcrypt migration 
    let isMatch = false;

    if (user.old_password && password === user.old_password) {
      isMatch = true;
      try {
        const newHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = ?, old_password = NULL WHERE id = ?', [newHash, user.id]);
        console.log(`[Auth Migration] Migrated plaintext old_password for user ${user.id} to bcrypt`);
      } catch (e) {
        console.error('[Auth Migration Error]:', e);
      }
    } else if (user.password && password === user.password && !user.password.startsWith('$2')) {
      isMatch = true;
      try {
        const newHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password = ?, old_password = NULL WHERE id = ?', [newHash, user.id]);
        console.log(`[Auth Migration] Migrated plaintext password for user ${user.id} to bcrypt`);
      } catch (e) {
        console.error('[Auth Migration Error]:', e);
      }
    } else if (user.password && user.password.startsWith('$2') && await bcrypt.compare(password, user.password)) {
      isMatch = true;
    }

    if (!isMatch) {
      console.warn(`[Auth] Password mismatch for: "${email}" (id: ${user.id})`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    console.log(`[Auth] Login SUCCESS for: "${email}" (id: ${user.id})`);

    // ── Fetch roles & permissions ──────────────────────────────
    const [roleRows] = await db.query(
      `SELECT r.name FROM roles r
       JOIN role_user ru ON ru.role_id = r.id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const roles = roleRows.map(r => r.name);

    const [permRows] = await db.query(
      `SELECT p.name FROM permissions p
       JOIN permission_role pr ON pr.permission_id = p.id
       JOIN role_user ru ON ru.role_id = pr.role_id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const permissions = permRows.map(p => p.name);

    // ── Sign JWT ───────────────────────────────────────────────
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured on server');
    }
    const token = jwt.sign(
      {
        id:        user.id,
        emp_no:    user.emp_no,
        name:      user.name,
        email:     user.email,
        username:  user.username,
        user_type: user.user_type,
        roles,
        permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id:        user.id,
        username:  user.username,
        name:      user.name,
        email:     user.email,
        emp_no:    user.emp_no,
        user_type: user.user_type,
        roles,
        permissions,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/auth/change-password
// ─────────────────────────────────────────────────────────────
/**
 * Allow the authenticated user to change their own password.
 * Verifies the current password before accepting the new one.
 *
 * @route  POST /api/auth/change-password
 * @access Private (authMiddleware)
 * @body   { current_password: string, new_password: string }
 * @returns { success, message }
 */
router.post('/change-password', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    // Fetch the user's current record
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = rows[0];

    // Verify the current password before allowing a change
    let isMatch = false;
    if (user.old_password && current_password === user.old_password) {
      isMatch = true;
    } else if (user.password && current_password === user.password) {
      isMatch = true;
    } else if (user.password && user.password.startsWith('$2') && await bcrypt.compare(current_password, user.password)) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password incorrect' });
    }

    // Hash new password using bcrypt before persisting
    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    await db.query(
      'UPDATE users SET password = ?, old_password = NULL, updated_at = NOW() WHERE id = ?',
      [hashedNewPassword, user.id]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[Change Password Error]:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────────────────────
/**
 * Return the full profile of the currently authenticated user,
 * including their employee details, roles, and permissions.
 * Used by the frontend on page load to hydrate AuthContext.
 *
 * @route  GET /api/auth/me
 * @access Private (authMiddleware)
 * @returns { success, user: { id, username, email, emp_no, user_type,
 *             name, grade, desg, sbu, b_func, location, roles, permissions } }
 */
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    // Join with capex_master_employee to get the full employee profile
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.emp_no, u.user_type, u.status,
              me.name, me.grade, me.desg, me.sbu, me.b_func, me.location
       FROM users u
       LEFT JOIN capex_master_employee me ON me.emp_no = u.emp_no
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = rows[0];

    // Fetch current roles
    const [roleRows] = await db.query(
      `SELECT r.name FROM roles r
       JOIN role_user ru ON ru.role_id = r.id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const roles = roleRows.map(r => r.name);

    // Fetch current permissions (derived from role assignments)
    const [permRows] = await db.query(
      `SELECT p.name FROM permissions p
       JOIN permission_role pr ON pr.permission_id = p.id
       JOIN role_user ru ON ru.role_id = pr.role_id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const permissions = permRows.map(p => p.name);

    user.roles       = roles;
    user.permissions = permissions;

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
