/**
 * Apply startup migrations and exit. The server runs the same migrator on boot.
 */
import { saveDatabase } from '../src/server/db/connection.js';

await saveDatabase();
console.log('Migrations applied');
process.exit(0);
