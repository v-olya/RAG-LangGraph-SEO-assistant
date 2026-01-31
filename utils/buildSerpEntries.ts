import { slugify, decodeHTMLEntities } from './stringUtils';
import { extractCategories, extractDomain } from './urlUtils';
import { textualizeSerpFeatures } from './textUtils';
import { fetchHeadings } from './fetchUtils';
import { detectFeatures } from './normalizeResponse';
import type { SerpData, ProcessedEntry, SerpMetadata } from '../src/types';

function baseMetadata(
  data: SerpData,
  isoDate: string,
  cluster: string | undefined | null,
  serpId: string,
  serpFeatures: string[],
  overrides: Partial<SerpMetadata> = {}
): SerpMetadata {
  return {
    query: data.searchParameters.q,
    iso_date: isoDate,
    cluster: cluster ?? null,
    serp_id: serpId,
    serp_features: serpFeatures,
    type: '', // default, will be overridden
    domain: '',
    categories: [],
    ...overrides
  };
}

export async function buildSerpEntries(data: SerpData): Promise<ProcessedEntry[]> {
  const entries: ProcessedEntry[] = [];
  const isoDate = data.timestamp;
  const cluster = data.cluster ?? null;
  const querySlug = slugify(data.searchParameters?.q ?? '');
  const serpId = `${querySlug}_${isoDate}`;
  const serpFeatures = detectFeatures(data as unknown as Record<string, unknown>);

  if (Array.isArray(data.organic)) {
    for (const organic of data.organic) {
      if (!organic.link) continue;
      const categories = extractCategories(organic.link);
      const domain = extractDomain(organic.link);
      const headers = await fetchHeadings(organic.link);

      const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
        type: 'organic',
        position: organic.position,
        categories,
        domain
      });

      const textBlob = decodeHTMLEntities(
        textualizeSerpFeatures('organic', data, organic, metadata, headers)
      );

      entries.push({
        id: `${querySlug}_${isoDate}_organic_${organic.position}`,
        text_blob: textBlob,
        metadata
      });
    }
  }

  if (data.answerBox) {
    const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
      type: 'answerBox'
    });

    const textBlob = decodeHTMLEntities(
      textualizeSerpFeatures('answerBox', data, data.answerBox, metadata)
    );

    entries.push({
      id: `${querySlug}_${isoDate}_answerBox`,
      text_blob: textBlob,
      metadata
    });
  }

  if (Array.isArray(data.peopleAlsoAsk)) {
    for (let i = 0; i < data.peopleAlsoAsk.length; i++) {
      const paa = data.peopleAlsoAsk[i];
      const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
        type: 'peopleAlsoAsk'
      });

      const textBlob = decodeHTMLEntities(
        textualizeSerpFeatures('peopleAlsoAsk', data, paa, metadata, undefined, i)
      );

      entries.push({
        id: `${querySlug}_${isoDate}_peopleAlsoAsk_${i + 1}`,
        text_blob: textBlob,
        metadata
      });
    }
  }

  if (Array.isArray(data.relatedSearches)) {
    for (let i = 0; i < data.relatedSearches.length; i++) {
      const rs = data.relatedSearches[i];
      const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
        type: 'relatedSearch'
      });

      const textBlob = decodeHTMLEntities(
        textualizeSerpFeatures('relatedSearches', data, rs, metadata, undefined, i)
      );

      entries.push({
        id: `${querySlug}_${isoDate}_relatedSearch_${i + 1}`,
        text_blob: textBlob,
        metadata
      });
    }
  }

  if (data.aiOverview) {
    const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
      type: 'aiOverview'
    });

    const textBlob = decodeHTMLEntities(
      textualizeSerpFeatures('aiOverview', data, data.aiOverview, metadata)
    );

    entries.push({
      id: `${querySlug}_${isoDate}_aiOverview`,
      text_blob: textBlob,
      metadata
    });
  }

  if (Array.isArray(data.localResults)) {
    for (const localResult of data.localResults) {
      const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
        type: 'localResult',
        position: localResult.position
      });

      const textBlob = decodeHTMLEntities(
        textualizeSerpFeatures('localResults', data, localResult, metadata)
      );

      entries.push({
        id: `${querySlug}_${isoDate}_localResult_${localResult.position}`,
        text_blob: textBlob,
        metadata
      });
    }
  }

  if (Array.isArray(data.videoResults)) {
    for (let i = 0; i < data.videoResults.length; i++) {
      const videoResult = data.videoResults[i];
      const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
        type: 'videoResult'
      });

      const textBlob = decodeHTMLEntities(
        textualizeSerpFeatures('videoResults', data, videoResult, metadata, undefined, i)
      );

      entries.push({
        id: `${querySlug}_${isoDate}_videoResult_${i + 1}`,
        text_blob: textBlob,
        metadata
      });
    }
  }

  if (data.knowledgeGraph) {
    const metadata = baseMetadata(data, isoDate, cluster, serpId, serpFeatures, {
      type: 'knowledgeGraph'
    });

    const textBlob = decodeHTMLEntities(
      textualizeSerpFeatures('knowledgeGraph', data, data.knowledgeGraph, metadata)
    );

    entries.push({
      id: `${querySlug}_${isoDate}_knowledgeGraph`,
      text_blob: textBlob,
      metadata
    });
  }

  return entries;
}
