// One-off helper: prints a bcrypt hash to paste into sql/seed.sql.
// Usage: node src/utils/hashSeedPassword.js 'Lecturer#2026'
const bcrypt = require('bcrypt');

const plaintext = process.argv[2];
if (!plaintext) {
  console.error('Usage: node hashSeedPassword.js <password>');
  process.exit(1);
}

bcrypt.hash(plaintext, 12).then((hash) => {
  console.log(hash);
});
