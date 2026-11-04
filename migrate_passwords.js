/**
 * migrate_passwords.js
 * ─────────────────────────────────────────────────────────────
 * One-shot utility: finds every user whose stored password is
 * NOT a bcrypt hash and hashes it in-place.
 *
 * Run once from the backend/ folder:
 *   node migrate_passwords.js
 * ─────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'gcpl_cars',
  });

  console.log('✅ Connected to', process.env.DB_NAME || 'gcpl_cars');

  const [users] = await conn.execute('SELECT id, username, password FROM users');
  console.log(`Found ${users.length} total users.\n`);

  let migrated = 0;
  let skipped  = 0;

  for (const u of users) {
    const isBcrypt = u.password && u.password.startsWith('$2');
    if (isBcrypt) {
      skipped++;
      continue; // already hashed, skip
    }

    // Plain-text password — hash it now
    const plainText = u.password || 'password'; // fallback if null/empty
    const hashed    = await bcrypt.hash(plainText, 10);
    await conn.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashed, u.id]
    );
    console.log(`  ✔ Migrated: ${u.username} (id=${u.id})`);
    migrated++;
  }

  await conn.end();

  console.log('\n─────────────────────────────────────────────');
  console.log(`  Migrated : ${migrated} user(s)`);
  console.log(`  Skipped  : ${skipped} (already hashed)`);
  console.log('─────────────────────────────────────────────');
  console.log('\nAll plain-text passwords have been hashed. ✅');
})().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
