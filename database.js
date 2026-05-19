const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite');

db.run(`
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  bank INTEGER DEFAULT 0,
  lastDaily INTEGER DEFAULT 0
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS server_bank (
  id INTEGER PRIMARY KEY,
  balance INTEGER DEFAULT 0
)
`);

db.run(`INSERT OR IGNORE INTO server_bank (id, balance) VALUES (1, 0)`);

function addUser(id) {
  db.run(`INSERT OR IGNORE INTO users (userId) VALUES (?)`, [id]);
}

module.exports = { db, addUser };