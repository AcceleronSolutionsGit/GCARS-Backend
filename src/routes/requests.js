const express = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { generateSAPAssetPacket } = require('../services/sapService');
const mailService = require('../services/mailService');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

router.use(authMiddleware);

async function getWorkflowChain(sbu, requestType, amount, userId) {
  let flowId = null;

  // 1. Check if user has a set default flow strategy
  if (userId) {
    const [uRows] = await db.query("SELECT default_flow_id FROM users WHERE id = ?", [userId]);
    const user = uRows[0];
    if (user && user.default_flow_id) {
       flowId = user.default_flow_id;
    }
  }

  // 2. Fallback to attribute-based selection if no user default is set
  if (!flowId) {
    const [flows] = await db.query(
      `SELECT id FROM gcars_workflows 
       WHERE (request_type = ? OR request_type = 'BOTH') 
         AND ? >= min_amount AND ? <= max_amount 
         AND is_active = 1 
       ORDER BY is_default ASC, min_amount DESC LIMIT 1`,
      [requestType, amount, amount]
    );
    flowId = flows.length > 0 ? flows[0].id : 1;
  }

  // 3. Fetch steps for the selected flow
  let [steps] = await db.query(
    "SELECT * FROM gcars_workflow_config WHERE flow_id = ? AND department = ? AND applies_to IN ('BOTH', ?) AND is_active = 1 ORDER BY step_order ASC",
    [flowId || 1, sbu || 'All', requestType || 'CAPEX']
  );
  if (!steps.length) {
    [steps] = await db.query(
      "SELECT * FROM gcars_workflow_config WHERE flow_id = ? AND department = 'All' AND applies_to IN ('BOTH', ?) AND is_active = 1 ORDER BY step_order ASC",
      [flowId || 1, requestType || 'CAPEX']
    );
  }
  return steps.filter(s => Number(amount) >= Number(s.amount_min) && Number(amount) <= Number(s.amount_max));
}

/**
 * Implements the CARS Workflow routing logic:
 * Level 1: Supervisor
 * Level 2: Budget Owner (Logic-based)
 * Level 3: CFO/CMD
 */
