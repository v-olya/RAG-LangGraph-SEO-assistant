export function mapOrganic(o: Record<string, unknown>, index: number): Record<string, unknown> {
  const pos = +(o.position as number | string);
  return {
    ...o,
    position: (typeof pos === 'number' && !isNaN(pos) && pos > 0) ? pos : index + 1,
    date: o.date || o.published_at || null,
    sitelinks: o.sitelinks || []
  };
}

export function mapAnswerBox(ab: Record<string, unknown>) {
  return {
    ...ab,
    answer: ab.answer || ab.snippet || ''
  };
}

export function mapPeopleAlsoAsk(paa: Record<string, unknown>[]) {
  return paa.map((q) => ({
    ...q,
    link: q.link || null
  }));
}

export function mapRelatedSearches(rs: Record<string, unknown>[]) {
  return rs.map((r) => ({
    ...r
  }));
}

export function mapAiOverview(ai: Record<string, unknown>) {
  const sourceLinks = Array.isArray(ai.sourceLinks) ? ai.sourceLinks : [];
  return {
    ...ai,
    answer: ai.answer || ai.snippet || '',
    sourceLinks
  };
}

export function mapLocalResults(locs: Record<string, unknown>[]) {
  return locs.map((l, idx) => ({
    ...l,
    position: l.position ?? idx + 1,
    rating: l.rating ?? 0,
    reviews: l.reviews ?? 0,
    tags: Array.isArray(l.tags) ? l.tags : []
  }));
}

export function mapVideoResults(vr: Record<string, unknown>[]) {
  return vr.map((v) => ({
    ...v,
    title: v.title || v.snippet,
    link: v.link || v.url
  }));
}

export function mapKnowledgeGraph(kg: Record<string, unknown>) {
  return {
    ...kg,
    title: kg.title || kg.name
  };
}

export function detectFeatures(resp: Record<string, unknown>): string[] {
  const features: string[] = [];
  const arrayFeatures = [
    'organic',
    'peopleAlsoAsk',
    'relatedSearches',
    'localResults',
    'videoResults',
    'images',
    'news'
  ];
  const objectFeatures = ['knowledgeGraph', 'answerBox', 'aiOverview'];

  for (const feature of arrayFeatures) {
    const value = resp[feature];
    if (Array.isArray(value) && value.length > 0) {
      features.push(feature);
    }
  }

  for (const feature of objectFeatures) {
    if (resp[feature]) {
      features.push(feature);
    }
  }

  return features;
}

export function normalizeSerperResponse(serperResp: Record<string, unknown>, cluster: string, query: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {
    searchParameters: { q: query, type: 'search', engine: 'google' },
    timestamp: new Date().toISOString(),
    cluster
  };

  // Helpers to apply mappers when features are present
  const mapArrayIfPresent = <T>(key: string, mapper?: unknown) : void => {
    const val = serperResp[key];
    if (Array.isArray(val)) {
      if (typeof mapper === 'function') {
        result[key] = (mapper as unknown as Function)(val as unknown as T[]);
      } else {
        result[key] = val;
      }
    }
  };

  const mapObjectIfPresent = <T>(key: string, mapper?: unknown) : void => {
    const val = serperResp[key];
    if (val) {
      if (typeof mapper === 'function') {
        result[key] = (mapper as unknown as Function)(val as unknown as T);
      } else {
        result[key] = val;
      }
    }
  };

  // Map organic results
  if (Array.isArray(serperResp.organic)) {
    const organics = serperResp.organic as Record<string, unknown>[];
    // Check positions provided by SERP items
    const providedPositions = organics.map((o) => {
      const p = +(o.position as number | string);
      return (typeof p === 'number' && !isNaN(p) && p > 0) ? p : null;
    });

    const hasAnyProvided = providedPositions.some((p) => p !== null);
    const hasAnyMissing = providedPositions.some((p) => p === null);

    // If SERP provided some positions but left others missing, treat snapshot as invalid
    if (hasAnyProvided && hasAnyMissing) return null;

    // Otherwise normalize with the same mapper (uses index as fallback when needed)
    result.organic = organics.map(mapOrganic);
  }

  mapObjectIfPresent('answerBox', mapAnswerBox);
  mapArrayIfPresent('peopleAlsoAsk', mapPeopleAlsoAsk);
  mapArrayIfPresent('relatedSearches', mapRelatedSearches);
  mapObjectIfPresent('aiOverview', mapAiOverview);
  mapArrayIfPresent('localResults', mapLocalResults);
  mapArrayIfPresent('videoResults', mapVideoResults);
  mapObjectIfPresent('knowledgeGraph', mapKnowledgeGraph);
  mapArrayIfPresent('images');
  mapArrayIfPresent('news');

  return result;
}
