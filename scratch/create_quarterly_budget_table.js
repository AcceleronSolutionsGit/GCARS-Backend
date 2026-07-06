const db = require('../src/db');
async function run() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS capex_quarterly_budget (
      id INT AUTO_INCREMENT PRIMARY KEY,
      year INT NOT NULL,
      quarter ENUM('Q1', 'Q2', 'Q3', 'Q4') NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_quarter (year, quarter)
    )`);
    console.log('Table created successfully.');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
