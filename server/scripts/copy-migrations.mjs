/**
 * Copies .sql migration files into dist/ after a TypeScript build.
 *
 * `tsc` only emits JavaScript - it ignores .sql files entirely. Without this
 * step a production container would contain the migration *runner* but none of
 * the migrations, and `npm run migrate:prod` would report "Database already up
 * to date" against an empty database. That failure is silent and destructive,
 * which is why this runs as part of the build rather than being a documented
 * manual step.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, '../src/db/migrations');
const to = path.resolve(here, '../dist/db/migrations');

await fs.mkdir(to, { recursive: true });

const files = (await fs.readdir(from)).filter((f) => f.endsWith('.sql'));
if (files.length === 0) {
  console.error('copy-migrations: no .sql files found in src/db/migrations - refusing to continue.');
  process.exit(1);
}

for (const file of files) {
  await fs.copyFile(path.join(from, file), path.join(to, file));
}

console.log(`copy-migrations: copied ${files.length} migration(s) to dist/db/migrations`);
