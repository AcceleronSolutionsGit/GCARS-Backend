const db = require('../src/db');

async function checkRoles() {
  const [bHeads] = await db.query('SELECT head, emp_no FROM capex_master_broad_function_head');
  console.log("Broad Function Heads (Dynamic Approvers):");
  console.table(bHeads);

  const [fixedRoles] = await db.query('SELECT username, emp_no, user_type FROM users WHERE user_type IN ("admin", "accountant", "finance")');
  console.log("Fixed Role Users:");
  console.table(fixedRoles);

  const [itAdmins] = await db.query(`SELECT u.username, u.emp_no FROM users u JOIN role_user ru ON u.id = ru.user_id JOIN roles r ON ru.role_id = r.id WHERE r.name LIKE '%admin%'`);
  console.log("Role-based Admins:");
  console.table(itAdmins);
}

checkRoles().then(() => process.exit(0)).catch(e => console.error(e));
