import type { SerpFeature, SerpData, OrganicResult, AnswerBox, PeopleAlsoAsk, RelatedSearch, AiOverview, LocalResult, VideoResult, KnowledgeGraph, SerpMetadata, PageHeaders } from '../src/types';

export function textualizeSerpFeatures(
  feature: SerpFeature,
  data: SerpData,
  featureData: OrganicResult | AnswerBox | PeopleAlsoAsk | RelatedSearch | AiOverview | LocalResult | VideoResult | KnowledgeGraph,
  metadata: SerpMetadata,
  headers?: PageHeaders,
  index?: number
): string {
  const { iso_date, serp_features, cluster } = metadata;
  const query = data.searchParameters.q;

  switch (feature) {
    case 'organic': {
      const organic = featureData as OrganicResult;
      const parts: string[] = [];
      parts.push(`Query: ${query}`);
      parts.push(`SERP Date: ${iso_date}`);
      parts.push(`SERP Features: ${serp_features.join(', ')}`);
      parts.push(`Cluster: ${cluster}`);
      parts.push(`Result Type: Organic`);
      parts.push(`Position: ${organic.position}`);
      parts.push(`Domain: ${metadata.domain || ''}`);
      parts.push(`URL Categories: ${(metadata.categories || []).join('/')}`);
      parts.push(`Title: ${organic.title}`);
      parts.push(`Snippet: ${organic.snippet}`);
      if (organic.date) parts.push(`Published Date: ${organic.date}`);
      parts.push(`URL: ${organic.link}`);
      if (headers?.h1) parts.push(`Page H1: ${headers.h1}`);
      if (headers?.h2 && headers.h2.length > 0) parts.push(`Page H2: ${headers.h2.join('; ')}`);
      if (headers?.h3 && headers.h3.length > 0) parts.push(`Page H3: ${headers.h3.join('; ')}`);
      return parts.join('\n');
    }

    case 'answerBox': {
      const answerBox = featureData as AnswerBox;
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: Answer Box\nTitle: ${answerBox.title}\nAnswer: ${answerBox.answer}\nSnippet: ${answerBox.snippet}\nSource URL: ${answerBox.link}`;
    }

    case 'peopleAlsoAsk': {
      const paa = featureData as PeopleAlsoAsk;
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: People Also Ask\nPosition in PAA: ${index! + 1}\nQuestion: ${paa.question}${paa.snippet ? '\nAnswer Snippet: ' + paa.snippet : ''}${paa.link ? '\nSource URL: ' + paa.link : ''}`;
    }

    case 'relatedSearches': {
      const rs = featureData as RelatedSearch;
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: Related Search\nPosition: ${index! + 1}\nSuggested Query: ${rs.query}`;
    }

    case 'aiOverview': {
      const ai = featureData as AiOverview;
      const sources = ai.sourceLinks ? ai.sourceLinks.map(s => `${s.title}: ${s.link}`).join('; ') : '';
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: AI Overview\nAnswer: ${ai.answer}${sources ? '\nSources: ' + sources : ''}`;
    }

    case 'localResults': {
      const lr = featureData as LocalResult;
      const tags = lr.tags ? lr.tags.join(', ') : '';
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: Local Result\nPosition: ${lr.position}\nBusiness Name: ${lr.title}\nAddress: ${lr.address}\nRating: ${lr.rating}\nReviews: ${lr.reviews}${tags ? '\nTags: ' + tags : ''}`;
    }

    case 'videoResults': {
      const vr = featureData as VideoResult;
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: Video\nPosition: ${index! + 1}\nTitle: ${vr.title}\nDuration: ${vr.duration}${vr.link ? '\nURL: ' + vr.link : ''}`;
    }

    case 'knowledgeGraph': {
      const kg = featureData as KnowledgeGraph;
      return `Query: ${query}\nSERP Date: ${iso_date}\nSERP Features: ${serp_features.join(', ')}\nCluster: ${cluster}\nResult Type: Knowledge Graph\nTitle: ${kg.title}\nType: ${kg.type || 'N/A'}\nDescription: ${kg.description || 'N/A'}${kg.website ? '\nWebsite: ' + kg.website : ''}`;
    }

    default:
      throw new Error(`Unknown feature: ${feature}`);
  }
}