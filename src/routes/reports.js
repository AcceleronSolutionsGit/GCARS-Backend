/**
 * ============================================================
 *  G-CARS 2 — Reports Routes
 * ============================================================
 *  Provides analytics, dashboard summary data, and full request
 *  export for the reporting module.
 *
 *  Routes:
 *    GET /api/reports/dashboard-summary   – Aggregated KPIs for the dashboard
 *    GET /api/reports/all-requests        – Full tabular export with filters
 *    GET /api/reports/notifications       – User notification feed
 *    PUT /api/reports/notifications/read-all – Mark all notifications as read
 *
 *  Access: All routes require a valid JWT (authMiddleware).
 *          Admin vs. non-admin users receive different data scopes.
 * ============================================================
 */

const express = require('express');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router  = express.Router();

// Apply JWT authentication to every route in this file
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────
//  GET /api/reports/dashboard-summary
// ─────────────────────────────────────────────────────────────
/**
 * Returns aggregated KPI statistics for the main dashboard.
 *
 * Data returned:
 *  - Request counts (total, approved, pending, rejected, by type)
 *  - Total and approved monetary amounts
 *  - Monthly trend (count + amount per month for the given year)
 *  - Budget utilisation by entity (admin only — top 10)
 *  - Request volume by SBU         (admin only — top 10)
 *
 * Non-admin users see only their own requests. Admins get
 * the full system-wide view.
 *
 * @route  GET /api/reports/dashboard-summary
 * @access Private
 * @query  { year?: number }
 * @returns { success, data: { stats, monthly, budgetUtil, bySbu, isAdmin } }
 */
router.get('/dashboard-summary', async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    // Determine if the caller has admin-level access
    const ADMIN_ROLES = ['admin', 'superadmin', 'super_admin'];
    const isAdmin = ADMIN_ROLES.includes(req.user?.user_type) ||
                    req.user?.roles?.some(r => ADMIN_ROLES.includes(r));
    const empNo   = req.user?.emp_no;

    // Non-admin users are scoped to their own requests only
    const userFilter = isAdmin ? '' : ' AND cr.emp_no = ?';
    const userParams = isAdmin ? [year] : [year, empNo];

    // ── Core KPI aggregation ──────────────────────────────────
    const [sRows] = await db.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN cr.status IN ('Approved', 'COMPLETE', 'PO CREATED', 'SANCTION NUMBER GENERATED', 'ASSET CREATED') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN cr.status IN ('Pending', 'Initiated', 'IN PROGRESS', 'IN STOCK') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN cr.status IN ('Rejected', 'REJECT', 'FAIL') THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN cr.budget_type IN (1, 2) OR cr.request_type = 'CAPEX' THEN 1 ELSE 0 END) as capex_count,
        SUM(CASE WHEN cr.budget_type = 3 OR cr.request_type = 'OPEX' THEN 1 ELSE 0 END) as opex_count,
        COALESCE(SUM(COALESCE(cr.amount_ext_gst, cr.approve_amount, cr.actual_cost, 0)), 0) as total_amount,
        COALESCE(SUM(CASE WHEN cr.status IN ('Approved', 'COMPLETE', 'PO CREATED', 'SANCTION NUMBER GENERATED', 'ASSET CREATED')
                          THEN COALESCE(cr.amount_ext_gst, cr.approve_amount, cr.actual_cost, 0) ELSE 0 END), 0) as approved_amount
       FROM capex_request cr WHERE YEAR(cr.created_at) = ?${userFilter}`,
      userParams
    );
    const capexStats = sRows[0];

    // ── Monthly trend (for charting) ──────────────────────────
    const [monthly] = await db.query(
      `SELECT MONTH(cr.created_at) as month, MONTHNAME(cr.created_at) as month_name,
              COUNT(*) as count, COALESCE(SUM(COALESCE(cr.amount_ext_gst, cr.approve_amount, cr.actual_cost, 0)), 0) as amount
       FROM capex_request cr WHERE YEAR(cr.created_at) = ?${userFilter}
       GROUP BY MONTH(cr.created_at) ORDER BY MONTH(cr.created_at)`,
      userParams
    );

    // ── Budget utilisation (admin-only) ───────────────────────
    let budgetUtil = [];
    if (isAdmin) {
      const [buRows] = await db.query(
        `SELECT be.entity_name, ca.budgeted_amount, ca.budget_amount_consumed,
                ca.committed_amount, ca.year,
                ROUND((ca.budget_amount_consumed / NULLIF(ca.budgeted_amount, 0)) * 100, 2) as utilization_pct
         FROM capex_allocation ca
         LEFT JOIN capex_budget_entity be ON be.id = ca.budget_entity
         WHERE ca.year = ? AND ca.status = 'Active'
         ORDER BY utilization_pct DESC LIMIT 10`,
        [year]
      );
      budgetUtil = buRows;
    }

    // ── Requests by SBU (admin-only) ──────────────────────────
    let bySbu = [];
    if (isAdmin) {
      const [sbuRows] = await db.query(
        `SELECT me.sbu, COUNT(*) as count, COALESCE(SUM(COALESCE(cr.amount_ext_gst, cr.approve_amount, cr.actual_cost, 0)), 0) as amount
         FROM capex_request cr
         LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
         WHERE YEAR(cr.created_at) = ?
         GROUP BY me.sbu ORDER BY count DESC LIMIT 10`,
        [year]
      );
      bySbu = sbuRows;
    }

    res.json({ success: true, data: { stats: capexStats, monthly, budgetUtil, bySbu, isAdmin } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/reports/all-requests
// ─────────────────────────────────────────────────────────────
/**
 * Returns a filtered, denormalised list of all requests suitable
 * for tabular display and CSV export.
 *
 * Non-admin users see only requests they raised, are the current
 * active approver for, or have previously acted on in the track.
 *
 * @route  GET /api/reports/all-requests
 * @access Private
 * @query  { status?, year?, sbu?, request_type?, search? }
 * @returns { success, data: Request[], total: number }
 */
router.get('/all-requests', async (req, res) => {
  try {
    const { status, year, sbu, request_type, search = '' } = req.query;

    const ADMIN_ROLES = ['admin', 'superadmin', 'super_admin'];
    const isAdmin = ADMIN_ROLES.includes(req.user?.user_type) ||
                    req.user?.roles?.some(r => ADMIN_ROLES.includes(r));

    let where  = 'WHERE 1=1';
    const params = [];

    // Non-admin scope: requester, active approver, or prior track participant
    if (!isAdmin) {
      where += ` AND (
        cr.emp_no = ?
        OR cr.active_approver_emp_no = ?
        OR EXISTS (SELECT 1 FROM capex_request_track crt WHERE crt.capex_request_id = cr.id AND crt.emp_no = ?)
      )`;
      params.push(req.user.emp_no, req.user.emp_no, req.user.emp_no);
    }

    // Optional filters
    if (status)       { where += ' AND cr.status = ?';            params.push(status); }
    if (year)         { where += ' AND YEAR(cr.created_at) = ?';  params.push(year); }
    if (request_type) { where += ' AND cr.request_type = ?';      params.push(request_type); }
    if (sbu)          { where += ' AND me.sbu LIKE ?';            params.push(`%${sbu}%`); }
    if (search)       {
      where += ' AND (cr.capex_no LIKE ? OR cr.asset_name LIKE ? OR me.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT cr.capex_no, me.name as requester_name, me.sbu, me.location, me.grade,
              cr.created_at as requested_date, ag.name as asset_group, at2.asset_name as asset_type,
              bt.budget_type, cr.sanction_no, cr.asset_name, cr.asset_description,
              cr.asset_quantity, cr.amount_ext_gst, cr.approve_amount,
              cr.status, cr.active_approver as pending_with, cr.request_type,
              cr.target_sbu, cr.target_location,
              DATEDIFF(COALESCE(cr.finance_approve_date, cr.cmd_approve_date, cr.cfo_approve_date, NOW()), cr.created_at) as aging_days,
              cr.asset_generate_status, cr.asset_no,
              cr.supervisor_approve, cr.owner_approve, cr.accountant_approve,
              cr.cfo_approve, cr.cmd_approve, cr.finance_approve,
              cr.supervisor_comment, cr.budget_owner_comment, cr.failed_txt
       FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       LEFT JOIN capex_master_asset_type at2 ON at2.id = cr.asset_type
       LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group
       LEFT JOIN capex_budget_type bt ON bt.id = cr.budget_type
       ${where}
       ORDER BY cr.created_at DESC`,
      params
    );

    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/reports/notifications
