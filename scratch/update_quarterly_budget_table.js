const db = require('../src/db');
async function run() {
  try {
    await db.query("ALTER TABLE capex_quarterly_budget ADD COLUMN category ENUM('IT', 'Tools') NOT NULL DEFAULT 'IT' AFTER quarter");
    await db.query("ALTER TABLE capex_quarterly_budget DROP INDEX unique_quarter");
    await db.query("ALTER TABLE capex_quarterly_budget ADD UNIQUE KEY unique_quarter_category (year, quarter, category)");
    console.log("Database altered.");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
