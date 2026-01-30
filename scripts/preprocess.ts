import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { slugify, decodeHTMLEntities } from '../utils/stringUtils';
import { extractCategories, extractDomain } from '../utils/urlUtils';
import { textualizeSerpFeatures } from '../utils/textUtils';
import { fetchHeadings } from '../utils/fetchUtils';

async function preprocess() {
  console.log('preprocess start');
  const baseAssets = join(process.cwd(), 'assets');
  const scrappedDir = join(baseAssets, 'scrapped');
  const assetsDir = scrappedDir;
  const files = await readdir(assetsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'clusters.json' && f !== 'processed.json');

  const entries = [];

  for (const file of jsonFiles) {
    const filePath = join(assetsDir, file);
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    if (!data.organic || !Array.isArray(data.organic)) {
      console.log(`Skipping ${file} as organic is not an array`);
      continue;
    }

    const isoDate = data.timestamp;
    const cluster = data.cluster || null;
    const slug = slugify(data.searchParameters && data.searchParameters.q ? data.searchParameters.q : '');
    const serpId = `${slug}_${isoDate}`;
    
    // Detect SERP features present
    const serpFeatures = [];
    if (data.organic && data.organic.length > 0) serpFeatures.push('organic');
    if (data.answerBox) serpFeatures.push('answerBox');
    if (data.peopleAlsoAsk && data.peopleAlsoAsk.length > 0) serpFeatures.push('peopleAlsoAsk');
    if (data.relatedSearches && data.relatedSearches.length > 0) serpFeatures.push('relatedSearches');
    if (data.aiOverview) serpFeatures.push('aiOverview');
    if (data.localResults && data.localResults.length > 0) serpFeatures.push('localResults');
    if (data.videoResults && data.videoResults.length > 0) serpFeatures.push('videoResults');
    if (data.knowledgeGraph) serpFeatures.push('knowledgeGraph');

    // Process organic results
    for (const organic of data.organic) {
      const categories = extractCategories(organic.link);
      const domain = extractDomain(organic.link);
      const headers = await fetchHeadings(organic.link);
      const entryId = `${slug}_${isoDate}_organic_${organic.position}`;
      
      const metadata = {
        type: 'organic',
        query: data.searchParameters.q,
        position: organic.position,
        iso_date: isoDate,
        categories,
        domain,
        cluster,
        serp_id: serpId,
        serp_features: serpFeatures
      };
      
      let text_blob = textualizeSerpFeatures('organic', data, organic, metadata, headers);
      text_blob = decodeHTMLEntities(text_blob);

      const entry = {
        id: entryId,
        text_blob,
        metadata
      };
      entries.push(entry);
    }

    // Process answerBox
    if (data.answerBox) {
      const answerBoxMetadata = {
        type: 'answerBox',
        query: data.searchParameters.q,
        iso_date: isoDate,
        cluster,
        serp_id: serpId,
        serp_features: serpFeatures
      };
      let text_blob = textualizeSerpFeatures('answerBox', data, data.answerBox, answerBoxMetadata);
      text_blob = decodeHTMLEntities(text_blob);
      const entryId = `${slug}_${isoDate}_answerBox`;
      const entry = {
        id: entryId,
        text_blob,
        metadata: {
          type: 'answerBox',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        }
      };
      entries.push(entry);
    }

    // Process peopleAlsoAsk
    if (data.peopleAlsoAsk) {
      for (let i = 0; i < data.peopleAlsoAsk.length; i++) {
        const paa = data.peopleAlsoAsk[i];
        const paaMetadata = {
          type: 'peopleAlsoAsk',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        };
        let text_blob = textualizeSerpFeatures('peopleAlsoAsk', data, paa, paaMetadata, undefined, i);
        text_blob = decodeHTMLEntities(text_blob);
        const entryId = `${slug}_${isoDate}_peopleAlsoAsk_${i + 1}`;
        const entry = {
          id: entryId,
          text_blob,
          metadata: {
            type: 'peopleAlsoAsk',
            query: data.searchParameters.q,
            iso_date: isoDate,
            cluster,
            serp_id: serpId,
            serp_features: serpFeatures
          }
        };
        entries.push(entry);
      }
    }

    // Process relatedSearches
    if (data.relatedSearches) {
      for (let i = 0; i < data.relatedSearches.length; i++) {
        const rs = data.relatedSearches[i];
        const rsMetadata = {
          type: 'relatedSearch',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        };
        let text_blob = textualizeSerpFeatures('relatedSearches', data, rs, rsMetadata, undefined, i);
        text_blob = decodeHTMLEntities(text_blob);
        const entryId = `${slug}_${isoDate}_relatedSearch_${i + 1}`;
        const entry = {
          id: entryId,
          text_blob,
          metadata: {
            type: 'relatedSearch',
            query: data.searchParameters.q,
            iso_date: isoDate,
            cluster,
            serp_id: serpId,
            serp_features: serpFeatures
          }
        };
        entries.push(entry);
      }
    }

    // Process aiOverview
    if (data.aiOverview) {
      const aiMetadata = {
        type: 'aiOverview',
        query: data.searchParameters.q,
        iso_date: isoDate,
        cluster,
        serp_id: serpId,
        serp_features: serpFeatures
      };
      let text_blob = textualizeSerpFeatures('aiOverview', data, data.aiOverview, aiMetadata);
      text_blob = decodeHTMLEntities(text_blob);
      const entryId = `${slug}_${isoDate}_aiOverview`;
      const entry = {
        id: entryId,
        text_blob,
        metadata: {
          type: 'aiOverview',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        }
      };
      entries.push(entry);
    }

    // Process localResults (if present)
    if (data.localResults) {
      for (const lr of data.localResults) {
        const lrMetadata = {
          type: 'localResult',
          query: data.searchParameters.q,
          position: lr.position,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        };
        let text_blob = textualizeSerpFeatures('localResults', data, lr, lrMetadata);
        text_blob = decodeHTMLEntities(text_blob);
        const entryId = `${slug}_${isoDate}_localResult_${lr.position}`;
        const entry = {
          id: entryId,
          text_blob,
          metadata: {
            type: 'localResult',
            query: data.searchParameters.q,
            position: lr.position,
            iso_date: isoDate,
            cluster,
            serp_id: serpId,
            serp_features: serpFeatures
          }
        };
        entries.push(entry);
      }
    }

    // Process videoResults (if present)
    if (data.videoResults) {
      for (let i = 0; i < data.videoResults.length; i++) {
        const vr = data.videoResults[i];
        const vrMetadata = {
          type: 'videoResult',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        };
        let text_blob = textualizeSerpFeatures('videoResults', data, vr, vrMetadata, undefined, i);
        text_blob = decodeHTMLEntities(text_blob);
        const entryId = `${slug}_${isoDate}_videoResult_${i + 1}`;
        const entry = {
          id: entryId,
          text_blob,
          metadata: {
            type: 'videoResult',
            query: data.searchParameters.q,
            iso_date: isoDate,
            cluster,
            serp_id: serpId,
            serp_features: serpFeatures
          }
        };
        entries.push(entry);
      }
    }

    // Process knowledgeGraph (if present)
    if (data.knowledgeGraph) {
      const kgMetadata = {
        type: 'knowledgeGraph',
        query: data.searchParameters.q,
        iso_date: isoDate,
        cluster,
        serp_id: serpId,
        serp_features: serpFeatures
      };
      let text_blob = textualizeSerpFeatures('knowledgeGraph', data, data.knowledgeGraph, kgMetadata);
      text_blob = decodeHTMLEntities(text_blob);
      const entryId = `${slug}_${isoDate}_knowledgeGraph`;
      const entry = {
        id: entryId,
        text_blob,
        metadata: {
          type: 'knowledgeGraph',
          query: data.searchParameters.q,
          iso_date: isoDate,
          cluster,
          serp_id: serpId,
          serp_features: serpFeatures
        }
      };
      entries.push(entry);
    }
  }

  return entries;
}

async function main() {
  const entries = await preprocess();
  console.log(`Total entries: ${entries.length}`);
  await writeFile(join(process.cwd(), 'assets', 'processed.json'), JSON.stringify(entries, null, 2));
}

// For testing, run and log
main().catch(console.error);

export { preprocess };