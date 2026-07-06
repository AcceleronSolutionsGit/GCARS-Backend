const db = require('./src/db');
async function run() {
  try {
    const [rows] = await db.query('SHOW TABLES LIKE "%budget%"');
    console.log(rows);
    const [all] = await db.query('SHOW TABLES');
    console.log(all.map(r => Object.values(r)[0]).filter(t => t.includes('budget') || t.includes('quarter')));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
