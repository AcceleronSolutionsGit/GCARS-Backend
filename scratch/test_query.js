const db = require('../src/db');
(async () => {
  try {
    const [[matrix]] = await db.query(
      `SELECT m.id, m.asset_group, m.asset_type, m.status,
              ag.name as asset_group_name, at2.asset_name as asset_type_name
       FROM capex_budget_determination_matrix m
       LEFT JOIN capex_master_asset_group ag ON ag.id = m.asset_group
       LEFT JOIN capex_master_asset_type at2 ON at2.id = m.asset_type
       WHERE m.id = 29`
    );
    console.log('Matrix:', matrix);
    const [combos] = await db.query(
      `SELECT c.id, c.sbu, c.b_fun, c.broad_function_head as owner_id,
              bfh.head as owner_name, me.name as emp_name
       FROM capex_budget_determination_matrix_combination c
       LEFT JOIN capex_master_broad_function_head bfh ON bfh.id = c.broad_function_head
       LEFT JOIN capex_master_employee me ON me.emp_no = bfh.emp_no
       WHERE c.budget_matrix_id = 29
       ORDER BY c.id`
    );
    console.log('Combos count:', combos.length);
    console.log('Combos:', combos);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})()