// ─────────────────────────────────────────────────────────────
/**
 * Returns the notification feed for the authenticated user,
 * including an unread count for badge display.
 *
 * @route  GET /api/reports/notifications
 * @access Private
 * @returns { success, data: Notification[], unread: number }
 */
router.get('/notifications', async (req, res) => {
  try {
    const emp_no = req.user.emp_no;

    // If the user has no employee number, return an empty feed silently
    if (!emp_no) return res.json({ success: true, data: [], unread: 0 });

    const [rows] = await db.query(
      "SELECT * FROM capex_notification WHERE emp_no = ? ORDER BY created_at DESC LIMIT 50",
      [emp_no]
    );

    const [uRows] = await db.query(
      "SELECT COUNT(*) as unread FROM capex_notification WHERE emp_no = ? AND status = 'new'",
      [emp_no]
    );
    const unread = uRows[0]?.unread || 0;

    res.json({ success: true, data: rows, unread: Number(unread) });
  } catch (err) {
    // Notification failures should not break the UI — return empty silently
    res.json({ success: true, data: [], unread: 0 });
  }
});

// ─────────────────────────────────────────────────────────────
//  PUT /api/reports/notifications/read-all
// ─────────────────────────────────────────────────────────────
/**
 * Marks all of the authenticated user's 'new' notifications
 * as 'read', clearing the unread badge in the UI.
 *
 * @route  PUT /api/reports/notifications/read-all
 * @access Private
 * @returns { success, message? }
 */
router.put('/notifications/read-all', async (req, res) => {
  try {
    const emp_no = req.user.emp_no;
    if (!emp_no) return res.json({ success: true });

    await db.query(
      "UPDATE capex_notification SET status = 'read', updated_at = NOW() WHERE emp_no = ?",
      [emp_no]
    );

    res.json({ success: true, message: 'All notifications marked read' });
  } catch (err) {
    // Fail silently to avoid disrupting the user's session
    res.json({ success: true });
  }
});

module.exports = router;
