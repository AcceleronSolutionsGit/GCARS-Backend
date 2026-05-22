const db = require('./src/db');

(async () => {
  try {
    const [users] = await db.query("SELECT * FROM users WHERE username = 'emp_kumar'");
    console.log('emp_kumar in users:', users);

    const [emps] = await db.query("SELECT * FROM capex_master_employee WHERE emp_no = 'E001'");
    console.log('E001 in capex_master_employee:', emps);

    const [allTestUsers] = await db.query("SELECT username, emp_no, user_type FROM users WHERE emp_no LIKE 'E%' OR emp_no = 'SA001'");
    console.log('All test users in users:', allTestUsers);

    const [allTestEmps] = await db.query("SELECT emp_no, name, sbu, b_func FROM capex_master_employee WHERE emp_no LIKE 'E%'");
    console.log('All test employees in capex_master_employee:', allTestEmps);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
})();
