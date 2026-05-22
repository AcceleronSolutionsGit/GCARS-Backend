const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const [rows] = await db.query(
      'SELECT * FROM users WHERE (email = ? OR username = ?) AND status = "Active" LIMIT 1',
      [email, email]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Fetch roles
    const [roleRows] = await db.query(
      `SELECT r.name FROM roles r
       JOIN role_user ru ON ru.role_id = r.id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const roles = roleRows.map(r => r.name);

    // Fetch permissions
    const [permRows] = await db.query(
      `SELECT p.name FROM permissions p
       JOIN permission_role pr ON pr.permission_id = p.id
       JOIN role_user ru ON ru.role_id = pr.role_id
       WHERE ru.user_id = ?`,
      [user.id]
    );
    const permissions = permRows.map(p => p.name);

    const token = jwt.sign(
      {
        id: user.id,
        emp_no: user.emp_no,
        email: user.email,
        username: user.username,
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
        id: user.id,
        username: user.username,
        email: user.email,
        emp_no: user.emp_no,
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

// POST /api/auth/change-password
router.post('/change-password', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });

    const user = rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password incorrect' });

    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hashed, user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.emp_no, u.user_type, u.status,
              me.name, me.grade, me.desg, me.sbu, me.b_func, me.location
       FROM users u
       LEFT JOIN capex_master_employee me ON me.emp_no = u.emp_no
       WHERE u.id = ? LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    
    const user = rows[0];

    // Fetch roles and permissions
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
    
    user.roles = roles;
    user.permissions = permissions;

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
