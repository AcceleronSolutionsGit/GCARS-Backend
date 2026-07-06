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
const db      = require('../db');
const router  = express.Router();

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
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    // Look up the user by email or username; must be Active
    const [rows] = await db.query(
      'SELECT * FROM users WHERE (email = ? OR username = ?) AND status = "Active" LIMIT 1',
      [email, email]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];

    // ── Password verification with old_password support ───────
    // Check against `old_password` (plaintext) first, as per legacy system.
    let isMatch = false;

    if (user.old_password && password === user.old_password) {
      isMatch = true;
      // Transparently upgrade to bcrypt in the `password` column for future use
      const hashed = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
        [hashed, user.id]
      );
      console.log(`[Auth] Auto-migrated old_password for user id=${user.id}`);
    } else if (user.password && user.password.startsWith('$2')) {
      // Standard bcrypt comparison
      isMatch = await bcrypt.compare(password, user.password);
    } else if (user.password) {
      // Legacy plain-text comparison on `password` column just in case
      isMatch = (password === user.password);
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

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
    // Payload includes user identity and authorisation data so
    // middleware can gate routes without additional DB calls.
    const token = jwt.sign(
      {
        id:        user.id,
        emp_no:    user.emp_no,
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
    } else if (user.password && user.password.startsWith('$2')) {
      isMatch = await bcrypt.compare(current_password, user.password);
    } else {
      isMatch = (current_password === user.password);
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password incorrect' });
    }

    // Hash the new password and persist it
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashed, user.id]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
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
