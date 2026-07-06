const db = require('../src/db');
async function run() {
  try {
    const [at] = await db.query('SELECT * FROM capex_master_asset_type WHERE asset_name LIKE "%tool%" OR asset_name LIKE "%IT%"');
    console.log(at);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
