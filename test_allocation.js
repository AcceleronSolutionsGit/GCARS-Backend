const db = require('./src/db');

async function testAllocationLogic() {
  try {
    // 1. Pick a random user
    const [users] = await db.query("SELECT * FROM users WHERE status = 'Active' AND emp_no IS NOT NULL LIMIT 1");
    if (!users.length) {
      console.log("No active users found.");
      process.exit(0);
    }
    const user = users[0];
    console.log(`Testing with user: ${user.name} (emp_no: ${user.emp_no})`);

    // 2. Fetch user's SBU, BFunc, Location
    const [empRows] = await db.query('SELECT sbu_id, b_func_id, location_id FROM capex_master_employee WHERE emp_no = ?', [user.emp_no]);
    if (!empRows.length) {
      console.log("User not found in employee master.");
      process.exit(0);
    }

    const { sbu_id, b_func_id, location_id } = empRows[0];
    console.log(`User Dept Info -> SBU ID: ${sbu_id}, BFunc ID: ${b_func_id}, Location ID: ${location_id}`);

    // 3. Pick a random budget type
    const [budgetTypes] = await db.query("SELECT * FROM capex_budget_type WHERE status = 'Active' LIMIT 1");
    if (!budgetTypes.length) {
      console.log("No budget types found.");
      process.exit(0);
    }
    const budget_type = budgetTypes[0].id;
    console.log(`Using Budget Type ID: ${budget_type} (${budgetTypes[0].budget_type})`);

    // 4. Run the allocation resolution logic
    const [allocRows] = await db.query(
      `SELECT ca.id, be.entity_name, be.sbu_id, be.b_fun_id, be.loc_id 
       FROM capex_allocation ca 
       JOIN capex_budget_entity be ON be.id = ca.budget_entity 
       WHERE (be.sbu_id = ? OR be.sbu_id IS NULL) 
         AND (be.b_fun_id = ? OR be.b_fun_id IS NULL) 
         AND (be.loc_id = ? OR be.loc_id IS NULL)
         AND ca.budget_type = ? AND ca.status = 'Active'
       ORDER BY (be.sbu_id IS NOT NULL) DESC, (be.b_fun_id IS NOT NULL) DESC, (be.loc_id IS NOT NULL) DESC LIMIT 1`,
      [sbu_id, b_func_id, location_id, budget_type]
    );

    if (allocRows.length > 0) {
      console.log(`✅ Success! Resolved Allocation ID: ${allocRows[0].id}`);
      console.log(`Allocation Details: ${JSON.stringify(allocRows[0], null, 2)}`);
    } else {
      console.log(`❌ No matching allocation found for this user and budget type.`);
      
      // Let's print all allocations to see what could have matched
      const [allAllocRows] = await db.query(`SELECT ca.id, be.entity_name, be.sbu_id, be.b_fun_id, be.loc_id, ca.budget_type FROM capex_allocation ca JOIN capex_budget_entity be ON be.id = ca.budget_entity WHERE ca.status = 'Active' LIMIT 5`);
      console.log(`Some active allocations in DB:`, allAllocRows);
    }

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testAllocationLogic();