async function determineSpecificApprover(requestId, roleKey) {
  const [reqs] = await db.query(`
    SELECT cr.*, 
           COALESCE(cr.target_sbu, me.sbu, 'All') as requester_sbu, 
           COALESCE(me.b_func, 'All') as requester_bfun, 
           me.b_func_id as requester_bfun_id, 
           me.sbu_id,
           COALESCE(me.rpt_code, NULL) as supervisor, 
           at.asset_group as group_id, ag.name as group_name
    FROM capex_request cr
    LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
    LEFT JOIN capex_master_asset_type at ON at.id = cr.asset_type
    LEFT JOIN capex_master_asset_group ag ON ag.id = at.asset_group
    WHERE cr.id = ?
  `, [requestId]);

  if (!reqs.length) return null;
  const request = reqs[0];

  if (roleKey === 'supervisor') {
    if (request.requester_bfun && request.requester_bfun.toLowerCase().includes('product support')) {
       const [psRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) LIKE '%product support head%' OR LOWER(head) = 'ps_admin' LIMIT 1");
       if (psRows.length > 0) return psRows[0].emp_no;
    }
    return request.supervisor;
  }

  if (roleKey === 'leadership_review') {
     const requesterSbu = request.sbu || request.requester_sbu || '';
     if (requesterSbu.toUpperCase().includes('MINING')) {
        const [mRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) LIKE '%business head%' OR LOWER(head) LIKE '%mining head%' LIMIT 1");
        return mRows[0]?.emp_no;
     } else {
        const [cRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) = 'ceo' LIMIT 1");
        return cRows[0]?.emp_no;
     }
  }

  if (roleKey === 'budget_owner') {
    const assetName = (request.asset_name || '').toLowerCase();
    
    // a. Check Workflow Matrix for explicit overrides based on Asset and SBU
    const [matrixMatch] = await db.query(`
      SELECT bfh.emp_no
      FROM capex_budget_determination_matrix m
      JOIN capex_budget_determination_matrix_combination c ON c.budget_matrix_id = m.id
      JOIN capex_master_broad_function_head bfh ON bfh.id = c.broad_function_head
      WHERE (m.asset_type = ? OR m.asset_group = ?)
        AND (c.sbu = ? OR c.sbu = 'All')
        AND (c.b_fun = ? OR c.b_fun = 'All')
      LIMIT 1
    `, [request.asset_type || 0, request.group_id || 0, request.requester_sbu || 'All', request.requester_bfun || 'All']);

    if (matrixMatch && matrixMatch.length > 0) {
      return matrixMatch[0].emp_no;
    }

    // b. Predefined Logic Overrides (Prompts rules)
    if (assetName.includes('goodwill') || assetName.includes('brand')) {
       const [cRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) = 'cfo' LIMIT 1");
       return cRows[0]?.emp_no;
    }
    if (assetName.includes('land') || assetName.includes('building')) {
       const [sbuRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE (LOWER(head) LIKE '%sbu head%' OR LOWER(head) = 'budget_owner') AND (sbu_id = ? OR FIND_IN_SET(?, sbu_id)) LIMIT 1", [request.sbu_id, request.sbu_id]);
       if (sbuRows.length > 0) return sbuRows[0].emp_no;
    }

    // c. Default rules (IT, Mining, or BF Head)
    const groupId = request.asset_group_id || request.group_id;
    if (groupId === 1 || (request.asset_group_name && request.asset_group_name.toUpperCase().includes('IT'))) {
       const [iRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) LIKE '%it head%' OR LOWER(head) = 'it_admin' LIMIT 1");
       return iRows[0]?.emp_no;
    }
    const requesterSbu = request.sbu || request.requester_sbu;
    if (requesterSbu && requesterSbu.toUpperCase().includes('MINING')) {
       const [mRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) LIKE '%mining head%' LIMIT 1");
       return mRows[0]?.emp_no;
    }

    const bfunId = request.requester_bfun_id || request.bfun_id;
    const sbuId = request.sbu_id || request.requester_sbu_id;
    if (bfunId) {
      // Find budget owner matching BOTH BF and SBU (prefer more specific matches)
      const [bRows] = await db.query(`
        SELECT emp_no FROM capex_master_broad_function_head 
        WHERE (FIND_IN_SET(?, bfun_id) OR bfun_id IS NULL) 
          AND (FIND_IN_SET(?, sbu_id) OR sbu_id IS NULL)
          AND (LOWER(head) = 'budget_owner' OR LOWER(head) = 'budget owner')
        ORDER BY (bfun_id IS NOT NULL) DESC, (sbu_id IS NOT NULL) DESC
        LIMIT 1
      `, [bfunId, sbuId]);
      if (bRows.length > 0) return bRows[0].emp_no;
    }
  }

  if (roleKey === 'it_admin') {
     const [iRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) LIKE '%it head%' OR LOWER(head) = 'it_admin' LIMIT 1");
     return iRows[0]?.emp_no;
  }

  if (roleKey === 'cfo') {
    const [cRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) = 'cfo' LIMIT 1");
    return cRows[0]?.emp_no;
  }
  if (roleKey === 'cmd') {
    const [cRows] = await db.query("SELECT emp_no FROM capex_master_broad_function_head WHERE LOWER(head) = 'cmd' LIMIT 1");
    return cRows[0]?.emp_no;
  }

  if (roleKey === 'bulk_approver') {
    // Find users who have the 'approve_bulk_request' permission
    const [bRows] = await db.query(`
      SELECT u.emp_no FROM users u
      JOIN role_user ru ON ru.user_id = u.id
      JOIN permission_role pr ON pr.role_id = ru.role_id
      JOIN permissions p ON p.id = pr.permission_id
      WHERE p.name = 'approve_bulk_request' AND u.status = 'Active'
      LIMIT 1
    `);
    return bRows[0]?.emp_no || null;
  }

  if (roleKey === 'accountant') {
    const [aRows] = await db.query("SELECT emp_no FROM users WHERE user_type = 'accountant' AND status = 'Active' LIMIT 1");
    return aRows[0]?.emp_no || null;
  }
  if (roleKey === 'finance') {
    const [fRows] = await db.query("SELECT emp_no FROM users WHERE user_type = 'finance' AND status = 'Active' LIMIT 1");
    return fRows[0]?.emp_no || null;
  }

  return null;
}

// GET /api/requests - list requests for current user or all (admin)
router.get('/', async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20, search = '', view } = req.query;
    const offset = (page - 1) * limit;
    const isAdmin = ['admin', 'superadmin'].includes(req.user.user_type) || req.user.roles?.some(r => ['admin', 'superadmin'].includes(r));

    let where = 'WHERE 1=1';
    const params = [];

    // Apply view filters
    if (view === 'my_requests') {
      where += ` AND cr.emp_no = ?`;
      params.push(req.user.emp_no);
    } else if (view === 'to_approve') {
      const userRoles = [req.user.user_type, ...(req.user.roles || [])];
      where += ` AND (cr.active_approver_emp_no = ? OR cr.active_approver IN (?)) AND cr.status IN ('Pending', 'Initiated')`;
      params.push(req.user.emp_no, userRoles);
    } else if (view === 'history') {
      where += ` AND EXISTS (SELECT 1 FROM capex_request_track WHERE capex_request_id = cr.id AND emp_no = ? AND status != 'Initiated')`;
      params.push(req.user.emp_no);
    } else if (!isAdmin) {
      // Default for regular user: combination of all
      const userRoles = [req.user.user_type, ...(req.user.roles || [])];
      where += ` AND (
        cr.emp_no = ? 
        OR cr.active_approver_emp_no = ? 
        OR cr.active_approver IN (?)
        OR EXISTS (SELECT 1 FROM capex_request_track WHERE capex_request_id = cr.id AND emp_no = ?)
      )`;
      params.push(req.user.emp_no, req.user.emp_no, userRoles, req.user.emp_no);
    }

    if (status) { where += ' AND cr.status = ?'; params.push(status); }
    if (type) { where += ' AND cr.request_type = ?'; params.push(type); }
    if (search) {
      where += ' AND (cr.capex_no LIKE ? OR cr.asset_name LIKE ? OR me.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT cr.*, me.name as requester_name, me.sbu, me.location,
              ag.name as asset_group_name, at2.asset_name as asset_type_display,
              bt.budget_type as budget_type_name,
              ame.name as active_approver_name
       FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       LEFT JOIN capex_master_employee ame ON ame.emp_no = cr.active_approver_emp_no
       LEFT JOIN capex_master_asset_type at2 ON at2.id = cr.asset_type
       LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group
       LEFT JOIN capex_budget_type bt ON bt.id = cr.budget_type
       ${where}
       ORDER BY cr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );

    const [tRows] = await db.query(
      `SELECT COUNT(*) as total FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       ${where}`,
      params
    );
    const total = tRows[0]?.total || 0;

    const ROLE_NAMES = {
      'supervisor': 'Direct Supervisor',
      'budget_owner': 'Budget Owner',
      'accountant': 'Divisional Accountant',
      'it_admin': 'IT Reviewer',
      'cfo': 'Chief Financial Officer',
      'cmd': 'Managing Director',
      'finance': 'Finance Head',
      'hod': 'Head of Department',
      'sbu_head': 'SBU Head',
      'leadership_review': 'Leadership Review'
    };

    const augmentedRows = rows.map(r => ({
      ...r,
      active_approver_friendly: ROLE_NAMES[r.active_approver] || r.active_approver
    }));

    res.json({ success: true, data: augmentedRows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// Configure multer for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'DOC-' + uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// ...

// GET /api/requests/:id - single request detail
router.get('/:id', async (req, res) => {
  try {
     const [rows] = await db.query(
        `SELECT cr.*, u.id as requester_id, me.name as requester_name, me.grade, me.sbu, me.b_func, me.sbu_id,
               me.b_func_id as requester_bfun_id,
               me.location, me.desg, me.email as requester_email,
               ag.name as asset_group_name, at2.asset_name as asset_type_display,
               at2.asset_group as asset_group_id,
               bt.budget_type as budget_type_name,
               al.budgeted_amount, al.budget_amount_consumed, al.committed_amount,
               ame.name as active_approver_name
        FROM capex_request cr
        LEFT JOIN users u ON u.emp_no = cr.emp_no
        LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
        LEFT JOIN capex_master_employee ame ON ame.emp_no = cr.active_approver_emp_no
        LEFT JOIN capex_master_asset_type at2 ON at2.id = cr.asset_type
        LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group
        LEFT JOIN capex_budget_type bt ON bt.id = cr.budget_type
        LEFT JOIN capex_allocation al ON al.id = cr.budget_allocation_id
        WHERE cr.id = ?`,
       [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    const request = rows[0];

    const [rawTrack] = await db.query(
      'SELECT * FROM capex_request_track WHERE capex_request_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    const track = await Promise.all(rawTrack.map(async (t) => {
       if (t.comment) {
          const match = t.comment.match(/(?:by|Rejected by) (\d+) (?:at|at level|level)/);
          if (match) {
             const empNo = match[1];
             const [nms] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = ?", [empNo]);
             if (nms.length > 0) {
                return { ...t, comment: t.comment.replace(empNo, nms[0].name) };
             }
          }
       }
       return t;
    }));

    const reqSbu = (request.request_type === 'BULK' && request.target_sbu) ? request.target_sbu : request.sbu;
    const chain = await getWorkflowChain(reqSbu, request.request_type, request.amount_ext_gst || 0, request.requester_id);

    const ROLE_NAMES = {
      'supervisor': 'Direct Supervisor',
      'budget_owner': 'Budget Owner',
      'accountant': 'Divisional Accountant',
      'it_admin': 'IT Reviewer',
      'cfo': 'Chief Financial Officer',
      'cmd': 'Managing Director',
      'finance': 'Finance Head',
      'hod': 'Head of Department',
      'sbu_head': 'SBU Head',
      'leadership_review': 'Leadership Review'
    };

    const fieldMap = {
      'supervisor':   { status: 'supervisor_approve', date: 'supervisor_approve_date', comment: 'supervisor_comment' },
      'budget_owner': { status: 'owner_approve',      date: 'owner_approve_date',      comment: 'budget_owner_comment' },
      'accountant':   { status: 'accountant_approve', date: 'accountant_approve_date', comment: 'accountant_comment' },
      'it_admin':     { status: 'it_approve',         date: 'it_approve_date',         comment: 'it_reviewer_comment' },
      'cfo':          { status: 'cfo_approve',        date: 'cfo_approve_date',        comment: 'cfo_comment' },
      'cmd':          { status: 'cmd_approve',        date: 'cmd_approve_date',        comment: 'cmd_comment' },
      'finance':      { status: 'finance_approve',    date: 'finance_approve_date',    comment: 'finance_comment' },
      'leadership_review': { status: 'cmd_approve',        date: 'cmd_approve_date',        comment: 'cmd_comment' },
    };

    // Augment chain with actual statuses and names
    const augmentedChain = await Promise.all(chain.map(async (step) => {
       const role = step.role_key;
       let status = 'Pending';
       let actorName = null;
       const fields = fieldMap[role];

       if (fields) {
         if (request[fields.status] === 'Approved') status = 'Approved';
         else if (request[fields.status] === 'Rejected') status = 'Rejected';
         else if (request.active_approver === role) status = 'Current';
       }

       // Find the actor name
       if (status === 'Current') {
          const empNo = request.active_approver_emp_no || await determineSpecificApprover(request.id, role);
          if (empNo) {
             const [emps] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = ?", [empNo]);
             actorName = emps[0]?.name;
          }
       } else if (status === 'Approved' || status === 'Rejected') {
          const [tracks] = await db.query(
            "SELECT comment FROM capex_request_track WHERE capex_request_id = ? AND (comment LIKE ? OR comment LIKE ?) ORDER BY created_at DESC LIMIT 1",
            [request.id, `%by % level ${role}%`, `%by % at level ${role}%`]
          );
          if (tracks.length > 0) {
             const match = tracks[0].comment.match(/(?:by|Rejected by) (.*?) (?:at|at level|level)/);
             if (match) {
                actorName = match[1];
                // If the extracted name looks like an employee number, try to resolve the actual name
                if (/^\d+$/.test(actorName)) {
                   const [nms] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = ?", [actorName]);
                   if (nms.length > 0) actorName = nms[0].name;
                }
             }
          }
       } else {
          // Future status: Pending
          // Predict who it will go to
          const predictedEmpNo = await determineSpecificApprover(request.id, role);
          if (predictedEmpNo) {
             const [emps] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = ?", [predictedEmpNo]);
             actorName = emps[0]?.name;
          } else if (role === 'supervisor') {
             // For supervisor, we can lookup from masters if it exists
             const [emps] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = (SELECT supervisor_emp_no FROM capex_master_employee WHERE emp_no = ?)", [request.emp_no]);
             actorName = emps[0]?.name;
          }
       }

       return { 
         ...step, 
         actual_status: status, 
         actor_name: actorName, 
         friendly_label: ROLE_NAMES[role] || step.label,
         action_date: fields ? request[fields.date] : null,
         comment: fields ? request[fields.comment] : null
       };
    }));

    const [notifications] = await db.query(
      'SELECT * FROM capex_notification WHERE capex_no = ? ORDER BY created_at DESC LIMIT 20',
      [request.capex_no]
    );

    // Calculate specifically who it is pending with if at a step
    let currentApproverDetails = null;
    if (request.status === 'Pending' || request.status === 'Initiated') {
       if (request.active_approver_emp_no) {
          const [eRows] = await db.query("SELECT name, email, desg FROM capex_master_employee WHERE emp_no = ?", [request.active_approver_emp_no]);
          currentApproverDetails = eRows[0];
       }
    }

    // Get Items for Multi-Asset
    const [items] = await db.query('SELECT * FROM capex_request_items WHERE capex_request_id = ?', [req.params.id]);

    res.json({ success: true, data: { 
      ...request, 
      items, 
      track, 
      notifications, 
      workflow_chain: augmentedChain, 
      currentApproverDetails,
      active_approver_friendly: ROLE_NAMES[request.active_approver] || request.active_approver
    } });
  } catch (err) {
    console.error('Request Detail Error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// POST /api/requests - create new request
router.post('/', upload.array('attachments', 10), async (req, res) => {
  try {
    const {
      asset_type, budget_allocation_id, expected_date, procurement,
      asset_name, asset_description, asset_justification, asset_quantity,
      amount_ext_gst, budget_type, request_type, costcentre,
      vender_name1, sap_vender_code1, vender_name2, sap_vender_code2,
      vender_name3, sap_vender_code3, vender_name4, sap_vender_code4,
      manufacturer, items = [], sbu, location
    } = req.body;

    let final_budget_allocation_id = budget_allocation_id;

    const [empRows] = await db.query('SELECT sbu_id, b_func_id, location_id FROM capex_master_employee WHERE emp_no = ?', [req.user.emp_no]);
    if (empRows.length > 0) {
      const { sbu_id, b_func_id, location_id } = empRows[0];
      
      if (!final_budget_allocation_id) {
        const [allocRows] = await db.query(
          `SELECT ca.id FROM capex_allocation ca 
           JOIN capex_budget_entity be ON be.id = ca.budget_entity 
           WHERE (be.sbu_id = ? OR be.sbu_id IS NULL) 
             AND (be.b_fun_id = ? OR be.b_fun_id IS NULL) 
             AND (be.loc_id = ? OR be.loc_id IS NULL)
             AND ca.budget_type = ? AND ca.status = 'Active'
           ORDER BY (be.sbu_id IS NOT NULL) DESC, (be.b_fun_id IS NOT NULL) DESC, (be.loc_id IS NOT NULL) DESC LIMIT 1`,
          [sbu_id, b_func_id, location_id, budget_type]
        );
        if (allocRows.length > 0) {
          final_budget_allocation_id = allocRows[0].id;
        }
      }

      if (final_budget_allocation_id) {
        const [allocRows] = await db.query(
          `SELECT ca.id FROM capex_allocation ca 
           JOIN capex_budget_entity be ON be.id = ca.budget_entity 
           WHERE ca.id = ? AND (be.sbu_id = ? OR be.sbu_id IS NULL) AND (be.b_fun_id = ? OR be.b_fun_id IS NULL) AND (be.loc_id = ? OR be.loc_id IS NULL)`,
          [final_budget_allocation_id, sbu_id, b_func_id, location_id]
        );
        const isAdmin = ['admin', 'superadmin'].includes(req.user.user_type) || req.user.roles?.some(r => ['admin', 'superadmin'].includes(r));
        if (!isAdmin && allocRows.length === 0) {
          return res.status(403).json({ success: false, message: 'Invalid budget allocation selected for your department.' });
        }
      }
    }

    const files = req.files ? req.files.map(f => f.filename).join(';') : '';

    // Generate capex_no (Legacy Format: CYYYYMMDDNNN)
    const now = new Date();
    const dateStr = now.getFullYear().toString() + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getDate().toString().padStart(2, '0');
    const [cRows] = await db.query(
      'SELECT COUNT(*) as cnt FROM capex_request WHERE DATE(created_at) = CURDATE()'
    );
    const cnt = cRows[0].cnt;
    const capex_no = `C${dateStr}${String(cnt + 1).padStart(3, '0')}`;

    // Get Requester Info
    const [eRows] = await db.query(
      'SELECT * FROM capex_master_employee WHERE emp_no = ? LIMIT 1',
      [req.user.emp_no]
    );
    const employee = eRows[0] || { sbu: 'All', name: req.user.username || 'System User' };

    // Workflow logic
    const reqSbu = (request_type === 'BULK' && sbu) ? sbu : employee.sbu;
    const chain = await getWorkflowChain(reqSbu, request_type || 'CAPEX', amount_ext_gst || 0, req.user.id);
    const firstRole = chain.length > 0 ? chain[0].role_key : 'Approved';

    const [result] = await db.query(
      `INSERT INTO capex_request
       (capex_no, emp_no, budget_allocation_id, expected_date, asset_type,
        procurement, asset_name, asset_description, asset_justification,
        asset_quantity, amount_ext_gst, budget_type, request_type, costcentre,
        vender_name1, sap_vender_code1, vender_name2, sap_vender_code2,
        vender_name3, sap_vender_code3, vender_name4, sap_vender_code4,
        manufacturer, status, active_approver, quotation, target_sbu, target_location,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        capex_no, req.user.emp_no, final_budget_allocation_id || null, expected_date, asset_type,
        procurement, asset_name, asset_description, asset_justification,
        asset_quantity || 1, amount_ext_gst, budget_type, request_type || 'CAPEX', costcentre,
        vender_name1, sap_vender_code1, vender_name2, sap_vender_code2,
        vender_name3, sap_vender_code3, vender_name4, sap_vender_code4,
        manufacturer, firstRole === 'Approved' ? 'Approved' : 'Initiated', firstRole, files,
        (request_type === 'BULK' ? sbu : null), (request_type === 'BULK' ? location : null)
      ]
    );

    const requestId = result.insertId;

    // Handle Multi-Asset Items
    let isMulti = 0;
    if (items && typeof items === 'string') {
      try {
        const itemArray = JSON.parse(items);
        if (Array.isArray(itemArray) && itemArray.length > 0) {
           isMulti = 1;
           const values = itemArray.map(it => [
              requestId, 
              it.asset_type || null, 
              it.asset_name || asset_name, 
              it.asset_description || asset_description, 
              it.asset_quantity || 1, 
              it.amount_ext_gst || amount_ext_gst, 
              it.procurement || procurement
           ]);
           await db.query(
             `INSERT INTO capex_request_items 
              (capex_request_id, asset_type, asset_name, asset_description, asset_quantity, amount_ext_gst, procurement)
              VALUES ?`, 
             [values]
           );
           // Also update the is_multi_asset flag
           await db.query("UPDATE capex_request SET is_multi_asset = 1 WHERE id = ?", [requestId]);
        }
      } catch (e) {
        console.error('Failed to parse items JSON:', e);
      }
    }

    // Determine the specific person for the first role
    let firstRoleEmpNo = null;
    if (firstRole !== 'Approved') {
      firstRoleEmpNo = await determineSpecificApprover(requestId, firstRole);
      if (firstRoleEmpNo) {
        await db.query("UPDATE capex_request SET active_approver_emp_no = ? WHERE id = ?", [firstRoleEmpNo, requestId]);
      }
    }

    // Log track
    await db.query(
      "INSERT INTO capex_request_track (capex_request_id, emp_no, status, comment, created_at, updated_at) VALUES (?, ?, 'Initiated', 'Request created', NOW(), NOW())",
      [requestId, req.user.emp_no]
    );

    // Notification
    if (firstRoleEmpNo) {
      await db.query(
        "INSERT INTO capex_notification (emp_no, capex_no, approve_level, heading, message, status, created_at, updated_at) VALUES (?, ?, ?, 'New CAPEX Request', ?, 'new', NOW(), NOW())",
        [firstRoleEmpNo, capex_no, firstRole, `New request ${capex_no} is awaiting your approval.`]
      );

      // EMAIL: Notify first approver
      try {
        const [appRows] = await db.query("SELECT name, email FROM capex_master_employee WHERE emp_no = ?", [firstRoleEmpNo]);
        if (appRows[0]?.email) {
          await mailService.sendApprovalRequest(appRows[0].email, appRows[0].name, employee.name, capex_no, asset_name, amount_ext_gst);
        }
      } catch (err) { console.error('Email Trigger Error:', err); }
    }

    res.status(201).json({ success: true, message: 'Request created', capex_no, id: requestId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/requests/:id/approve - approve a request
router.post('/:id/approve', async (req, res) => {
  try {
    const { comment = '' } = req.body;
    const [rows] = await db.query('SELECT * FROM capex_request WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const request = rows[0];
    const approveLevel = request.active_approver;
    const now = new Date();

      const [uRows] = await db.query('SELECT id FROM users WHERE emp_no = ?', [request.emp_no]);
      const requester = uRows[0];
    const chain = await getWorkflowChain(request.sbu || '', request.request_type, request.amount_ext_gst || 0, requester?.id);
    const currentIndex = chain.findIndex(c => c.role_key === approveLevel);
    let nextStep = currentIndex >= 0 && currentIndex < chain.length - 1 ? chain[currentIndex + 1] : null;
    let nextLevel = nextStep ? nextStep.role_key : 'Approved';

    const [atRows] = await db.query('SELECT asset_group, asset_name FROM capex_master_asset_type WHERE id = ?', [request.asset_type]);
    const assetTypeRow = atRows[0] || {};
    const [agRows] = await db.query('SELECT name FROM capex_master_asset_group WHERE id = ?', [assetTypeRow.asset_group]);
    const assetGroupName = agRows[0]?.name || '';
    const isITAsset = assetTypeRow.asset_group === 1 || assetGroupName.toUpperCase().includes('IT');

    if (isITAsset && approveLevel === 'budget_owner') {
       if (req.body.forwardToLeadership) {
          nextLevel = 'leadership_review';
       } else {
          nextLevel = 'finance';
       }
    } else if (approveLevel === 'leadership_review') {
       nextLevel = 'finance';
    }

    // Map level to field
    const levelMap = {
      'supervisor': { approve: 'supervisor_approve', date: 'supervisor_approve_date', comment: 'supervisor_comment' },
      'budget_owner': { approve: 'owner_approve', date: 'owner_approve_date', comment: 'budget_owner_comment' },
      'accountant': { approve: 'accountant_approve', date: 'accountant_approve_date', comment: 'accountant_comment' },
      'cfo': { approve: 'cfo_approve', date: 'cfo_approve_date', comment: 'cfo_comment' },
      'cmd': { approve: 'cmd_approve', date: 'cmd_approve_date', comment: 'cmd_comment' },
      'finance': { approve: 'finance_approve', date: 'finance_approve_date', comment: 'finance_comment' },
      'it_admin': { approve: 'it_approve', date: 'it_approve_date', comment: 'it_reviewer_comment' },
      'leadership_review': { approve: 'cmd_approve', date: 'cmd_approve_date', comment: 'cmd_comment' },
    };

    let updateFields = [`updated_at = NOW()`];
    let updateParams = [];

    if (levelMap[approveLevel]) {
      const f = levelMap[approveLevel];
      updateFields.push(`${f.approve} = 'Approved'`, `${f.date} = ?`, `${f.comment} = ?`);
      updateParams.push(now, comment);
    }

    if (approveLevel === 'finance') {
       if (req.body.budget_type_id) {
         updateFields.push(`budget_type_id = ?`);
         updateParams.push(req.body.budget_type_id);
       }
       
       let assetNo = req.body.asset_no;
       if (!assetNo) {
          // Auto-generate a mock SAP asset code for the test environment
          const prefix = isITAsset ? '10' : '20';
          const randomPart = Math.floor(10000000 + Math.random() * 90000000); // 8 digits
          assetNo = `${prefix}${randomPart}`;
       }
       updateFields.push(`asset_no = ?`);
       updateParams.push(assetNo);
    }

    const isFinal = nextLevel === 'Approved';
    let nextEmpNo = null;

    if (!isFinal) {
      nextEmpNo = await determineSpecificApprover(request.id, nextLevel);
    }

    updateFields.push(`status = ?`, `active_approver = ?`, `active_approver_emp_no = ?`);
    updateParams.push(isFinal ? 'Approved' : 'Pending', isFinal ? 'Final' : nextLevel, nextEmpNo);
    updateParams.push(req.params.id);

    await db.query(`UPDATE capex_request SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);

    // Log track
    await db.query(
      `INSERT INTO capex_request_track (capex_request_id, emp_no, status, comment, created_at, updated_at) VALUES (?, ?, 'Approved', ?, NOW(), NOW())`,
      [req.params.id, req.user.emp_no, `Approved by ${req.user.username} at level ${approveLevel}. ${comment}`]
    );

    // Notification for next approver
    if (nextEmpNo) {
      await db.query(
        "INSERT INTO capex_notification (emp_no, capex_no, approve_level, heading, message, status, created_at, updated_at) VALUES (?, ?, ?, 'Request Awaiting Approval', ?, 'new', NOW(), NOW())",
        [nextEmpNo, request.capex_no, nextLevel, `Request ${request.capex_no} has been advanced to you.`]
      );

      // EMAIL: Notify next approver
      try {
        const [appRows] = await db.query("SELECT name, email FROM capex_master_employee WHERE emp_no = ?", [nextEmpNo]);
        const [reqRows] = await db.query("SELECT name FROM capex_master_employee WHERE emp_no = ?", [request.emp_no]);
        if (appRows[0]?.email) {
           await mailService.sendApprovalRequest(appRows[0].email, appRows[0].name, reqRows[0]?.name || request.emp_no, request.capex_no, request.asset_name, request.amount_ext_gst);
        }
      } catch (err) { console.error('Email Trigger Error:', err); }
    } else if (isFinal) {
       // Notify requester
       await db.query(
         "INSERT INTO capex_notification (emp_no, capex_no, approve_level, heading, message, status, created_at, updated_at) VALUES (?, ?, 'Final', 'Request Fully Approved', ?, 'new', NOW(), NOW())",
         [request.emp_no, request.capex_no, 'Requester', `Congratulations! Your request ${request.capex_no} has been fully approved.`]
       );

       // EMAIL: Notify Requester of Final Approval
       try {
         const [reqRows] = await db.query("SELECT name, email FROM capex_master_employee WHERE emp_no = ?", [request.emp_no]);
         if (reqRows[0]?.email) {
            await mailService.sendStatusUpdate(reqRows[0].email, reqRows[0].name, request.capex_no, 'Approved', comment);
         }
       } catch (err) { console.error('Email Trigger Error:', err); }
       
       // TRIGGER SAP INTEGRATION PACKET GENERATION
       try {
         await generateSAPAssetPacket(request.id);
       } catch (sapErr) {
         console.error('SAP integration failed but request was approved:', sapErr);
       }
    }

    res.json({ success: true, message: 'Request approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/requests/:id/reject - reject a request
router.post('/:id/reject', async (req, res) => {
  try {
    const { comment = '' } = req.body;
    if (!comment) return res.status(400).json({ success: false, message: 'Rejection comment required' });

    const [rows] = await db.query('SELECT capex_no, emp_no FROM capex_request WHERE id = ?', [req.params.id]);
    const request = rows[0];

    await db.query(
      `UPDATE capex_request SET status = 'Rejected', failed_txt = ?, rejecter_emp_no = ?, updated_at = NOW() WHERE id = ?`,
      [comment, req.user.emp_no, req.params.id]
    );

    await db.query(
      `INSERT INTO capex_request_track (capex_request_id, emp_no, status, comment, created_at, updated_at) VALUES (?, ?, 'Rejected', ?, NOW(), NOW())`,
      [req.params.id, req.user.emp_no, `Rejected by ${req.user.username}: ${comment}`]
    );

    // EMAIL: Notify Requester of Rejection
    if (request) {
      try {
        const [reqRows] = await db.query("SELECT name, email FROM capex_master_employee WHERE emp_no = ?", [request.emp_no]);
        if (reqRows[0]?.email) {
           await mailService.sendStatusUpdate(reqRows[0].email, reqRows[0].name, request.capex_no, 'Rejected', comment);
        }
      } catch (err) { console.error('Email Trigger Error:', err); }
    }

    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/requests/bulk-approve - bulk approve
router.post('/bulk-approve', async (req, res) => {
  try {
    const { ids = [], comment = '' } = req.body;
    if (!ids.length) return res.status(400).json({ success: false, message: 'No request IDs provided' });

    // Validate Total Bulk Amount (Safety Limit: e.g. 50,00,000)
    const [stats] = await db.query('SELECT SUM(amount_ext_gst) as total FROM capex_request WHERE id IN (?)', [ids]);
    const totalAmount = stats[0].total || 0;
    const BULK_LIMIT = 5000000; // 50 Lakhs limit for single bulk action

    if (totalAmount > BULK_LIMIT) {
      return res.status(400).json({ 
        success: false, 
        message: `Bulk approval total (₹${totalAmount.toLocaleString()}) exceeds the safety limit of ₹${BULK_LIMIT.toLocaleString()}. Please approve high-value requests individually.` 
      });
    }

    for (const id of ids) {
      // ... existing approval logic
      const [rows] = await db.query('SELECT * FROM capex_request WHERE id = ?', [id]);
      if (!rows.length) continue;
      
      const request = rows[0];
      // Check if current user is the active approver for this request
      const userRoles = [req.user.user_type, ...(req.user.roles || [])];
      if (String(request.active_approver_emp_no) !== String(req.user.emp_no) && !userRoles.includes(request.active_approver)) {
         continue; // Skip if not authorized for this specific request
      }

      const approveLevel = request.active_approver;
      const now = new Date();

      const [eRows] = await db.query('SELECT sbu, id FROM users WHERE emp_no = ?', [request.emp_no]);
      const employee = eRows[0];
      const chain = await getWorkflowChain(employee?.sbu || 'All', request.request_type, request.amount_ext_gst || 0, employee?.id);
      const currentIndex = chain.findIndex(c => c.role_key === approveLevel);
      const nextStep = currentIndex >= 0 && currentIndex < chain.length - 1 ? chain[currentIndex + 1] : null;
      const nextLevel = nextStep ? nextStep.role_key : 'Approved';

      let updateFields = `updated_at = NOW()`;
      const updateParams = [];

      const levelMap = {
        'supervisor': { approve: 'supervisor_approve', date: 'supervisor_approve_date', comment: 'supervisor_comment' },
        'budget_owner': { approve: 'owner_approve', date: 'owner_approve_date', comment: 'budget_owner_comment' },
        'accountant': { approve: 'accountant_approve', date: 'accountant_approve_date', comment: 'accountant_comment' },
        'cfo': { approve: 'cfo_approve', date: 'cfo_approve_date', comment: 'cfo_comment' },
        'cmd': { approve: 'cmd_approve', date: 'cmd_approve_date', comment: 'cmd_comment' },
        'finance': { approve: 'finance_approve', date: 'finance_approve_date', comment: 'finance_comment' },
        'it_admin': { approve: 'it_approve', date: 'it_approve_date', comment: 'it_reviewer_comment' },
      };

      if (levelMap[approveLevel]) {
        const fields = levelMap[approveLevel];
        updateFields += `, ${fields.approve} = 'Approved', ${fields.date} = ?, ${fields.comment} = ?`;
        updateParams.push(now, comment);
      }

      const isFinal = nextLevel === 'Approved';
      let nextEmpNo = null;
      if (!isFinal) {
        nextEmpNo = await determineSpecificApprover(id, nextLevel);
      }

      updateFields += `, status = ?, active_approver = ?, active_approver_emp_no = ?`;
      updateParams.push(isFinal ? 'Approved' : 'Pending', isFinal ? 'Final' : nextLevel, nextEmpNo);
      updateParams.push(id);

      await db.query(`UPDATE capex_request SET ${updateFields} WHERE id = ?`, updateParams);

      await db.query(
        `INSERT INTO capex_request_track (capex_request_id, emp_no, status, comment, created_at, updated_at) VALUES (?, ?, 'Approved', ?, NOW(), NOW())`,
        [id, req.user.emp_no, `Bulk approved by ${req.user.username} at level ${approveLevel}. ${comment}`]
      );

      if (isFinal) {
         try { await generateSAPAssetPacket(id); } catch (e) { console.error('SAP Error:', e); }
      }
    }

    res.json({ success: true, message: `${ids.length} requests bulk approved (Total: ₹${totalAmount.toLocaleString()})` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/requests/pending-with-me - requests pending with current user
router.get('/pending/me', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cr.*, me.name as requester_name, me.sbu, me.location,
              at2.asset_name as asset_type_display, bt.budget_type as budget_type_name
       FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       LEFT JOIN capex_master_asset_type at2 ON at2.id = cr.asset_type
       LEFT JOIN capex_budget_type bt ON bt.id = cr.budget_type
       WHERE cr.active_approver_emp_no = ? AND cr.status IN ('Pending','Initiated')
       ORDER BY cr.created_at DESC`,
      [req.user.emp_no]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
