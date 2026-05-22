const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);

// GET /api/masters/asset-groups
router.get('/asset-groups', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_master_asset_group WHERE status = 'Active' ORDER BY name");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/asset-types
router.get('/asset-types', async (req, res) => {
  try {
    const { group_id } = req.query;
    let q = "SELECT at2.*, ag.name as group_name FROM capex_master_asset_type at2 LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group WHERE at2.status = 'Active'";
    const params = [];
    if (group_id) { q += ' AND at2.asset_group = ?'; params.push(group_id); }
    q += ' ORDER BY at2.asset_name';
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/budget-types
router.get('/budget-types', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_budget_type WHERE status = 'Active' ORDER BY budget_type");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/locations
router.get('/locations', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_master_location WHERE status = 'Active' ORDER BY location");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/sbu
router.get('/sbu', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_master_sbu_master WHERE status = 'Active' ORDER BY sbu_name");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/broad-functions
router.get('/broad-functions', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM capex_master_broad_function WHERE status = 'Active' ORDER BY b_func");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/employees
router.get('/employees', async (req, res) => {
  try {
    const { search = '', sbu, limit = 50 } = req.query;
    let q = "SELECT emp_no, name, grade, desg, sbu, b_func, location, email FROM capex_master_employee WHERE status = 'Active'";
    const params = [];
    if (search) { q += ' AND (name LIKE ? OR emp_no LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (sbu) { q += ' AND sbu = ?'; params.push(sbu); }
    q += ' ORDER BY name LIMIT ?';
    params.push(Number(limit));
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/employees/:emp_no
router.get('/employees/:emp_no', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM capex_master_employee WHERE emp_no = ? LIMIT 1',
      [req.params.emp_no]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

    // GET /api/masters/allocations - budget allocations
    router.get('/allocations', async (req, res) => {
      try {
        const { budget_entity, asset_type, year, budget_type, target_sbu, target_location } = req.query;
        const isAdmin = ['admin', 'superadmin'].includes(req.user.user_type) || req.user.roles?.some(r => ['admin', 'superadmin'].includes(r));
    
        let q = `SELECT ca.*, be.entity_name, ag.name as asset_group_name, at2.asset_name, bt.budget_type as budget_type_name
                 FROM capex_allocation ca
                 LEFT JOIN capex_budget_entity be ON be.id = ca.budget_entity
                 LEFT JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
                 LEFT JOIN capex_master_asset_group ag ON ag.id = ca.asset_group
                 LEFT JOIN capex_budget_type bt ON bt.id = ca.budget_type
                 WHERE ca.status = 'Active'`;
        const params = [];
    
        if (budget_entity) { q += ' AND ca.budget_entity = ?'; params.push(budget_entity); }
        if (asset_type) { q += ' AND ca.asset_type = ?'; params.push(asset_type); }
        if (year) { q += ' AND ca.year = ?'; params.push(year); }
        if (budget_type) { q += ' AND ca.budget_type = ?'; params.push(budget_type); }
    
        // If it's an admin requesting for a specific target SBU/Location (e.g. Bulk Request)
        if (isAdmin && (target_sbu || target_location)) {
           // We need to look up the SBU and Location IDs
           // For simplicity, we just filter by the text names if provided, but since entities use IDs,
           // we should look up the IDs first.
           const [sbuRows] = await db.query('SELECT id FROM capex_master_sbu_master WHERE sbu_name = ? LIMIT 1', [target_sbu]);
           const [locRows] = await db.query('SELECT id FROM capex_master_location WHERE location = ? LIMIT 1', [target_location]);
           
           const sbuId = sbuRows.length ? sbuRows[0].id : null;
           const locId = locRows.length ? locRows[0].id : null;

           q += ' AND (be.sbu_id = ? OR be.sbu_id IS NULL) AND (be.loc_id = ? OR be.loc_id IS NULL)';
           params.push(sbuId, locId);
        } else {
          // Filter by requester's SBU and Broad Function (Always apply for NewRequest)
          const [empRows] = await db.query(
            'SELECT sbu_id, b_func_id, location_id FROM capex_master_employee WHERE emp_no = ? LIMIT 1',
            [req.user.emp_no]
          );
          if (empRows.length > 0) {
            const { sbu_id, b_func_id, location_id } = empRows[0];
            // Rules: If entity has SBU/Function/Location, it must match. If it's NULL, it's considered global.
            q += ' AND (be.sbu_id = ? OR be.sbu_id IS NULL) AND (be.b_fun_id = ? OR be.b_fun_id IS NULL) AND (be.loc_id = ? OR be.loc_id IS NULL)';
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

// GET /api/masters/check-budget
router.get('/check-budget', async (req, res) => {
  try {
    const { allocation_id, amount } = req.query;
    if (!allocation_id) return res.status(400).json({ success: false, message: 'allocation_id required' });

    const [allocRows] = await db.query(
      `SELECT ca.*, at2.asset_group, at2.asset_name
       FROM capex_allocation ca
       LEFT JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
       WHERE ca.id = ?`,
      [allocation_id]
    );

    if (!allocRows.length) return res.status(404).json({ success: false, message: 'Allocation not found' });

    const allocation = allocRows[0];
    const { budgeted_amount, committed_amount, budget_amount_consumed } = allocation;
    let available = Number(budgeted_amount) - Number(committed_amount) - Number(budget_amount_consumed);

    // Calculate quarterly limits
    const currentYear = new Date().getFullYear();
    const qMonth = new Date().getMonth(); // 0 to 11
    const currentQ = `Q${Math.floor(qMonth / 3) + 1}`;
    
    const isIT = allocation.asset_group === 1 && !(allocation.asset_name || '').toLowerCase().includes('tool');
    const category = isIT ? 'IT' : 'Tools';
    const assetCondition = category === 'IT' ? 'at2.asset_group = 1 AND LOWER(at2.asset_name) NOT LIKE "%tool%"' : 'LOWER(at2.asset_name) LIKE "%tool%"';

    const [qbRows] = await db.query('SELECT allow_overflow FROM capex_quarterly_budget WHERE year = ? AND quarter = ? AND category = ?', [currentYear, currentQ, category]);
    const allowOverflow = qbRows.length > 0 ? (qbRows[0].allow_overflow === 1) : true;

    if (!allowOverflow) {
      const [sumQbRows] = await db.query('SELECT SUM(amount) as total_q FROM capex_quarterly_budget WHERE year = ? AND category = ? AND quarter <= ?', [currentYear, category, currentQ]);
      const cumulativeGlobalAmount = sumQbRows[0]?.total_q || 0;

      if (category === 'IT') {
        const [itConsRows] = await db.query(`
          SELECT SUM(ca.committed_amount + ca.budget_amount_consumed) as total_consumed
          FROM capex_allocation ca
          JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
          WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})
        `, [currentYear]);
        const totalITConsumed = itConsRows[0]?.total_consumed || 0;
        
        const qAvailable = cumulativeGlobalAmount - totalITConsumed;
        if (qAvailable < available) {
          available = qAvailable;
        }
      } else {
        const [totalRows] = await db.query(`
          SELECT SUM(ca.budgeted_amount) as total_allocated
          FROM capex_allocation ca
          JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
          WHERE ca.year = ? AND ca.status = 'Active' AND (${assetCondition})
        `, [currentYear]);
        
        const totalAllocated = totalRows[0]?.total_allocated || 0;
        if (totalAllocated > 0) {
          const ratio = Number(budgeted_amount) / Number(totalAllocated);
          const cumulativeLimit = ratio * cumulativeGlobalAmount;
          const qAvailable = cumulativeLimit - Number(committed_amount) - Number(budget_amount_consumed);
          
          if (qAvailable < available) {
            available = qAvailable;
          }
        }
      }
    }

    const isOver = Number(amount || 0) > available;

    res.json({
      success: true,
      available,
      isOver,
      message: isOver ? 'Request amount exceeds available budget!' : 'Budget available'
    });
  } catch (err) {
    console.error('Check budget error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/masters/quarterly-budgets
router.get('/quarterly-budgets', async (req, res) => {
  try {
    const { year, category } = req.query;
    let q = 'SELECT * FROM capex_quarterly_budget';
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
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// POST /api/masters/quarterly-budgets
router.post('/quarterly-budgets', async (req, res) => {
  try {
    const { year, quarter, category, amount, allow_overflow } = req.body;
    await db.query(
      `INSERT INTO capex_quarterly_budget (year, quarter, category, amount, allow_overflow) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), allow_overflow = VALUES(allow_overflow)`,
      [year, quarter, category, amount, allow_overflow ? 1 : 0]
    );
    res.json({ success: true, message: 'Saved successfully' });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// GET /api/masters/quarterly-budget-ratios
router.get('/quarterly-budget-ratios', async (req, res) => {
  try {
    const { year = new Date().getFullYear(), quarter, category } = req.query;
    if (!category) return res.status(400).json({ success: false, message: 'Category is required' });
    
    // 1. Get the total quarterly budget
    let globalAmount = 0;
    if (quarter) {
      const [qb] = await db.query('SELECT amount FROM capex_quarterly_budget WHERE year = ? AND quarter = ? AND category = ?', [year, quarter, category]);
      globalAmount = qb.length ? qb[0].amount : 0;
    } else {
      const [qb] = await db.query('SELECT SUM(amount) as amount FROM capex_quarterly_budget WHERE year = ? AND category = ?', [year, category]);
      globalAmount = qb.length ? qb[0].amount : 0;
    }

    // Determine category condition
    let assetCondition = '';
    if (category === 'IT') {
       assetCondition = 'at2.asset_group = 1 AND LOWER(at2.asset_name) NOT LIKE "%tool%"';
    } else {
       assetCondition = 'LOWER(at2.asset_name) LIKE "%tool%"';
    }

    // 2. Find total allocated to this category for the year
    const [totalRows] = await db.query(`
      SELECT SUM(ca.budgeted_amount) as total_allocated
      FROM capex_allocation ca
      JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
      WHERE ca.year = ? AND ca.status = 'Active'
      AND (${assetCondition})
    `, [year]);
    const totalAllocated = totalRows[0].total_allocated || 0;

    // 3. List all allocations for this category
    const [allocs] = await db.query(`
      SELECT ca.id, ca.asset_type, at2.asset_name, ca.budgeted_amount, be.entity_name
      FROM capex_allocation ca
      JOIN capex_master_asset_type at2 ON at2.id = ca.asset_type
      JOIN capex_budget_entity be ON be.id = ca.budget_entity
      WHERE ca.year = ? AND ca.status = 'Active'
      AND (${assetCondition})
    `, [year]);

    // 4. Calculate ratio and limit
    const data = allocs.map(al => {
      const ratio = totalAllocated > 0 ? (Number(al.budgeted_amount) / Number(totalAllocated)) : 0;
      const quarterly_limit = ratio * Number(globalAmount);
      return {
        ...al,
        ratio,
        quarterly_limit
      };
    });

    res.json({ success: true, totalAllocated, globalAmount, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
