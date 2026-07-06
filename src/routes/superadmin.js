/**
 * ============================================================
 *  G-CARS 2 — Super-Admin Routes
 * ============================================================
 *  All system-administration endpoints. Most routes require the
 *  `superAdminOnly` or `cfoOrAdmin` middleware guard.
 *
 *  ── Users (superAdminOnly)
 *    GET    /users              – List all users (paginated, searchable)
 *    POST   /users              – Create a new user account
 *    PUT    /users/:id          – Update a user account
 *    DELETE /users/:id          – Soft-delete a user account
 *
 *  ── Dashboard & Allocations (cfoOrAdmin)
 *    GET    /dashboard          – Admin dashboard KPIs
 *    GET    /allocations        – List budget allocations (paginated)
 *    POST   /allocations        – Create a new allocation
 *    PUT    /allocations/:id    – Update an allocation
 *    DELETE /allocations/:id    – Soft-delete an allocation
 *
 *  ── Workflow Matrix (superAdminOnly)
 *    GET    /workflow-matrix      – List all approval matrix configs
 *    GET    /workflow-matrix/:id  – Get a single matrix config
 *    POST   /workflow-matrix      – Create / assign a matrix config
 *    DELETE /workflow-matrix/:id  – Remove a matrix config
 *
 *  ── Approval Workflow (CRUD)
 *    GET    /workflows               – List named workflow templates
 *    POST   /workflows               – Create a workflow template
 *    PUT    /workflows/:id           – Update a workflow template
 *    DELETE /workflows/:id           – Delete a workflow template
 *    GET    /workflow                – List all workflow steps
 *    POST   /workflow                – Create a workflow step
 *    PUT    /workflow/bulk-toggle    – Enable / disable all steps
 *    PUT    /workflow/:id            – Update a single step
 *    PUT    /workflow/:id/toggle     – Toggle a single step active/inactive
 *    DELETE /workflow/:id            – Delete a step
 *    PUT    /workflow-reorder        – Bulk reorder steps by position
 *    POST   /workflow-seed-defaults  – Seed default workflow configuration
 *
 *  ── Roles & Permissions
 *    GET    /roles                    – List all roles
 *    GET    /permissions              – List all permissions
 *    GET    /roles/:id/permissions    – Get permissions for a role
 *    POST   /roles/:id/permissions    – Assign permissions to a role
 *    POST   /roles                    – Create a role
 *    DELETE /roles/:id                – Delete a role
 *
 *  ── Master Data (write) — Locations, SBUs, Employees,
 *                            Broad Functions, Asset Groups,
 *                            Budget Owners, Accountants
 *    GET / POST / PUT / DELETE per entity (see banners below)
 *
 *  ── Lookup / Single-record GET endpoints (all at bottom)
 *    GET /employees/:emp_no, /locations/:id, /sbus/:id, etc.
 * ============================================================
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authMiddleware, superAdminOnly, cfoOrAdmin } = require('../middleware/auth');
const router  = express.Router();

// Apply JWT authentication to every route in this file
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
//  SECTION: USERS
//  Manage login accounts in the `users` table.
//  All routes in this section require superAdminOnly.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/users - list all users with roles
router.get('/users', superAdminOnly, async (req, res) => {
  try {
    const { search = '', status = '', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) { where += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.emp_no LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where += ' AND u.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.emp_no, u.user_type, u.status, u.created_at,
              GROUP_CONCAT(DISTINCT r.display_name SEPARATOR ', ') as roles,
              GROUP_CONCAT(DISTINCT r.id) as role_ids,
              (SELECT GROUP_CONCAT(DISTINCT p.name) FROM permissions p 
               JOIN permission_role pr ON pr.permission_id = p.id 
               JOIN role_user ru2 ON ru2.role_id = pr.role_id 
               WHERE ru2.user_id = u.id) as permissions_list,
              me.name as full_name, me.sbu, me.location, me.desg, me.rpt_code, me.b_func, me.b_func_id,
              u.default_flow_id
       FROM users u
       LEFT JOIN role_user ru ON ru.user_id = u.id
       LEFT JOIN roles r ON r.id = ru.role_id
       LEFT JOIN capex_master_employee me ON me.emp_no = u.emp_no
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(DISTINCT u.id) as total FROM users u ${where}`,
      params
    );

    res.json({ success: true, data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/users - create user
router.post('/users', superAdminOnly, async (req, res) => {
  try {
    const { 
      username, email, emp_no, password, user_type, 
      role_ids = [], status = 'Active',
      b_func, b_func_id
    } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'username, email, password required' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing.length) return res.status(409).json({ success: false, message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, email, emp_no, password, user_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [username, email, emp_no || null, hashed, user_type || 'user', status]
    );
    const userId = result.insertId;

    if (emp_no) {
      await db.query(`
        INSERT INTO capex_master_employee (emp_no, name, email, sbu, location, rpt_code, b_func, b_func_id, status, created_at, sbu_id, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), sbu=VALUES(sbu), location=VALUES(location), rpt_code=VALUES(rpt_code), b_func=VALUES(b_func), b_func_id=VALUES(b_func_id), status=VALUES(status), sbu_id=VALUES(sbu_id), location_id=VALUES(location_id)
      `, [emp_no, req.body.full_name || username, email, req.body.sbu || '', req.body.location || '', req.body.rpt_code || '', b_func || '', b_func_id || null, status, req.body.sbu_id || 1, req.body.location_id || 1]);
    }

    if (role_ids.length) {
      const roleInserts = role_ids.map(rid => [userId, rid]);
      await db.query('INSERT INTO role_user (user_id, role_id) VALUES ?', [roleInserts]);
    }

    res.status(201).json({ success: true, message: 'User created', id: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/users/:id - update user
router.put('/users/:id', superAdminOnly, async (req, res) => {
  try {
    const { 
      username, email, emp_no, user_type, status, 
      role_ids, password,
      b_func, b_func_id
    } = req.body;
    const updates = [];
    const params = [];

    if (username) { updates.push('username = ?'); params.push(username); }
    if (email) { updates.push('email = ?'); params.push(email); }
    if (emp_no !== undefined) { updates.push('emp_no = ?'); params.push(emp_no); }
    if (user_type) { updates.push('user_type = ?'); params.push(user_type); }
    if (status) { updates.push('status = ?'); params.push(status); }
    if (password) { const h = await bcrypt.hash(password, 10); updates.push('password = ?'); params.push(h); }
    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [u] = await db.query('SELECT username, email, emp_no FROM users WHERE id = ?', [req.params.id]);
    if (u.length && u[0].emp_no) {
      await db.query(`
        INSERT INTO capex_master_employee (emp_no, name, email, sbu, location, rpt_code, b_func, b_func_id, status, created_at, sbu_id, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
        ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), sbu=VALUES(sbu), location=VALUES(location), rpt_code=VALUES(rpt_code), b_func=VALUES(b_func), b_func_id=VALUES(b_func_id), status=VALUES(status), sbu_id=VALUES(sbu_id), location_id=VALUES(location_id)
      `, [u[0].emp_no, req.body.full_name || u[0].username, u[0].email, req.body.sbu || '', req.body.location || '', req.body.rpt_code || '', b_func || '', b_func_id || null, status || 'Active', req.body.sbu_id || 1, req.body.location_id || 1]);
    }

    if (role_ids !== undefined) {
      await db.query('DELETE FROM role_user WHERE user_id = ?', [req.params.id]);
      if (role_ids.length) {
        const roleInserts = role_ids.map(rid => [req.params.id, rid]);
        await db.query('INSERT INTO role_user (user_id, role_id) VALUES ?', [roleInserts]);
      }
    }

    res.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/users/:id - deactivate
router.delete('/users/:id', superAdminOnly, async (req, res) => {
  try {
    await db.query("UPDATE users SET status = 'Inactive', updated_at = NOW() WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────
// CFO & ADMIN SHARED ROUTES (Lower Restriction)
// ─────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════
//  SECTION: DASHBOARD & ADMIN KPIs
//  High-level statistics for the admin overview page.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/dashboard - system metrics
router.get('/dashboard', cfoOrAdmin, async (req, res) => {
  try {
    const [resUsers] = await db.query('SELECT COUNT(*) as totalUsers FROM users WHERE status = "Active"');
    const [resRequests] = await db.query('SELECT COUNT(*) as totalRequests FROM capex_request');
    const [resPending] = await db.query("SELECT COUNT(*) as pendingRequests FROM capex_request WHERE status IN ('Pending', 'Initiated', 'IN PROGRESS', 'IN STOCK')");
    const [resApproved] = await db.query("SELECT COUNT(*) as approvedRequests FROM capex_request WHERE status IN ('Approved', 'COMPLETE', 'PO CREATED', 'SANCTION NUMBER GENERATED', 'ASSET CREATED')");
    const [resRejected] = await db.query("SELECT COUNT(*) as rejectedRequests FROM capex_request WHERE status IN ('Rejected', 'REJECT', 'FAIL')");
    const [resEmployees] = await db.query('SELECT COUNT(*) as totalEmployees FROM capex_master_employee WHERE status = "Active"');
    const [resBudget] = await db.query('SELECT COALESCE(SUM(budgeted_amount),0) as totalBudget FROM capex_allocation WHERE status = "Active"');
    const [resConsumed] = await db.query('SELECT COALESCE(SUM(budget_amount_consumed),0) as consumedBudget FROM capex_allocation WHERE status = "Active"');
    const [resCommitted] = await db.query('SELECT COALESCE(SUM(committed_amount),0) as committedBudget FROM capex_allocation WHERE status = "Active"');

    // Recent requests
    const [recentRequests] = await db.query(
      `SELECT cr.capex_no, cr.status, cr.created_at, cr.asset_name,
              me.name as requester_name
       FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       ORDER BY cr.created_at DESC LIMIT 10`
    );

    res.json({
      success: true,
      stats: { 
        totalUsers: resUsers[0]?.totalUsers || 0, 
        totalRequests: resRequests[0]?.totalRequests || 0, 
        pendingRequests: resPending[0]?.pendingRequests || 0, 
        approvedRequests: resApproved[0]?.approvedRequests || 0, 
        rejectedRequests: resRejected[0]?.rejectedRequests || 0, 
        totalEmployees: resEmployees[0]?.totalEmployees || 0, 
        totalBudget: resBudget[0]?.totalBudget || 0, 
        consumedBudget: resConsumed[0]?.consumedBudget || 0,
        committedBudget: resCommitted[0]?.committedBudget || 0
      },
      recentRequests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: BUDGET ALLOCATIONS
//  CRUD for budget allocations and related budget entities.
//  Requires cfoOrAdmin access.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/allocations - list allocations with pagination/filters
router.get('/allocations', cfoOrAdmin, async (req, res) => {
  try {
    const { year, page = 1, limit = 50, search = '', asset_group, budget_type } = req.query;
    console.log('[DEBUG] Allocations Filter:', { year, page, limit, search, asset_group, budget_type });
    const offset = (Number(page) - 1) * Number(limit);
    
    let baseQ = `FROM capex_allocation ca
                LEFT JOIN capex_budget_entity be ON be.id = ca.budget_entity
                LEFT JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
                LEFT JOIN capex_master_asset_group ag ON ag.id = ca.asset_group
                LEFT JOIN capex_budget_type bt ON bt.id = ca.budget_type
                WHERE ca.status != 'Delete'`;
    const params = [];
    
    if (year) { baseQ += ' AND ca.year = ?'; params.push(year); }
    if (asset_group) { baseQ += ' AND ca.asset_group = ?'; params.push(asset_group); }
    if (budget_type) { baseQ += ' AND ca.budget_type = ?'; params.push(budget_type); }
    if (search) {
      baseQ += ' AND (be.entity_name LIKE ? OR at2.asset_name LIKE ? OR ag.name LIKE ? OR ca.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    // Count total
    const [countRows] = await db.query(`SELECT COUNT(*) as cnt ${baseQ}`, params);
    const total = countRows[0].cnt;

    const dataQ = `SELECT ca.*, be.entity_name, ag.name as asset_group_name, at2.asset_name as asset_type_name, bt.budget_type as budget_type_name
                  ${baseQ}
                  ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`;
    
    const dataParams = [...params, Number(limit), offset];
    const [rows] = await db.query(dataQ, dataParams);
    
    res.json({ success: true, data: rows, total });
  } catch (err) {
    console.error('Allocation list error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/allocations - create allocation
router.post('/allocations', cfoOrAdmin, async (req, res) => {
  try {
    const { sbu_id, bfun_id, loc_id, asset_group, asset_type, budget_type, budgeted_amount, year, description } = req.body;
    
    let budget_entity = req.body.budget_entity;

    if (!budget_entity && sbu_id && bfun_id && loc_id) {
      // Find or create entity
      const [existing] = await db.query(
        "SELECT id FROM capex_budget_entity WHERE sbu_id = ? AND b_fun_id = ? AND loc_id = ? AND status != 'Delete'",
        [sbu_id, bfun_id, loc_id]
      );

      if (existing.length > 0) {
        budget_entity = existing[0].id;
      } else {
        // Create new entity
        // Get names for entity_name
        const [[sbu]] = await db.query("SELECT sbu_name FROM capex_master_sbu_master WHERE id = ?", [sbu_id]);
        const [[fun]] = await db.query("SELECT b_func FROM capex_master_broad_function WHERE id = ?", [bfun_id]);
        const [[loc]] = await db.query("SELECT location FROM capex_master_location WHERE id = ?", [loc_id]);
        
        const entityName = `${sbu?.sbu_name || 'SBU'} - ${fun?.b_func || 'FUN'} - ${loc?.location || 'LOC'}`;
        
        const [entResult] = await db.query(
          "INSERT INTO capex_budget_entity (entity_name, sbu_id, b_fun_id, loc_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Active', NOW(), NOW())",
          [entityName, sbu_id, bfun_id, loc_id]
        );
        budget_entity = entResult.insertId;
      }
    }

    if (!budget_entity) {
      return res.status(400).json({ success: false, message: 'Budget Entity or SBU/Function/Location combination required' });
    }

    const [result] = await db.query(
      `INSERT INTO capex_allocation (budget_entity, asset_group, asset_type, budget_type, budgeted_amount, year, description, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', NOW(), NOW())`,
      [budget_entity, asset_group, asset_type, budget_type, budgeted_amount, year || new Date().getFullYear(), description]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/allocations/:id
router.put('/allocations/:id', cfoOrAdmin, async (req, res) => {
  try {
    const { budgeted_amount, description, status } = req.body;
    await db.query(
      `UPDATE capex_allocation SET budgeted_amount = ?, description = ?, status = ?, updated_at = NOW() WHERE id = ?`,
      [budgeted_amount, description, status, req.params.id]
    );
    res.json({ success: true, message: 'Allocation updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/allocations/:id
router.delete('/allocations/:id', cfoOrAdmin, async (req, res) => {
  try {
    await db.query("UPDATE capex_allocation SET status = 'Delete' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Allocation deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/budget-entities
router.get('/budget-entities', cfoOrAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, entity_name FROM capex_budget_entity WHERE status = 'Active' ORDER BY entity_name");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/employees/search
router.get('/employees/search', cfoOrAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) return res.json({ success: true, data: [] });
      const [rows] = await db.query(`
        SELECT emp_no, name, desg, sbu, location 
        FROM capex_master_employee 
        WHERE (name LIKE ? OR emp_no LIKE ?) AND status = 'Active'
        LIMIT 20
      `, [`%${q}%`, `%${q}%`]);
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/superadmin/masters - combined masters for dropdowns
router.get('/masters', cfoOrAdmin, async (req, res) => {
    try {
        const [assetGroups] = await db.query("SELECT id, name FROM capex_master_asset_group WHERE status = 'Active'");
        const [sbus] = await db.query("SELECT id, sbu_name as name FROM capex_master_sbu_master WHERE status = 'Active'");
        const [functions] = await db.query("SELECT id, b_func as name FROM capex_master_broad_function WHERE status = 'Active'");
        res.json({ success: true, assetGroups, sbus, functions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: SYSTEM SETTINGS
//  Global key/value application settings (e.g. fiscal year,
//  request limits, feature flags).
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/settings - fetch system settings (Shared)
router.get('/settings', cfoOrAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM system_settings');
    const settings = rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value === 'true' ? true : row.setting_value === 'false' ? false : row.setting_value;
      return acc;
    }, {});
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// POST /api/superadmin/settings - update a system setting (Shared)
router.post('/settings', cfoOrAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const strValue = String(value);
    await db.query(
      'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      [key, strValue, strValue]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─────────────────────────────────────────────────────
// SUPERADMIN ONLY ROUTES
// ─────────────────────────────────────────────────────

router.use(superAdminOnly);


// ═══════════════════════════════════════════════════════════════
//  SECTION: WORKFLOW MATRIX
//  Maps workflow templates to specific SBU/location/request-type
//  combinations (which approval chain applies to which requester).
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/workflow-matrix - List all mappings grouped by matrix_id
router.get('/workflow-matrix', superAdminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.id, CONCAT(m.id, '_', COALESCE(c.broad_function_head, '0')) as unique_id, 
              m.asset_group, m.asset_type, m.status,
              ag.name as asset_group_name, at2.asset_name as asset_type_name,
              GROUP_CONCAT(DISTINCT c.sbu) as sbu, 
              GROUP_CONCAT(DISTINCT c.b_fun) as b_fun,
              c.broad_function_head as owner_id,
              bfh.head as owner_name, me.name as emp_name
       FROM capex_budget_determination_matrix m
       LEFT JOIN capex_master_asset_group ag ON ag.id = m.asset_group
       LEFT JOIN capex_master_asset_type at2 ON at2.id = m.asset_type
       LEFT JOIN capex_budget_determination_matrix_combination c ON c.budget_matrix_id = m.id
       LEFT JOIN capex_master_broad_function_head bfh ON bfh.id = c.broad_function_head
       LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
       GROUP BY m.id, c.broad_function_head
       ORDER BY ag.name, at2.asset_name`
    );

    // Resolve comma-separated SBU IDs and Broad Function IDs to names in JS
    const [sbuMaster] = await db.query("SELECT id, sbu_name FROM capex_master_sbu_master");
    const [funcMaster] = await db.query("SELECT id, b_func FROM capex_master_broad_function");
    const sbuMap = (sbuMaster || []).reduce((acc, s) => ({ ...acc, [String(s.id)]: s.sbu_name }), {});
    const funcMap = (funcMaster || []).reduce((acc, f) => ({ ...acc, [String(f.id)]: f.b_func }), {});

    const resolved = rows.map(r => {
      // Resolve SBU
      const sbus = (r.sbu || '').split(',').map(s => {
        const trimmed = s.trim();
        return sbuMap[trimmed] || trimmed;
      });
      const uniqueSbus = [...new Set(sbus)].filter(Boolean).join(', ');

      // Resolve Broad Function
      const funs = (r.b_fun || '').split(',').map(f => {
        const trimmed = f.trim();
        return funcMap[trimmed] || trimmed;
      });
      const uniqueFuns = [...new Set(funs)].filter(Boolean).join(', ');

      return {
        ...r,
        sbu: uniqueSbus || 'All',
        b_fun_names: uniqueFuns || 'All',
        b_fun: r.b_fun // Keep raw b_fun IDs just in case
      };
    });

    res.json({ success: true, data: resolved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/workflow-matrix/:id - single matrix with raw combinations
router.get('/workflow-matrix/:id', async (req, res) => {
  try {
    const [[matrix]] = await db.query(
      `SELECT m.id, m.asset_group, m.asset_type, m.status,
              ag.name as asset_group_name, at2.asset_name as asset_type_name
       FROM capex_budget_determination_matrix m
       LEFT JOIN capex_master_asset_group ag ON ag.id = m.asset_group
       LEFT JOIN capex_master_asset_type at2 ON at2.id = m.asset_type
       WHERE m.id = ?`, [req.params.id]
    );
    if (!matrix) return res.status(404).json({ success: false, message: 'Not found' });

    const [combos] = await db.query(
      `SELECT c.sbu, c.b_fun, c.broad_function_head as owner_id,
              bfh.head as owner_name, me.name as emp_name
       FROM capex_budget_determination_matrix_combination c
       LEFT JOIN capex_master_broad_function_head bfh ON bfh.id = c.broad_function_head
       LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
       WHERE c.budget_matrix_id = ?`, [req.params.id]
    );

    // Fetch SBU and Broad Function masters for resolution
    const [sbuMaster] = await db.query("SELECT id, sbu_name FROM capex_master_sbu_master");
    const sbuMap = (sbuMaster || []).reduce((acc, s) => ({ ...acc, [String(s.id)]: s.sbu_name }), {});

    // Group combinations by owner_id to reconstruct rows
    const rowMap = {};
    for (const c of combos) {
      const key = c.owner_id || 'none';
      if (!rowMap[key]) rowMap[key] = { owner_id: c.owner_id, owner_name: c.owner_name, sbus: new Set(), b_funs: new Set() };
      
      // Split and resolve SBU (should be SBU name on frontend)
      const sbus = (c.sbu || 'All').split(',').map(s => s.trim());
      for (const s of sbus) {
        const resolvedSbu = sbuMap[s] || s;
        rowMap[key].sbus.add(resolvedSbu);
      }

      // Split and resolve Broad Function (should be Broad Function ID on frontend)
      const funs = (c.b_fun || 'All').split(',').map(f => f.trim());
      for (const f of funs) {
        rowMap[key].b_funs.add(f);
      }
    }
    const rows = Object.values(rowMap).map(r => ({
      sbu: [...r.sbus],
      b_fun: [...r.b_funs],
      owner_id: r.owner_id,
      owner_name: r.owner_name
    }));

    res.json({ success: true, data: { ...matrix, rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/workflow-matrix - Save mapping (supports multi-row)
router.post('/workflow-matrix', async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const { id, asset_group, asset_type, rows, sbu, b_fun, owner_id } = req.body;
    
    let matrixId = id;
    if (matrixId) {
      await connection.query(
        "UPDATE capex_budget_determination_matrix SET asset_group=?, asset_type=?, updated_at=NOW() WHERE id=?",
        [asset_group, asset_type, matrixId]
      );
    } else {
      const [mResult] = await connection.query(
        "INSERT INTO capex_budget_determination_matrix (asset_group, asset_type, status, created_at, updated_at) VALUES (?, ?, 'Active', NOW(), NOW())",
        [asset_group, asset_type]
      );
      matrixId = mResult.insertId;
    }

    // Clear existing combinations
    await connection.query("DELETE FROM capex_budget_determination_matrix_combination WHERE budget_matrix_id = ?", [matrixId]);
    
    // Multi-row format: rows = [{ sbu: [...], b_fun: [...], owner_id }, ...]
    if (Array.isArray(rows) && rows.length > 0) {
      for (const row of rows) {
        const sbuArr = Array.isArray(row.sbu) ? row.sbu : [row.sbu || 'All'];
        const funArr = Array.isArray(row.b_fun) ? row.b_fun : [row.b_fun || 'All'];
        for (const s of sbuArr) {
          for (const f of funArr) {
            await connection.query(
              "INSERT INTO capex_budget_determination_matrix_combination (budget_matrix_id, sbu, b_fun, broad_function_head, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
              [matrixId, s, f, row.owner_id]
            );
          }
        }
      }
    } else {
      // Legacy single-row format
      const sbuArr = Array.isArray(sbu) ? sbu : [sbu || 'All'];
      const funArr = Array.isArray(b_fun) ? b_fun : [b_fun || 'All'];
      for (const singleSbu of sbuArr) {
        for (const singleFun of funArr) {
          await connection.query(
            "INSERT INTO capex_budget_determination_matrix_combination (budget_matrix_id, sbu, b_fun, broad_function_head, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
            [matrixId, singleSbu, singleFun, owner_id]
          );
        }
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Mapping saved' });
  } catch (err) {
    console.error(err);
    await connection.rollback();
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// DELETE /api/superadmin/workflow-matrix/:id
router.delete('/workflow-matrix/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM capex_budget_determination_matrix_combination WHERE budget_matrix_id = ?", [req.params.id]);
    await db.query("DELETE FROM capex_budget_determination_matrix WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: BROAD FUNCTIONS (read)
//  Lookup endpoint for department / broad-function names.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/broad-functions - list all broad functions
router.get('/broad-functions', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 50, all = false } = req.query;
    let query = "SELECT id, b_func as name, status FROM capex_master_broad_function WHERE 1=1";
    const params = [];

    // Legacy logic: Only show Active by default for dropdowns, but show all for Admin list
    if (!all && search === '') {
       // dropdown mode
    }

    if (search) {
      query += " AND b_func LIKE ?";
      params.push(`%${search}%`);
    }

    query += " ORDER BY b_func";

    if (!all) {
      const offset = (page - 1) * limit;
      const countSql = "SELECT COUNT(*) as total FROM capex_master_broad_function WHERE 1=1" + (search ? " AND b_func LIKE ?" : "");
      const [countResult] = await db.query(countSql, search ? [`%${search}%`] : []);
      
      query += " LIMIT ? OFFSET ?";
      params.push(parseInt(limit), offset);
      
      const [rows] = await db.query(query, params);
      res.json({ success: true, data: rows, total: countResult[0].total });
    } else {
      const [rows] = await db.query(query, params);
      res.json({ success: true, data: rows });
    }
  } catch (err) {
     console.error(err);
     res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/asset-types - list all asset types with details
router.get('/asset-types', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT at.id, at.asset_name as name, at.asset_group as group_id, ag.name as group_name, at.status
      FROM capex_master_asset_type at
      LEFT JOIN capex_master_asset_group ag ON ag.id = at.asset_group
      ORDER BY ag.name, at.asset_name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
     res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/asset-types
router.post('/asset-types', async (req, res) => {
  try {
    const { name, group_id, status = 'Active' } = req.body;
    const [result] = await db.query(
      "INSERT INTO capex_master_asset_type (asset_name, asset_group, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
      [name, group_id, status]
    );
    res.json({ success: true, id: result.insertId, message: 'Asset type created' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/asset-types/:id
router.put('/asset-types/:id', async (req, res) => {
  try {
    const { name, group_id, status } = req.body;
    await db.query(
      "UPDATE capex_master_asset_type SET asset_name=?, asset_group=?, status=?, updated_at=NOW() WHERE id=?",
      [name, group_id, status, req.params.id]
    );
    res.json({ success: true, message: 'Asset type updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/asset-types/:id
router.delete('/asset-types/:id', async (req, res) => {
  try {
    // Check if used in matrix
    const [usage] = await db.query("SELECT id FROM capex_budget_determination_matrix WHERE asset_type = ?", [req.params.id]);
    if (usage.length > 0) return res.status(400).json({ success: false, message: 'Cannot delete: Used in active budget mappings' });

    await db.query("DELETE FROM capex_master_asset_type WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Asset type deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: ASSET GROUPS (read)
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/asset-groups
router.get('/asset-groups', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name FROM capex_master_asset_group ORDER BY name");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/budget-owners-legacy - list legacy budget owners
router.get('/budget-owners-legacy', async (req, res) => {
  try {
    const { status = '' } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND boh.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT boh.id, boh.Designation, boh.employee_code, boh.status,
              me.name as emp_name, me.sbu, me.desg, me.location, boh.created_at, boh.updated_at
       FROM capex_budget_owner_history boh
       LEFT JOIN capex_master_employee me ON me.emp_no = boh.employee_code
       ${where}
       ORDER BY boh.status ASC, boh.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────
// ROLE-BASED USER MANAGEMENT (MATCHES LEGACY LARAVEL)
// ─────────────────────────────────────────────────────

const LEGACY_ROLES = {
  IT_USER: 7,
  FINANCE_USER: 14,
  ACCOUNTANT: 26,
  LOC_USER: 27,
  PS_USER: 29,
  IT_REVIEWER: 30,
  BUSINESS_HEAD: 32,
  ADMIN_USER: 1
};

router.get('/manage-users', async (req, res) => {
  try {
    const { type } = req.query;
    const roleId = LEGACY_ROLES[type];
    if (!roleId) return res.status(400).json({ success: false, message: 'Invalid type' });
    const [rows] = await db.query(`
      SELECT ru.user_id as id, u.emp_no, me.name as emp_name
      FROM role_user ru
      JOIN users u ON u.id = ru.user_id
      LEFT JOIN capex_master_employee me ON me.emp_no = u.emp_no
      WHERE ru.role_id = ?
      ORDER BY me.name ASC
    `, [roleId]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false }); }
});

router.post('/manage-users', async (req, res) => {
  try {
    const { emp_no, type } = req.body;
    const roleId = LEGACY_ROLES[type];
    const [users] = await db.query("SELECT id FROM users WHERE emp_no = ?", [emp_no]);
    if (!users.length) return res.status(404).json({ success: false });
    await db.query("INSERT IGNORE INTO role_user (user_id, role_id) VALUES (?, ?)", [users[0].id, roleId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

router.delete('/manage-users/:userId', async (req, res) => {
  try {
    const { type } = req.query;
    await db.query("DELETE FROM role_user WHERE user_id = ? AND role_id = ?", [req.params.userId, LEGACY_ROLES[type]]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});


// GET /api/superadmin/broad-function-heads - management of dynamic budget owners
router.get('/broad-function-heads', async (req, res) => {
  try {
    const { filter = '' } = req.query;
    let where = 'WHERE 1=1';
    const params = [];

    if (filter === 'IT_USER') {
      where += " AND bfh.head LIKE '%IT%' AND bfh.head NOT LIKE '%Reviewer%'";
    } else if (filter === 'LOC_USER') {
      where += " AND bfh.head LIKE '%Location%'";
    } else if (filter === 'PS_USER') {
      where += " AND bfh.head LIKE '%PS_ADMIN%'";
    } else if (filter === 'IT_REVIEW') {
      where += " AND bfh.head LIKE '%Reviewer%'";
    } else if (filter === 'BH') {
      where += " AND bfh.head != 'budget_owner'";
    } else if (filter === 'ADMIN') {
      where += " AND (bfh.head LIKE '%Admin%' OR bfh.head LIKE '%Accountant%' OR bfh.head LIKE '%Finance%') AND bfh.head NOT LIKE '%PS_ADMIN%'";
    }

    const [rows] = await db.query(
      `SELECT bfh.id, bfh.head, bfh.sbu_id, bfh.bfun_id, bfh.emp_no, bfh.budget_owner, bfh.created_by,
              DATE_FORMAT(bfh.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
              DATE_FORMAT(bfh.updated_at, '%Y-%m-%d %H:%i:%s') as updated_at,
              me.name as emp_name
       FROM capex_master_broad_function_head bfh
       LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
       ${where}
       ORDER BY bfh.id ASC`,
      params
    );

    // FETCH ALL MASTERS FOR NAME RESOLUTION (handles comma separated IDs)
    const [allSbus] = await db.query("SELECT id, sbu_name FROM capex_master_sbu_master");
    const [allFuncs] = await db.query("SELECT id, b_func FROM capex_master_broad_function");
    const [allLocs] = await db.query("SELECT id, location FROM capex_master_location");
    
    const sbuMap = (allSbus || []).reduce((acc, s) => ({ ...acc, [String(s.id)]: s.sbu_name }), {});
    const funcMap = (allFuncs || []).reduce((acc, f) => ({ ...acc, [String(f.id)]: f.b_func }), {});
    const locMap = (allLocs || []).reduce((acc, l) => ({ ...acc, [String(l.id)]: l.location }), {});

    const resolvedRows = rows.map(row => {
      const sbu_id = row.sbu_id === null || row.sbu_id === undefined ? '' : String(row.sbu_id);
      const bfun_id = row.bfun_id === null || row.bfun_id === undefined ? '' : String(row.bfun_id);

      return {
        ...row,
        sbu_id: sbu_id || 'NULL',
        bfun_id: bfun_id || 'NULL',
        sbu_name: sbu_id ? (sbu_id === 'All' ? 'All' : sbu_id.split(',').map(id => sbuMap[id.trim()] || id).join(', ')) : '—',
        b_func: bfun_id ? (bfun_id === 'All' ? 'All' : bfun_id.split(',').map(id => funcMap[id.trim()] || id).join(', ')) : '—'
      };
    });

    res.json({ success: true, data: resolvedRows });
  } catch (err) {
    console.error('BroadFunctionHead Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/broad-function-heads - create new mapping
router.post('/broad-function-heads', async (req, res) => {
  try {
    const { head, sbu_id, bfun_id, emp_no, budget_owner = 'Active' } = req.body;
    await db.query(
      'INSERT INTO capex_master_broad_function_head (head, sbu_id, bfun_id, emp_no, budget_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [head, sbu_id, bfun_id, emp_no, budget_owner]
    );
    res.status(201).json({ success: true, message: 'Mapping created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/broad-function-heads/:id - update mapping with history
router.put('/broad-function-heads/:id', async (req, res) => {
  try {
    const { head, sbu_id, bfun_id, emp_no, budget_owner } = req.body;
    
    // ARCHIVE CURRENT STATE
    await db.query(`
      INSERT INTO capex_history_master_broad_functionmatrix 
      (master_id, head, sbu_id, bfun_id, emp_no, budget_owner, archived_at)
      SELECT id, head, sbu_id, bfun_id, emp_no, budget_owner, NOW()
      FROM capex_master_broad_function_head WHERE id = ?
    `, [req.params.id]).catch(e => console.log('History table missing, skipping archive.'));

    await db.query(
      'UPDATE capex_master_broad_function_head SET head=?, sbu_id=?, bfun_id=?, emp_no=?, budget_owner=?, updated_at=NOW() WHERE id=?',
      [head, sbu_id, bfun_id, emp_no, budget_owner, req.params.id]
    );
    res.json({ success: true, message: 'Mapping updated and archived' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/broad-function-heads/:id
router.delete('/broad-function-heads/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM capex_master_broad_function_head WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/broad-function-heads/history - view archive
router.get('/broad-function-heads/history', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_history_master_broad_functionmatrix ORDER BY archived_at DESC LIMIT 100');
    res.json({ success: true, data: rows });
  } catch (err) {
     res.json({ success: true, data: [] });
  }
});

// GET /api/superadmin/employees-search - for budget owner picker
router.get('/employees-search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const [rows] = await db.query(
      `SELECT emp_no, name, desg, sbu, location FROM capex_master_employee
       WHERE status = 'Active' AND (name LIKE ? OR emp_no LIKE ?)
       LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// ─────────────────────────────────────────────────────
// WORKFLOW EDITOR — gcars_workflow_config table (auto-created)
// ─────────────────────────────────────────────────────

// Ensure the workflow config table exists
async function ensureWorkflowTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gcars_workflow_config (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      flow_id     INT NOT NULL DEFAULT 1,
      step_order  INT NOT NULL DEFAULT 0,
      step_name   VARCHAR(100) NOT NULL,
      department  VARCHAR(100) NOT NULL DEFAULT 'All',
      role_key    VARCHAR(50)  NOT NULL,
      label       VARCHAR(150) NOT NULL,
      amount_min  DECIMAL(14,2) NOT NULL DEFAULT 0,
      amount_max  DECIMAL(14,2) NOT NULL DEFAULT 9999999999,
      applies_to  VARCHAR(20)  NOT NULL DEFAULT 'BOTH',
      is_active   TINYINT(1)   NOT NULL DEFAULT 1,
      description TEXT,
      created_at  DATETIME DEFAULT NOW(),
      updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
    )
  `);

  try {
    const [cols] = await db.query("SHOW COLUMNS FROM gcars_workflow_config LIKE 'flow_id'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE gcars_workflow_config ADD COLUMN flow_id INT NOT NULL DEFAULT 1 AFTER id");
    }
  } catch (e) {}

  // Seed defaults if empty
  const [cRows] = await db.query('SELECT COUNT(*) as cnt FROM gcars_workflow_config');
  if (cRows[0].cnt === 0) {
    await db.query(`
      INSERT INTO gcars_workflow_config
        (step_order, step_name, department, role_key, label, amount_min, amount_max, applies_to, is_active, description)
      VALUES
        (1, 'Supervisor Approval',    'All', 'supervisor',   'Supervisor',         0,         9999999999, 'BOTH',  1, 'Direct manager of the requester'),
        (2, 'IT Admin Review',        'All', 'it_admin',     'IT / PS Admin',      0,         9999999999, 'CAPEX', 0, 'IT asset review (optional)'),
        (3, 'Budget Owner Approval',  'All', 'budget_owner', 'Budget Owner',       0,         9999999999, 'BOTH',  1, 'Validates budget availability'),
        (4, 'Accountant Approval',    'All', 'accountant',   'Accountant',         0,         9999999999, 'BOTH',  1, 'Finance desk verification'),
        (5, 'CFO Approval',           'All', 'cfo',          'CFO',                500000,    9999999999, 'BOTH',  1, 'Required for amounts > ₹5L'),
        (6, 'CMD Approval',           'All', 'cmd',          'CMD / MD',           2500000,   9999999999, 'BOTH',  1, 'Required for amounts > ₹25L'),
        (7, 'Finance / SAP Closure',  'All', 'finance',      'Finance (SAP)',       0,         9999999999, 'BOTH',  1, 'Generates SAP asset number')
    `);
  }
}

// GET /api/superadmin/workflows - list all flows
router.get('/workflows', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM gcars_workflows ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// POST /api/superadmin/workflows - create a flow
router.post('/workflows', async (req, res) => {
  try {
    const { name, description, request_type, min_amount, max_amount, is_default } = req.body;
    
    const finalRequestType = is_default ? 'BOTH' : (request_type || 'BOTH');

    const [result] = await db.query(
      "INSERT INTO gcars_workflows (name, description, request_type, min_amount, max_amount, is_default) VALUES (?, ?, ?, ?, ?, ?)",
      [name, description, finalRequestType, min_amount || 0, max_amount || 999999999, is_default ? 1 : 0]
    );

    if (is_default) {
      await db.query("UPDATE users SET default_flow_id = ?", [result.insertId]);
    }

    res.status(201).json({ success: true, message: 'Workflow created', id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// PUT /api/superadmin/workflows/:id - update a flow
router.put('/workflows/:id', async (req, res) => {
  try {
    const { name, description, request_type, min_amount, max_amount, is_active, is_default } = req.body;
    
    // If making it default, force request_type to BOTH to cover CAPEX, OPEX, and BULK
    const finalRequestType = is_default ? 'BOTH' : request_type;
    
    await db.query(
      "UPDATE gcars_workflows SET name=?, description=?, request_type=?, min_amount=?, max_amount=?, is_active=?, is_default=? WHERE id=?",
      [name, description, finalRequestType, min_amount, max_amount, is_active ? 1 : 0, is_default ? 1 : 0, req.params.id]
    );

    if (is_default) {
      // Force all users to use this flow
      await db.query("UPDATE users SET default_flow_id = ?", [req.params.id]);
      // Ensure all steps in this flow apply to BOTH
      await db.query("UPDATE gcars_workflow_config SET applies_to = 'BOTH' WHERE flow_id = ?", [req.params.id]);
    }

    res.json({ success: true, message: 'Workflow updated' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// DELETE /api/superadmin/workflows/:id - delete a flow
router.delete('/workflows/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM gcars_workflows WHERE id = ?', [req.params.id]);
    await db.query('DELETE FROM gcars_workflow_config WHERE flow_id = ?', [req.params.id]);
    res.json({ success: true, message: 'Workflow and its steps deleted' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: APPROVAL WORKFLOW (CRUD)
//  Named workflow templates and their individual step definitions.
//  Steps define which role/employee approves at each stage.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/workflow - fetch all workflow steps
router.get('/workflow', async (req, res) => {
  try {
    await ensureWorkflowTable();
    const { department = 'All', flow_id = 1 } = req.query;
    const [rows] = await db.query(
      'SELECT * FROM gcars_workflow_config WHERE department = ? AND flow_id = ? ORDER BY step_order ASC',
      [department, flow_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/workflow - add a new step
router.post('/workflow', async (req, res) => {
  try {
    await ensureWorkflowTable();
    const { flow_id, step_order, step_name, department, role_key, label, amount_min, amount_max, applies_to, is_active, description } = req.body;
    if (!step_name || !role_key || !label) {
      return res.status(400).json({ success: false, message: 'step_name, role_key, label are required' });
    }
    const dept = department || 'All';
    const [result] = await db.query(
      `INSERT INTO gcars_workflow_config (flow_id, step_order, step_name, department, role_key, label, amount_min, amount_max, applies_to, is_active, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        flow_id || 1, step_order || 99, step_name, dept, role_key, label,
        amount_min || 0, amount_max || 9999999999,
        applies_to || 'BOTH', is_active ? 1 : 0, description || '',
      ]
    );
    res.status(201).json({ success: true, message: 'Workflow step added', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/workflow/bulk-toggle - toggle entire flow
router.put('/workflow/bulk-toggle', async (req, res) => {
  try {
    const { type, department, target_state } = req.body;
    await ensureWorkflowTable();
    await db.query(
      `UPDATE gcars_workflow_config 
       SET is_active = ?, updated_at=NOW() 
       WHERE department=? AND (applies_to=? OR applies_to='BOTH') AND flow_id=?`,
      [target_state ? 1 : 0, department, type, req.body.flow_id || 1]
    );
    res.json({ success: true, message: 'Flow toggled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/workflow/:id - update a step
router.put('/workflow/:id', async (req, res) => {
  try {
    await ensureWorkflowTable();
    const { step_order, step_name, department, role_key, label, amount_min, amount_max, applies_to, is_active, description } = req.body;
    
    // ARCHIVE CURRENT STATE
    await db.query(`
        INSERT INTO capex_history_a (original_id, step_name, role_key, label, amount_min, amount_max, archived_at)
        SELECT id, step_name, role_key, label, amount_min, amount_max, NOW()
        FROM gcars_workflow_config WHERE id = ?
    `, [req.params.id]).catch(() => {});

    const dept = department || 'All';
    await db.query(
      `UPDATE gcars_workflow_config
       SET flow_id=?, step_order=?, step_name=?, department=?, role_key=?, label=?, amount_min=?, amount_max=?,
           applies_to=?, is_active=?, description=?, updated_at=NOW()
       WHERE id=?`,
      [
        req.body.flow_id || 1, step_order, step_name, dept, role_key, label,
        amount_min, amount_max, applies_to || 'BOTH',
        is_active ? 1 : 0, description || '', req.params.id,
      ]
    );
    res.json({ success: true, message: 'Workflow step updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/workflow/:id/toggle - toggle active/inactive
router.put('/workflow/:id/toggle', async (req, res) => {
  try {
    await ensureWorkflowTable();
    await db.query(
      'UPDATE gcars_workflow_config SET is_active = NOT is_active, updated_at=NOW() WHERE id=?',
      [req.params.id]
    );
    res.json({ success: true, message: 'Step toggled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/workflow/:id - remove a step
router.delete('/workflow/:id', async (req, res) => {
  try {
    await ensureWorkflowTable();
    await db.query('DELETE FROM gcars_workflow_config WHERE id=?', [req.params.id]);
    res.json({ success: true, message: 'Workflow step deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/workflow/reorder - bulk reorder
router.put('/workflow-reorder', async (req, res) => {
  try {
    await ensureWorkflowTable();
    const { order } = req.body; // array of { id, step_order }
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'order[] required' });
    for (const item of order) {
      await db.query('UPDATE gcars_workflow_config SET step_order=?, updated_at=NOW() WHERE id=?', [item.step_order, item.id]);
    }
    res.json({ success: true, message: 'Order saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/workflow-seed-defaults — seed canonical CAPEX & OPEX flows
router.post('/workflow-seed-defaults', async (req, res) => {
  try {
    await ensureWorkflowTable();
    // Delete only 'All' flows if creating global defaults, or just delete all workflows. For now we delete by department 'All'.
    const { department = 'All' } = req.body;
    await db.query('DELETE FROM gcars_workflow_config WHERE department = ?', [department]);

    const defaults = [
      // ── CAPEX FLOW ──────────────────────────────────────────────────────────
      // Requester → Supervisor → IT Admin → Budget Owner → Accountant → CFO → CMD → Finance
      { label: 'Supervisor Approval',  role_key: 'supervisor',    step_order: 1, applies_to: 'CAPEX', amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'IT / PS Review',       role_key: 'it_admin',      step_order: 2, applies_to: 'CAPEX', amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'Budget Owner',         role_key: 'budget_owner',  step_order: 3, applies_to: 'CAPEX', amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'Accountant',           role_key: 'accountant',    step_order: 4, applies_to: 'CAPEX', amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'CFO Approval',         role_key: 'cfo',           step_order: 5, applies_to: 'CAPEX', amount_min: 500000,      amount_max: 99999999, is_active: 1 },
      { label: 'CMD / MD Approval',    role_key: 'cmd',           step_order: 6, applies_to: 'CAPEX', amount_min: 2500000,     amount_max: 99999999, is_active: 1 },
      { label: 'Finance / SAP Entry',  role_key: 'finance',       step_order: 7, applies_to: 'CAPEX', amount_min: 0,           amount_max: 99999999, is_active: 1 },

      // ── OPEX FLOW ───────────────────────────────────────────────────────────
      // Requester → Supervisor → Budget Owner → Accountant → CFO → Finance
      // (No IT/PS step; CMD not required for OPEX)
      { label: 'Supervisor Approval',  role_key: 'supervisor',    step_order: 1, applies_to: 'OPEX',  amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'Budget Owner',         role_key: 'budget_owner',  step_order: 2, applies_to: 'OPEX',  amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'Accountant',           role_key: 'accountant',    step_order: 3, applies_to: 'OPEX',  amount_min: 0,           amount_max: 99999999, is_active: 1 },
      { label: 'CFO Approval',         role_key: 'cfo',           step_order: 4, applies_to: 'OPEX',  amount_min: 300000,      amount_max: 99999999, is_active: 1 },
      { label: 'Finance / SAP Entry',  role_key: 'finance',       step_order: 5, applies_to: 'OPEX',  amount_min: 0,           amount_max: 99999999, is_active: 1 },
    ];

    for (const s of defaults) {
      await db.query(
        `INSERT INTO gcars_workflow_config
          (department, label, role_key, step_order, applies_to, amount_min, amount_max, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [department, s.label, s.role_key, s.step_order, s.applies_to, s.amount_min, s.amount_max, s.is_active]
      );
    }

    res.json({ success: true, message: `Seeded ${defaults.length} default workflow steps for ${department} (CAPEX: 7, OPEX: 5)` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Seed failed: ' + err.message });
  }
});

// GET /api/superadmin/masters - helper for dropdowns
router.get('/masters', async (req, res) => {
  try {
    const [sbus] = await db.query("SELECT id, sbu_name as name FROM capex_master_sbu_master ORDER BY sbu_name ASC");
    const [functions] = await db.query("SELECT id, b_func as name FROM capex_master_broad_function ORDER BY b_func ASC");
    res.json({ success: true, sbus, functions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/employees/search - searchable employee list
router.get('/employees/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (q.length < 2) return res.json({ success: true, data: [] });
    const [rows] = await db.query(
      "SELECT emp_no, name, desg, sbu FROM capex_master_employee WHERE name LIKE ? OR emp_no LIKE ? LIMIT 15",
      [`%${q}%`, `%${q}%`]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────
// BUDGET OWNERS / BROAD FUNCTION HEADS
// ─────────────────────────────────────────────────────

// GET /api/superadmin/budget-owners - list all budget owners with pagination and filters
router.get('/budget-owners', async (req, res) => {
  try {
    const { search = '', sbu_id = '', bfun_id = '', head = '', page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let where = 'WHERE 1=1';
    const params = [];
    
    if (search) {
      where += ' AND (bfh.head LIKE ? OR me.name LIKE ? OR bfh.emp_no LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (sbu_id) { where += ' AND bfh.sbu_id = ?'; params.push(sbu_id); }
    if (bfun_id) { where += ' AND bfh.bfun_id = ?'; params.push(bfun_id); }
    if (head) { where += ' AND bfh.head = ?'; params.push(head); }

    const [rows] = await db.query(`
      SELECT bfh.*, me.name as employee_name, me.sbu as employee_sbu, me.desg
      FROM capex_master_broad_function_head bfh
      LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
      ${where}
      ORDER BY bfh.head ASC
      LIMIT ? OFFSET ?
    `, [...params, Number(limit), offset]);

    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) as total 
      FROM capex_master_broad_function_head bfh
      LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
      ${where}
    `, params);

    res.json({ success: true, data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/budget-owners - create a budget owner mapping
router.post('/budget-owners', async (req, res) => {
  try {
    const { head, emp_no, sbu_id, bfun_id } = req.body;
    const [result] = await db.query(
      "INSERT INTO capex_master_broad_function_head (head, emp_no, sbu_id, bfun_id) VALUES (?, ?, ?, ?)",
      [head, emp_no, sbu_id || null, bfun_id || null]
    );
    res.status(201).json({ success: true, message: 'Budget owner created', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/budget-owners/:id - update
router.put('/budget-owners/:id', async (req, res) => {
  try {
    const { head, emp_no, sbu_id, bfun_id } = req.body;
    await db.query(
      "UPDATE capex_master_broad_function_head SET head=?, emp_no=?, sbu_id=?, bfun_id=?, updated_at=NOW() WHERE id=?",
      [head, emp_no, sbu_id || null, bfun_id || null, req.params.id]
    );
    res.json({ success: true, message: 'Budget owner updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/budget-owners/:id
router.delete('/budget-owners/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM capex_master_broad_function_head WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Budget owner deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ─────────────────────────────────────────────────────
// ROLES & PERMISSIONS
// ─────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════
//  SECTION: ROLES & PERMISSIONS
//  Manage system roles and their permission assignments.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/roles - list all roles with permission counts
router.get('/roles', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.*, COUNT(pr.permission_id) as permission_count
      FROM roles r
      LEFT JOIN permission_role pr ON pr.role_id = r.id
      GROUP BY r.id
      ORDER BY r.display_name ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/permissions - list all available permissions
router.get('/permissions', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM permissions ORDER BY display_name ASC");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/roles/:id/permissions - context for editing a role
router.get('/roles/:id/permissions', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT permission_id FROM permission_role WHERE role_id = ?", [req.params.id]);
    res.json({ success: true, data: rows.map(r => r.permission_id) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/roles/:id/permissions - sync permissions
router.post('/roles/:id/permissions', async (req, res) => {
  try {
    const { permission_ids } = req.body;
    await db.query("DELETE FROM permission_role WHERE role_id = ?", [req.params.id]);
    if (permission_ids && permission_ids.length > 0) {
      const inserts = permission_ids.map(pid => [pid, req.params.id]);
      await db.query("INSERT INTO permission_role (permission_id, role_id) VALUES ?", [inserts]);
    }
    res.json({ success: true, message: 'Permissions updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/roles - create role
router.post('/roles', async (req, res) => {
  try {
    const { name, display_name, description } = req.body;
    const [result] = await db.query(
      "INSERT INTO roles (name, display_name, description, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
      [name, display_name, description]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/roles/:id
router.delete('/roles/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM roles WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});




// ═══════════════════════════════════════════════════════════════
//  SECTION: LOCATIONS
//  CRUD for plant / office location master records.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/locations
router.get('/locations', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_master_location ORDER BY location");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/locations
router.post('/locations', async (req, res) => {
  try {
    const { loc_code, location, plant, plant_name, status = 'Active' } = req.body;
    await db.query(
      "INSERT INTO capex_master_location (loc_code, location, plant, plant_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
      [loc_code, location, plant, plant_name, status]
    );
    res.status(201).json({ success: true, message: 'Location created' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/locations/:id
router.put('/locations/:id', async (req, res) => {
  try {
    const { loc_code, location, plant, plant_name, status } = req.body;
    await db.query(
      "UPDATE capex_master_location SET loc_code=?, location=?, plant=?, plant_name=?, status=?, updated_at=NOW() WHERE id=?",
      [loc_code, location, plant, plant_name, status, req.params.id]
    );
    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/locations/:id
router.delete('/locations/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM capex_master_location WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Location deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: STRATEGIC BUSINESS UNITS (SBUs)
//  CRUD for SBU master records.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/sbus
router.get('/sbus', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, sbu_name as name, status FROM capex_master_sbu_master ORDER BY sbu_name");
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/sbus
router.post('/sbus', async (req, res) => {
  try {
    const { name, status = 'Active' } = req.body;
    await db.query(
      "INSERT INTO capex_master_sbu_master (sbu_name, status, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      [name, status]
    );
    res.status(201).json({ success: true, message: 'SBU created' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/sbus/:id
router.put('/sbus/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    await db.query(
      "UPDATE capex_master_sbu_master SET sbu_name=?, status=?, updated_at=NOW() WHERE id=?",
      [name, status, req.params.id]
    );
    res.json({ success: true, message: 'SBU updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/sbus/:id
router.delete('/sbus/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM capex_master_sbu_master WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'SBU deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: EMPLOYEES
//  CRUD for the capex_master_employee table.
//  PUT also updates the linked users.password when a new
//  password is provided (admin-initiated password reset).
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/employees - paginated employee list with search
router.get('/employees', async (req, res) => {
  try {
    const { search = '', sbu = '', location = '', b_func = '', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? OR emp_no LIKE ? OR email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (sbu) {
      where += ' AND sbu = ?';
      params.push(sbu);
    }
    if (location) {
      where += ' AND location = ?';
      params.push(location);
    }
    if (b_func) {
      where += ' AND b_func = ?';
      params.push(b_func);
    }
    const [rows] = await db.query(
      `SELECT * FROM capex_master_employee ${where} ORDER BY name LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM capex_master_employee ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/employees
router.post('/employees', async (req, res) => {
  try {
    const { 
      emp_no, name, email, sbu, location, desg, rpt_code, rpt_to, 
      b_func, b_func_id, grade, compcode, plant, territory, costcentre, 
      status = 'Active' 
    } = req.body;

    const [existing] = await db.query('SELECT id FROM capex_master_employee WHERE emp_no = ?', [emp_no]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE capex_master_employee SET 
          name = ?, email = ?, sbu = ?, location = ?, desg = ?, rpt_code = ?, rpt_to = ?, 
          b_func = ?, b_func_id = ?, grade = ?, compcode = ?, plant = ?, territory = ?, costcentre = ?, 
          status = ?, updated_at = NOW()
         WHERE emp_no = ?`,
        [
          name, email, sbu, location, desg, rpt_code, rpt_to, 
          b_func, b_func_id, grade, compcode, plant, territory, costcentre, 
          status, emp_no
        ]
      );
      res.status(200).json({ success: true, message: 'Employee updated successfully' });
    } else {
      await db.query(
        `INSERT INTO capex_master_employee (
          emp_no, name, email, sbu, location, desg, rpt_code, rpt_to, 
          b_func, b_func_id, grade, compcode, plant, territory, costcentre, 
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          emp_no, name, email, sbu, location, desg, rpt_code, rpt_to, 
          b_func, b_func_id, grade, compcode, plant, territory, costcentre, 
          status
        ]
      );
      res.status(201).json({ success: true, message: 'Employee created successfully' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/employees/:emp_no
router.put('/employees/:emp_no', async (req, res) => {
  try {
    const { 
      name, email, sbu, location, desg, rpt_code, rpt_to, 
      b_func, grade, compcode, plant, territory, costcentre, 
      status 
    } = req.body;

    let sbu_id = null;
    if (sbu) {
      const [sRows] = await db.query('SELECT id FROM capex_master_sbu_master WHERE sbu_name = ?', [sbu]);
      if (sRows.length) sbu_id = sRows[0].id;
    }

    let location_id = null;
    if (location) {
      const [lRows] = await db.query('SELECT id FROM capex_master_location WHERE location = ?', [location]);
      if (lRows.length) location_id = lRows[0].id;
    }

    let b_func_id = req.body.b_func_id || null;
    if (b_func) {
      const [bRows] = await db.query('SELECT id FROM capex_master_broad_function WHERE b_func = ?', [b_func]);
      if (bRows.length) b_func_id = bRows[0].id;
    }

    await db.query(
      `UPDATE capex_master_employee SET 
        name=?, email=?, sbu=?, sbu_id=?, location=?, location_id=?, desg=?, rpt_code=?, rpt_to=?, 
        b_func=?, b_func_id=?, grade=?, compcode=?, plant=?, territory=?, costcentre=?, 
        status=?, updated_at=NOW() 
       WHERE emp_no=? OR id=?`,
      [
        name, email, sbu, sbu_id, location, location_id, desg, rpt_code, rpt_to, 
        b_func, b_func_id, grade, compcode, plant, territory, costcentre, 
        status, req.params.emp_no, req.params.emp_no
      ]
    );

    // If password provided, update the linked user account
    const { password } = req.body;
    if (password) {
      const [userRows] = await db.query('SELECT id FROM users WHERE emp_no = ?', [req.params.emp_no]);
      if (userRows.length) {
        const hashed = await bcrypt.hash(password, 10);
        // Also update old_password to support legacy plaintext login as requested
        await db.query(
          'UPDATE users SET password = ?, old_password = ?, updated_at = NOW() WHERE emp_no = ?', 
          [hashed, password, req.params.emp_no]
        );
      }
    }

    res.json({ success: true, message: 'Employee updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// DELETE /api/superadmin/employees/:emp_no
router.delete('/employees/:emp_no', async (req, res) => {
  try {
    await db.query("UPDATE capex_master_employee SET status = 'Inactive' WHERE emp_no = ? OR id = ?", [req.params.emp_no, req.params.emp_no]);
    res.json({ success: true, message: 'Employee deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: BROAD FUNCTIONS (write)
//  CRUD for broad-function / department master records.
// ═══════════════════════════════════════════════════════════════

// POST /api/superadmin/broad-functions
router.post('/broad-functions', async (req, res) => {
  try {
    const { name, status = 'Active' } = req.body;
    await db.query(
      "INSERT INTO capex_master_broad_function (b_func, status, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      [name, status]
    );
    res.status(201).json({ success: true, message: 'Broad function created' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/broad-functions/:id
router.put('/broad-functions/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    await db.query(
      "UPDATE capex_master_broad_function SET b_func=?, status=?, updated_at=NOW() WHERE id=?",
      [name, status, req.params.id]
    );
    res.json({ success: true, message: 'Broad function updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/broad-functions/:id
router.delete('/broad-functions/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM capex_master_broad_function WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Broad function deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: ASSET GROUPS (write)
//  CRUD for asset-group master records.
// ═══════════════════════════════════════════════════════════════

// POST /api/superadmin/asset-groups
router.post('/asset-groups', async (req, res) => {
  try {
    const { name, status = 'Active' } = req.body;
    await db.query(
      "INSERT INTO capex_master_asset_group (name, status, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      [name, status]
    );
    res.status(201).json({ success: true, message: 'Asset group created' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/superadmin/asset-groups/:id
router.put('/asset-groups/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    await db.query(
      "UPDATE capex_master_asset_group SET name=?, status=?, updated_at=NOW() WHERE id=?",
      [name, status, req.params.id]
    );
    res.json({ success: true, message: 'Asset group updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/superadmin/asset-groups/:id
router.delete('/asset-groups/:id', async (req, res) => {
  try {
    await db.query("DELETE FROM capex_master_asset_group WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Asset group deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/superadmin/accountants - dedicated management for capex_accountant table
router.get('/accountants', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;
    
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += " AND (ca.employee_no LIKE ? OR me.name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT ca.id, ca.sbu, ca.location_id, ca.employee_no, ca.created_by, ca.status, 
              DATE_FORMAT(ca.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
              DATE_FORMAT(ca.updated_at, '%Y-%m-%d %H:%i:%s') as updated_at,
              me.name as employee_name
       FROM capex_accountant ca
       LEFT JOIN capex_master_employee me ON me.emp_no = ca.employee_no
       ${where}
       ORDER BY ca.id ASC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );

    // RESOLVE NAMES FOR SBU AND LOCATION
    const [allSbus] = await db.query("SELECT id, sbu_name FROM capex_master_sbu_master");
    const [allLocs] = await db.query("SELECT id, location FROM capex_master_location");
    
    const sbuMap = allSbus.reduce((acc, s) => ({ ...acc, [s.id]: s.sbu_name }), {});
    const locMap = allLocs.reduce((acc, l) => ({ ...acc, [l.id]: l.location }), {});

    const resolvedRows = rows.map(row => {
      const sbuNames = row.sbu === 'All' ? 'All' : (row.sbu || '').split(',').map(id => sbuMap[id] || id).join(', ');
      const locNames = row.location_id === 'All' ? 'All' : (row.location_id || '').split(',').map(id => locMap[id] || id).join(', ');
      
      return {
        ...row,
        sbu_display: sbuNames,
        location_display: locNames
      };
    });
    
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM capex_accountant ca LEFT JOIN capex_master_employee me ON me.emp_no = ca.employee_no ${where}`, params);
    
    res.json({ success: true, data: resolvedRows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/superadmin/accountants
router.post('/accountants', async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const { sbu_id, loc_id, emp_no, status = 'Active' } = req.body;
    
    // Save to capex_accountant
    const [result] = await connection.query(
      'INSERT INTO capex_accountant (sbu, location_id, employee_no, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [sbu_id, loc_id, emp_no, status]
    );

    // Auto-assign Role 26 (Accountant) in role_user
    const [users] = await connection.query("SELECT id FROM users WHERE emp_no = ?", [emp_no]);
    if (users.length > 0) {
      await connection.query(
        "INSERT IGNORE INTO role_user (user_id, role_id) VALUES (?, 26)",
        [users[0].id]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'Accountant created and role assigned', id: result.insertId });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { connection.release(); }
});

// PUT /api/superadmin/accountants/:id
router.put('/accountants/:id', async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const { sbu_id, loc_id, emp_no, status } = req.body;
    
    // ARCHIVE TO HISTORY
    await connection.query(`
      INSERT INTO capex_accountant_history (accountant_id, sbu, location_id, employee_no, status, archived_at)
      SELECT id, sbu, location_id, employee_no, status, NOW()
      FROM capex_accountant WHERE id = ?
    `, [req.params.id]).catch(e => console.log('History table capex_accountant_history missing.'));

    await connection.query(
      'UPDATE capex_accountant SET sbu=?, location_id=?, employee_no=?, status=?, updated_at=NOW() WHERE id=?',
      [sbu_id, loc_id, emp_no, status, req.params.id]
    );

    await connection.commit();
    res.json({ success: true, message: 'Accountant updated and archived' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { connection.release(); }
});


// ═══════════════════════════════════════════════════════════════
//  SECTION: SINGLE-RECORD LOOKUPS
//  GET endpoints that return one record by primary key.
//  Used by form pre-population when editing master data.
// ═══════════════════════════════════════════════════════════════

// GET /api/superadmin/employees/:emp_no
router.get('/employees/:emp_no', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_employee WHERE emp_no = ? OR id = ?', [req.params.emp_no, req.params.emp_no]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/locations/:id
router.get('/locations/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_location WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/sbus/:id
router.get('/sbus/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_sbu_master WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/broad-functions/:id
router.get('/broad-functions/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_broad_function WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/asset-groups/:id
router.get('/asset-groups/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_asset_group WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/asset-types/:id
router.get('/asset-types/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_asset_type WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/accountants/:id
router.get('/accountants/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_accountant WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/broad-function-heads/:id
router.get('/broad-function-heads/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_broad_function_head WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/superadmin/budget-owners/:id
router.get('/budget-owners/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capex_master_broad_function_head WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

module.exports = router;
