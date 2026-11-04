import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** AT-15 Backups can be restored and verified (runs the real ops scripts against the test database). */
describe('AT-15 backup and restore drill', () => {
  it('backs up, restores into a scratch database, and verifies integrity and row counts', () => {
    const ops = join(__dirname, '..', '..', '..', 'ops');
    const dir = mkdtempSync(join(tmpdir(), 'iketech-backup-'));
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL!,
      SOURCE_DATABASE_URL: process.env.DATABASE_URL!,
      ADMIN_DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL || 'postgresql://iketech:iketech_dev@localhost:5432/postgres',
      BACKUP_DIR: dir,
    };
    const file = execFileSync(join(ops, 'backup.sh'), { env, encoding: 'utf8' }).trim().split('\n').pop()!;
    expect(file).toMatch(/iketech-.*\.dump$/);
    const out = execFileSync(join(ops, 'restore-verify.sh'), [file], { env, encoding: 'utf8' });
    expect(out).toContain('RESTORE VERIFIED');
    expect(out).not.toContain('FAIL ');
  });
});
