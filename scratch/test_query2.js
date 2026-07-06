const db = require('../src/db');
(async () => {
  try {
    const [rows] = await db.query(
      `SELECT c.sbu as raw_sbu, sm.id as sm_id, sm.sbu_name, COALESCE(sm.sbu_name, c.sbu) as sbu
       FROM capex_budget_determination_matrix_combination c
       LEFT JOIN capex_master_sbu_master sm ON sm.id = (CASE WHEN c.sbu REGEXP '^[0-9]+$' THEN CAST(c.sbu AS UNSIGNED) ELSE NULL END)
       WHERE c.budget_matrix_id = 29`
    );
    console.log(rows);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})()
