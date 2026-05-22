const db = require('./src/db');

async function checkReportsQueries() {
  try {
    console.log('Testing Dashboard Summary Query...');
    const year = 2026;
    const [sRows] = await db.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('Approved', 'COMPLETE', 'PO CREATED', 'SANCTION NUMBER GENERATED', 'ASSET CREATED') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status IN ('Pending', 'Initiated', 'IN PROGRESS', 'IN STOCK') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status IN ('Rejected', 'REJECT', 'FAIL') THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN request_type = 'CAPEX' THEN 1 ELSE 0 END) as capex_count,
        SUM(CASE WHEN request_type = 'OPEX' THEN 1 ELSE 0 END) as opex_count,
        COALESCE(SUM(amount_ext_gst),0) as total_amount,
        COALESCE(SUM(CASE WHEN status IN ('Approved', 'COMPLETE', 'PO CREATED', 'SANCTION NUMBER GENERATED', 'ASSET CREATED') THEN amount_ext_gst ELSE 0 END),0) as approved_amount
       FROM capex_request WHERE YEAR(created_at) = ?`, [year]
    );
    console.log('Dashboard summary check: SUCCESS');

    console.log('Testing All Requests Query...');
    const [rows] = await db.query(
      `SELECT cr.capex_no, me.name as requester_name, me.sbu, me.location, me.grade,
              cr.created_at as requested_date, ag.name as asset_group, at2.asset_name as asset_type,
              bt.budget_type, cr.sanction_no, cr.asset_name, cr.asset_description,
              cr.asset_quantity, cr.amount_ext_gst, cr.approve_amount,
              cr.status, cr.active_approver as pending_with, cr.request_type,
              DATEDIFF(COALESCE(cr.finance_approve_date, cr.cmd_approve_date, cr.cfo_approve_date, NOW()), cr.created_at) as aging_days,
              cr.sap_status, cr.sap_packet_generated_at,
              cr.supervisor_approve, cr.owner_approve, cr.accountant_approve,
              cr.cfo_approve, cr.cmd_approve, cr.finance_approve,
              cr.supervisor_comment, cr.budget_owner_comment, cr.failed_txt
       FROM capex_request cr
       LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
       LEFT JOIN capex_master_asset_type at2 ON at2.id = cr.asset_type
       LEFT JOIN capex_master_asset_group ag ON ag.id = at2.asset_group
       LEFT JOIN capex_budget_type bt ON bt.id = cr.budget_type
       LIMIT 1`
    );
    console.log('All requests check: SUCCESS');

  } catch (err) {
    console.error('QUERY FAILED:', err.message);
    if (err.sql) console.error('SQL:', err.sql);
  } finally {
    process.exit(0);
  }
}

checkReportsQueries();
