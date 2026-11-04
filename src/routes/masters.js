/**
 * ============================================================
 *  G-CARS 2 — Master Data Routes (Read / Write)
 * ============================================================
 *  Serves reference / lookup data consumed by the frontend
 *  form dropdowns, autocomplete fields, and budget checks.
 *
 *  Routes:
 *    GET  /api/masters/asset-groups           – All active asset groups
 *    GET  /api/masters/asset-types            – Asset types, optionally by group
 *    GET  /api/masters/budget-types           – CAPEX / OPEX budget types
 *    GET  /api/masters/locations              – Office / plant locations
 *    GET  /api/masters/sbu                    – Strategic Business Units
 *    GET  /api/masters/broad-functions        – Broad functional departments
 *    GET  /api/masters/employees              – Employee directory (searchable)
 *    GET  /api/masters/employees/:emp_no      – Single employee by code
 *    GET  /api/masters/allocations            – Budget allocations scoped to caller
 *    GET  /api/masters/check-budget           – Check if an amount fits in budget
 *    GET  /api/masters/quarterly-budgets      – Quarterly budget entries
 *    POST /api/masters/quarterly-budgets      – Upsert a quarterly budget entry
 *    GET  /api/masters/quarterly-budget-ratios – Per-allocation quarterly limits
 *
 *  Access: All routes require a valid JWT (authMiddleware).
 * ============================================================
 */

const express = require('express');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router  = express.Router();

// Apply JWT authentication to every route in this file
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/asset-groups
// ─────────────────────────────────────────────────────────────
/**
 * Returns all active asset groups ordered alphabetically.
 * Used to populate the "Asset Group" dropdown on request forms.
 *
 * @route  GET /api/masters/asset-groups
 * @access Private
 * @returns { success, data: AssetGroup[] }
 */
