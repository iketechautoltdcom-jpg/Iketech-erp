import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
// Minimal .env loader (no extra dependency). Real environment variables always win.
const file = join(__dirname, '..', '..', '.env');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
