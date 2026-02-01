import { readFile } from 'fs/promises';
import { join } from 'path';
import { upsertProcessedEntries } from '../src/vectorStore';
import type { ProcessedEntry } from '../src/types';

const BATCH_SIZE = 100;

async function loadEntries(): Promise<ProcessedEntry[]> {
  const filePath = join(process.cwd(), 'assets', 'processed.json');
  const raw = await readFile(filePath, 'utf-8');
  const entries = JSON.parse(raw) as ProcessedEntry[];
  // Filter unique entries by id to avoid upsert conflicts
  const uniqueEntries = entries.filter((entry, index, self) => 
    self.findIndex(e => e.id === entry.id) === index
  );
  return uniqueEntries;
}

async function seedVectorStore() {
  const entries = await loadEntries();
  if (entries.length === 0) {
    console.log('No entries found in processed.json.');
    return;
  }

  console.log(`Seeding ${entries.length} entries into Supabase vector table.`);

  let total = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i +BATCH_SIZE);
    const inserted = await upsertProcessedEntries(batch);
    total += inserted;
    console.log(`Upserted ${total}/${entries.length} documents...`);
  }

  console.log('Vector store seeding complete.');
}

seedVectorStore().catch((err) => {
  console.error('Failed to seed vector store:', err);
  process.exit(1);
});

export { seedVectorStore };