router.get('/asset-groups', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM capex_master_asset_group WHERE status = 'Active' ORDER BY name"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/asset-types
// ─────────────────────────────────────────────────────────────
/**
 * Returns active asset types, optionally filtered by group_id.
 * Includes the parent group name for display purposes.
 *
 * @route  GET /api/masters/asset-types
 * @access Private
 * @query  { group_id?: number }
 * @returns { success, data: AssetType[] }
 */
router.get('/asset-types', async (req, res) => {
  try {
    const { group_id } = req.query;

    let q = `SELECT at2.*, ag.name as group_name
             FROM capex_master_asset_type at2
             LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group
             WHERE at2.status = 'Active'`;
    const params = [];

    // Filter by parent group when provided
    if (group_id) {
      q += ' AND at2.asset_group = ?';
      params.push(group_id);
    }

    q += ' ORDER BY at2.asset_name';
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/budget-types
// ─────────────────────────────────────────────────────────────
/**
 * Returns active budget type options (e.g. CAPEX, OPEX).
 *
 * @route  GET /api/masters/budget-types
 * @access Private
 * @returns { success, data: BudgetType[] }
 */
router.get('/budget-types', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM capex_budget_type WHERE status = 'Active' ORDER BY budget_type"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/locations
// ─────────────────────────────────────────────────────────────
/**
 * Returns all active locations ordered by name.
 *
 * @route  GET /api/masters/locations
 * @access Private
 * @returns { success, data: Location[] }
 */
router.get('/locations', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM capex_master_location WHERE status = 'Active' ORDER BY location"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/sbu
// ─────────────────────────────────────────────────────────────
/**
 * Returns all active Strategic Business Units ordered by name.
 *
 * @route  GET /api/masters/sbu
 * @access Private
 * @returns { success, data: SBU[] }
 */
router.get('/sbu', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM capex_master_sbu_master WHERE status = 'Active' ORDER BY sbu_name"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/broad-functions
// ─────────────────────────────────────────────────────────────
/**
 * Returns all active broad functional departments.
 *
 * @route  GET /api/masters/broad-functions
 * @access Private
 * @returns { success, data: BroadFunction[] }
 */
router.get('/broad-functions', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM capex_master_broad_function WHERE status = 'Active' ORDER BY b_func"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/employees
// ─────────────────────────────────────────────────────────────
/**
 * Returns a searchable, paginated list of active employees.
 * Used for autocomplete / people-picker components.
 *
 * @route  GET /api/masters/employees
 * @access Private
 * @query  { search?: string, sbu?: string, limit?: number }
 * @returns { success, data: Employee[] }
 */
router.get('/employees', async (req, res) => {
  try {
    const { search = '', sbu, limit = 50 } = req.query;

    let q = `SELECT emp_no, name, grade, desg, sbu, b_func, location, email
             FROM capex_master_employee WHERE status = 'Active'`;
    const params = [];

    if (search) {
      q += ' AND (name LIKE ? OR emp_no LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (sbu) {
      q += ' AND sbu = ?';
      params.push(sbu);
    }

    q += ' ORDER BY name LIMIT ?';
    params.push(Number(limit));

    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/employees/:emp_no
// ─────────────────────────────────────────────────────────────
/**
 * Returns a single employee record by employee number.
 *
 * @route  GET /api/masters/employees/:emp_no
 * @access Private
 * @param  emp_no – Employee code (e.g. "E001")
 * @returns { success, data: Employee }
 */
router.get('/employees/:emp_no', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM capex_master_employee WHERE emp_no = ? LIMIT 1',
      [req.params.emp_no]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/allocations
// ─────────────────────────────────────────────────────────────
/**
 * Returns budget allocations scoped to the requesting user.
 *
 * Scoping rules:
 *  - Non-admin: allocations matching the user's SBU, Broad Function,
 *    and Location (NULL entity dimensions act as wildcards / global).
 *  - Admin requesting for a target SBU/Location (Bulk Request flow):
 *    allocations matching the provided target dimensions.
 *
 * @route  GET /api/masters/allocations
 * @access Private
 * @query  { budget_entity?, asset_type?, year?, budget_type?,
 *           target_sbu?, target_location? }
 * @returns { success, data: Allocation[] }
 */
router.get('/allocations', async (req, res) => {
  try {
    const {
      budget_entity, asset_type, year, budget_type,
      target_sbu, target_location,
    } = req.query;

    const ADMIN_ROLES = ['admin', 'superadmin', 'super_admin'];
    const isAdmin = ADMIN_ROLES.includes(req.user.user_type) ||
                    req.user.roles?.some(r => ADMIN_ROLES.includes(r));

    let q = `SELECT ca.*, be.entity_name, ag.name as asset_group_name,
                    at2.asset_name, bt.budget_type as budget_type_name
             FROM capex_allocation ca
             LEFT JOIN capex_budget_entity be      ON be.id  = ca.budget_entity
             LEFT JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
             LEFT JOIN capex_master_asset_group ag  ON ag.id  = ca.asset_group
             LEFT JOIN capex_budget_type bt         ON bt.id  = ca.budget_type
             WHERE ca.status = 'Active'`;
    const params = [];

    // Optional hard filters
    if (budget_entity) { q += ' AND ca.budget_entity = ?'; params.push(budget_entity); }
    if (asset_type)    { q += ' AND ca.asset_type = ?';    params.push(asset_type); }
    if (year)          { q += ' AND ca.year = ?';          params.push(year); }
    if (budget_type)   { q += ' AND ca.budget_type = ?';   params.push(budget_type); }

    if (isAdmin && (target_sbu || target_location)) {
      // Admin bulk-request: resolve SBU and Location names to IDs for accurate filtering
      const [sbuRows] = await db.query('SELECT id FROM capex_master_sbu_master WHERE sbu_name = ? LIMIT 1', [target_sbu]);
      const [locRows] = await db.query('SELECT id FROM capex_master_location WHERE location = ? LIMIT 1', [target_location]);

      const sbuId = sbuRows.length ? sbuRows[0].id : null;
      const locId = locRows.length ? locRows[0].id : null;

      // NULL on the entity dimension = global (applies to everyone)
      q += ' AND (be.sbu_id = ? OR be.sbu_id IS NULL) AND (be.loc_id = ? OR be.loc_id IS NULL)';
      params.push(sbuId, locId);
    } else {
      // Standard requester flow: scope to the user's own SBU / BFunction / Location
      const [empRows] = await db.query(
        'SELECT sbu_id, b_func_id, location_id FROM capex_master_employee WHERE emp_no = ? LIMIT 1',
        [req.user.emp_no]
      );
      if (empRows.length > 0) {
        const { sbu_id, b_func_id, location_id } = empRows[0];
        // NULL entity dimension = global allocation — always visible
        q += ` AND (be.sbu_id = ? OR be.sbu_id IS NULL)
               AND (be.b_fun_id = ? OR be.b_fun_id IS NULL)
               AND (be.loc_id = ? OR be.loc_id IS NULL)`;
        params.push(sbu_id, b_func_id, location_id);
      }
    }

    q += ' ORDER BY ca.created_at DESC';
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Allocation fetch error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/check-budget
// ─────────────────────────────────────────────────────────────
/**
 * Checks whether a requested amount fits within the available
 * budget for a given allocation, taking quarterly limits into account.
 *
 * Logic:
 *  1. Compute base available = budgeted - committed - consumed
 *  2. If quarterly overflow is disabled for the current quarter,
 *     additionally constrain by the cumulative quarterly limit
 *     (proportional ratio of this allocation within its category).
 *
 * @route  GET /api/masters/check-budget
 * @access Private
 * @query  { allocation_id: number, amount?: number }
 * @returns { success, available: number, isOver: boolean, message: string }
 */
router.get('/check-budget', async (req, res) => {
  try {
    const { allocation_id, amount } = req.query;
    if (!allocation_id) {
      return res.status(400).json({ success: false, message: 'allocation_id required' });
    }

    // Fetch allocation with its asset details
    const [allocRows] = await db.query(
      `SELECT ca.*, at2.asset_group, at2.asset_name
       FROM capex_allocation ca
       LEFT JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
       WHERE ca.id = ?`,
      [allocation_id]
    );
    if (!allocRows.length) {
      return res.status(404).json({ success: false, message: 'Allocation not found' });
    }

    const allocation = allocRows[0];
    const { budgeted_amount, committed_amount, budget_amount_consumed } = allocation;

    // Step 1: Base available balance
    let available = Number(budgeted_amount) - Number(committed_amount) - Number(budget_amount_consumed);

    // Step 2: Determine asset category and current quarter
    const currentYear = new Date().getFullYear();
    const qMonth      = new Date().getMonth();   // 0–11
    const currentQ    = `Q${Math.floor(qMonth / 3) + 1}`; // Q1–Q4

    // IT assets: asset_group = 1 and name does NOT contain "tool"
    const isIT         = allocation.asset_group === 1 &&
                         !(allocation.asset_name || '').toLowerCase().includes('tool');
    const category     = isIT ? 'IT' : 'Tools';
    const assetCondition = category === 'IT'
      ? 'at2.asset_group = 1 AND LOWER(at2.asset_name) NOT LIKE "%tool%"'
      : 'LOWER(at2.asset_name) LIKE "%tool%"';

    // Step 3: Check if quarterly overflow is disabled for this category
    const [qbRows] = await db.query(
      'SELECT allow_overflow FROM capex_quarterly_budget WHERE year = ? AND quarter = ? AND category = ?',
      [currentYear, currentQ, category]
    );
    const allowOverflow = qbRows.length > 0 ? (qbRows[0].allow_overflow === 1) : true;

    if (!allowOverflow) {
      // Cumulative quarterly budget up to and including the current quarter
      const [sumQbRows] = await db.query(
        'SELECT SUM(amount) as total_q FROM capex_quarterly_budget WHERE year = ? AND category = ? AND quarter <= ?',
        [currentYear, category, currentQ]
      );
      const cumulativeGlobalAmount = sumQbRows[0]?.total_q || 0;

      if (category === 'IT') {
        // For IT: compare against total consumed across all IT allocations this year
        const [itConsRows] = await db.query(
          `SELECT SUM(ca.committed_amount + ca.budget_amount_consumed) as total_consumed
           FROM capex_allocation ca
           JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
           WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})`,
          [currentYear]
        );
        const totalITConsumed = itConsRows[0]?.total_consumed || 0;
        const qAvailable      = cumulativeGlobalAmount - totalITConsumed;

        if (qAvailable < available) available = qAvailable;
      } else {
        // For Tools: each allocation gets a proportional share of the quarterly budget
        const [totalRows] = await db.query(
          `SELECT SUM(ca.budgeted_amount) as total_allocated
           FROM capex_allocation ca
           JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
           WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})`,
          [currentYear]
        );
        const totalAllocated = totalRows[0]?.total_allocated || 0;

        if (totalAllocated > 0) {
          const ratio          = Number(budgeted_amount) / Number(totalAllocated);
          const cumulativeLimit = ratio * cumulativeGlobalAmount;
          const qAvailable     = cumulativeLimit - Number(committed_amount) - Number(budget_amount_consumed);
          if (qAvailable < available) available = qAvailable;
        }
      }
    }

    const isOver = Number(amount || 0) > available;

    res.json({
      success:  true,
      available,
      isOver,
      message: isOver ? 'Request amount exceeds available budget!' : 'Budget available',
    });
  } catch (err) {
    console.error('Check budget error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/quarterly-budgets
// ─────────────────────────────────────────────────────────────
/**
 * Returns quarterly budget entries, optionally filtered by
 * fiscal year and/or category (IT | Tools).
 *
 * @route  GET /api/masters/quarterly-budgets
 * @access Private
 * @query  { year?: number, category?: string }
 * @returns { success, data: QuarterlyBudget[] }
 */
router.get('/quarterly-budgets', async (req, res) => {
  try {
    const { year, category } = req.query;

    let q      = 'SELECT * FROM capex_quarterly_budget';
    const params = [];

    if (year) {
      q += ' WHERE year = ?';
      params.push(year);
      if (category) {
        q += ' AND category = ?';
        params.push(category);
      }
    }

    q += ' ORDER BY year DESC, category ASC, quarter ASC';
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/masters/quarterly-budgets
// ─────────────────────────────────────────────────────────────
/**
 * Creates or updates a quarterly budget entry (upsert).
 * Duplicate key on (year, quarter, category) updates amount and overflow flag.
 *
 * @route  POST /api/masters/quarterly-budgets
 * @access Private
 * @body   { year, quarter, category, amount, allow_overflow }
 * @returns { success, message }
 */
router.post('/quarterly-budgets', async (req, res) => {
  try {
    const { year, quarter, category, amount, allow_overflow } = req.body;

    await db.query(
      `INSERT INTO capex_quarterly_budget (year, quarter, category, amount, allow_overflow)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), allow_overflow = VALUES(allow_overflow)`,
      [year, quarter, category, amount, allow_overflow ? 1 : 0]
    );

    res.json({ success: true, message: 'Saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/masters/quarterly-budget-ratios
// ─────────────────────────────────────────────────────────────
/**
 * Calculates per-allocation quarterly spending limits based on
 * each allocation's proportional share of the category's total budget.
 *
 * Steps:
 *  1. Fetch total quarterly budget for the category/year.
 *  2. Fetch all allocations in the category, with their budgeted amounts.
 *  3. Compute ratio = allocation.budgeted / category_total.
 *  4. quarterly_limit = ratio × quarterly_global_amount.
 *
 * @route  GET /api/masters/quarterly-budget-ratios
 * @access Private
 * @query  { year?, quarter?, category: string (required) }
 * @returns { success, totalAllocated, globalAmount, data: AllocationRatio[] }
 */
router.get('/quarterly-budget-ratios', async (req, res) => {
  try {
    const { year = new Date().getFullYear(), quarter, category } = req.query;
    if (!category) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }

    // Step 1: Fetch global quarterly amount for the category
    let globalAmount = 0;
    if (quarter) {
      const [qb] = await db.query(
        'SELECT amount FROM capex_quarterly_budget WHERE year = ? AND quarter = ? AND category = ?',
        [year, quarter, category]
      );
      globalAmount = qb.length ? qb[0].amount : 0;
    } else {
      // No specific quarter — use sum of all quarters (annual view)
      const [qb] = await db.query(
        'SELECT SUM(amount) as amount FROM capex_quarterly_budget WHERE year = ? AND category = ?',
        [year, category]
      );
      globalAmount = qb.length ? qb[0].amount : 0;
    }

    // Build the SQL condition that identifies assets in this category
    let assetCondition = '';
    if (category === 'IT') {
      assetCondition = 'at2.asset_group = 1 AND LOWER(at2.asset_name) NOT LIKE "%tool%"';
    } else {
      assetCondition = 'LOWER(at2.asset_name) LIKE "%tool%"';
    }

    // Step 2: Total allocated to the category this year
    const [totalRows] = await db.query(
      `SELECT SUM(ca.budgeted_amount) as total_allocated
       FROM capex_allocation ca
       JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
       WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})`,
      [year]
    );
    const totalAllocated = totalRows[0].total_allocated || 0;

    // Step 3: List all allocations for ratio calculation
    const [allocs] = await db.query(
      `SELECT ca.id, ca.asset_type, at2.asset_name, ca.budgeted_amount, be.entity_name
       FROM capex_allocation ca
       JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
       JOIN capex_budget_entity be     ON be.id  = ca.budget_entity
       WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})`,
      [year]
    );

    // Step 4: Compute ratio and quarterly limit per allocation
    const data = allocs.map(al => {
      const ratio           = totalAllocated > 0
        ? (Number(al.budgeted_amount) / Number(totalAllocated))
        : 0;
      const quarterly_limit = ratio * Number(globalAmount);
      return { ...al, ratio, quarterly_limit };
    });

    res.json({ success: true, totalAllocated, globalAmount, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
