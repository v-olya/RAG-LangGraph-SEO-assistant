import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { buildSerpEntries } from '../utils/buildSerpEntries';
import type { SerpData, ProcessedEntry } from '../src/types';

async function preprocess() {
  console.log('preprocess start');
  const baseAssets = join(process.cwd(), 'assets');
  const scrappedDir = join(baseAssets, 'scrapped');
  const assetsDir = scrappedDir;
  const files = await readdir(assetsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'clusters.json' && f !== 'processed.json');

  const entries: ProcessedEntry[] = [];

  for (const file of jsonFiles) {
    const filePath = join(assetsDir, file);
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as SerpData;
    if (!data.organic || !Array.isArray(data.organic)) {
      console.log(`Skipping ${file} as organic is not an array`);
      continue;
    }

    const processed = await buildSerpEntries(data);
    entries.push(...processed);
  }

  return entries;
}

async function main() {
  const entries = await preprocess();
  console.log(`Total entries: ${entries.length}`);
  // Filter unique entries by id
  const uniqueEntries = entries.filter((entry, index, self) => 
    self.findIndex(e => e.id === entry.id) === index
  );
  console.log(`Unique entries: ${uniqueEntries.length}`);
  await writeFile(join(process.cwd(), 'assets', 'processed.json'), JSON.stringify(uniqueEntries, null, 2));
}

// For testing, run and log
main().catch(console.error);

export { preprocess };