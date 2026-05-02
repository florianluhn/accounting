import Database from 'better-sqlite3';
const db = new Database('data/accounting.db');
const tables = db.prepare("PRAGMA table_info('attachments')").all();
console.log(tables);
