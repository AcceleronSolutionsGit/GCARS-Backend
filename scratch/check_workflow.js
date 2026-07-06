const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'gcpl_cars'
  });
  try {
    const [cols] = await conn.query('DESCRIBE capex_request');
    const filtered = cols.filter(r => 
      /approver|level|step|finance|accountant/i.test(r.Field)
    );
    console.log('--- RELEVANT COLUMNS ---');
    console.log(filtered.map(f => f.Field));

    const [request] = await conn.query('SELECT * FROM capex_request WHERE id = 8807');
    console.log('\n--- REQUEST DATA (SELECTED) ---');
    if (request[0]) {
        const data = {};
        filtered.forEach(f => {
            data[f.Field] = request[0][f.Field];
        });
        console.log(data);
    }

    const [track] = await conn.query(`
        SELECT t.*, me.name 
        FROM capex_request_track t 
        LEFT JOIN capex_master_employee me ON me.emp_no = t.emp_no 
        WHERE t.capex_request_id = 8807
    `);
    console.log('\n--- TRACK DATA ---');
    console.log(track);

  } catch (err) {
    console.error(err);
  } finally {
    await conn.end();
  }
}
run();
