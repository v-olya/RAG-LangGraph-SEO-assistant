import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { normalizeSerperResponse } from '../utils/normalizeResponse';
import type { SerpData } from '../src/types';
import { sleep } from '../utils/fetchUtils';

async function callSerper(query: string, apiKey: string) {
  const endpoint = 'https://google.serper.dev/search';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: query })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Serper API ${res.status}: ${text}`);
  }
  return await res.json();
}

async function run() {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error('Missing SERPER_API_KEY env var. Set it and try again.');
    process.exit(1);
  }

  const base = join(process.cwd(), 'assets');
  const clustersRaw = await readFile(join(base, 'clusters.json'), 'utf-8');
  const clusters = JSON.parse(clustersRaw) as Record<string, string[]>;
  const scrappedDir = join(base, 'scrapped');
  const files = await readdir(scrappedDir);
  const existingNumbers = files
    .map(f => { const m = f.match(/^(\d+)\.json$/); return m ? Number(m[1]) : null; })
    .filter(n => n !== null) as number[];
  let nextIndex = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;

  console.log(`Starting Serper queries for ${Object.keys(clusters).length} clusters`);

  for (const [cluster, queries] of Object.entries(clusters)) {
    for (const q of queries) {
      console.log(`Querying: "${q}" (cluster: ${cluster})`);
      try {
        const serperResp = await callSerper(q, apiKey) as SerpData;

        const normalized = normalizeSerperResponse(serperResp as unknown as Record<string, unknown>, cluster, q);

        if (normalized == null) {
          console.log(`- Skipping save for query "${q}" (inconsistent organic positions)`);
          await sleep(600);
          continue;
        }

        const fileName = `${nextIndex}.json`;
        await writeFile(join(scrappedDir, fileName), JSON.stringify(normalized, null, 2));
        console.log(`✓ Saved ${fileName} for query: "${q}"`);
        nextIndex++;

        await sleep(600);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`✗ Failed for query "${q}": ${errorMsg}`);
      }
    }
  }

  console.log('Done.');
}

run().catch((err: unknown) => { 
  console.error(err); 
  process.exit(1); 
});

export { run };
