import './loadEnv.js';
import { closeDb, getDb } from '../api/_lib/db.js';
import { ensureIndexes } from '../api/_lib/indexes.js';
import { seedCategories } from '../api/_lib/seed.js';

async function main(): Promise<void> {
  const db = await getDb();
  console.log(`Connected to database "${db.databaseName}".`);
  const indexes = await ensureIndexes(db);
  indexes.forEach((name) => console.log(`  index ok: ${name}`));
  const inserted = await seedCategories(db);
  console.log(`Categories seeded (new: ${inserted}).`);
  console.log('Database setup complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Database setup failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
