export function mapOrganic(o: Record<string, unknown>, index: number): Record<string, unknown> {
  return {
    ...o,
    position: o.position ?? index + 1,
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

export function normalizeSerperResponse(serperResp: Record<string, unknown>, cluster: string, query: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    searchParameters: { q: query, type: 'search', engine: 'google' },
    timestamp: new Date().toISOString(),
    cluster
  };

  // Map organic results
  if (Array.isArray(serperResp.organic)) {
    result.organic = (serperResp.organic as Record<string, unknown>[]).map((o, i) => mapOrganic(o, i));
  }

  // Map answer box
  if (serperResp.answerBox) {
    result.answerBox = mapAnswerBox(serperResp.answerBox as Record<string, unknown>);
  }

  // Map people also ask
  if (Array.isArray(serperResp.peopleAlsoAsk)) {
    result.peopleAlsoAsk = mapPeopleAlsoAsk(serperResp.peopleAlsoAsk as Record<string, unknown>[]);
  }

  // Map related searches
  if (Array.isArray(serperResp.relatedSearches)) {
    result.relatedSearches = mapRelatedSearches(serperResp.relatedSearches as Record<string, unknown>[]);
  }

  // Map AI overview
  if (serperResp.aiOverview) {
    result.aiOverview = mapAiOverview(serperResp.aiOverview as Record<string, unknown>);
  }

  // Map local results
  if (Array.isArray(serperResp.localResults)) {
    result.localResults = mapLocalResults(serperResp.localResults as Record<string, unknown>[]);
  }

  // Map video results
  if (Array.isArray(serperResp.videoResults)) {
    result.videoResults = mapVideoResults(serperResp.videoResults as Record<string, unknown>[]);
  }

  // Map knowledge graph
  if (serperResp.knowledgeGraph) {
    result.knowledgeGraph = mapKnowledgeGraph(serperResp.knowledgeGraph as Record<string, unknown>);
  }

  // Pass through images and news as-is
  if (Array.isArray(serperResp.images)) {
    result.images = serperResp.images;
  }

  if (Array.isArray(serperResp.news)) {
    result.news = serperResp.news;
  }

  return result;
}
