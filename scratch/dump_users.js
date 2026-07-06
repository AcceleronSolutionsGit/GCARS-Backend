const db = require('../src/db');

(async () => {
  try {
    const [users] = await db.query(`
      SELECT u.id, u.username, u.email, u.emp_no, u.user_type, u.status,
             GROUP_CONCAT(DISTINCT r.name) as roles
      FROM users u
      LEFT JOIN role_user ru ON ru.user_id = u.id
      LEFT JOIN roles r ON r.id = ru.role_id
      GROUP BY u.id
    `);
    console.log('All Users and Roles:');
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
})();
