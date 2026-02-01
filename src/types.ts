export type SerpFeature = 'organic' | 'answerBox' | 'peopleAlsoAsk' | 'relatedSearches' | 'aiOverview' | 'localResults' | 'videoResults' | 'knowledgeGraph' | 'images' | 'news';

export interface SerpData {
  searchParameters: { q: string };
  timestamp: string;
  cluster?: string;
  organic?: OrganicResult[];
  answerBox?: AnswerBox;
  peopleAlsoAsk?: PeopleAlsoAsk[];
  relatedSearches?: RelatedSearch[];
  aiOverview?: AiOverview;
  localResults?: LocalResult[];
  videoResults?: VideoResult[];
  knowledgeGraph?: KnowledgeGraph;
  images?: ImageResult[];
  news?: NewsResult[];
}

export interface OrganicResult {
  position: number;
  title?: string;
  snippet?: string;
  link?: string;
  date?: string;
}

export interface AnswerBox {
  title: string;
  answer: string;
  snippet: string;
  link: string;
}

export interface PeopleAlsoAsk {
  question: string;
  snippet?: string;
  link?: string;
}

export interface RelatedSearch {
  query: string;
}

export interface AiOverview {
  answer: string;
  sourceLinks?: { title: string; link: string }[];
}

export interface LocalResult {
  position: number;
  title: string;
  address: string;
  rating: number;
  reviews: number;
  tags?: string[];
}

export interface VideoResult {
  title: string;
  duration: string;
  link?: string;
}

export interface KnowledgeGraph {
  title: string;
  type?: string;
  description?: string;
  website?: string;
}

export interface ImageResult {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  source: string;
  domain: string;
  link: string;
  googleUrl: string;
  position: number;
}

export interface NewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source: string;
}

export interface SerpMetadata {
  iso_date: string;
  serp_features: string[];
  cluster: string | null;
  query: string;
  type: string;
  serp_id: string;
  position?: number;
  domain: string;
  categories: string[];
  h1?: string | null;
  h2?: string[];
  h3?: string[];
}

export interface PageHeaders {
  h1: string | null;
  h2: string[];
  h3: string[];
}

export interface SerperResponse {
  searchParameters: { q: string };
  organic?: OrganicResult[];
  answerBox?: AnswerBox;
  peopleAlsoAsk?: PeopleAlsoAsk[];
  relatedSearches?: RelatedSearch[];
  aiOverview?: AiOverview;
  localResults?: LocalResult[];
  videoResults?: VideoResult[];
  knowledgeGraph?: KnowledgeGraph;
  // Allow any other properties
  [key: string]: unknown;
}

export interface ProcessedEntry {
  id: string;
  text_blob: string;
  metadata: SerpMetadata;
}

// Types for the Agentic Workflow
export type QueryIntentType = "STANDARD" | "COMPARISON" | "STRATEGY";
export type SearchIntentType = "informational" | "navigational" | "transactional" | "unknown";

export interface TimeRange {
  start: string;
  end: string;
}

export interface ClusterStats {
  totalDocs: number;
  uniqueDomains: string[];
  serpFeatureFrequency: Map<string, number>;
  categoryPaths: Map<string, number>;
  dateRange: { earliest: string; latest: string };
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SEOGraphResponse {
  type: string;
  answer: string;
  cluster?: string;
  documents: { pageContent: string; metadata: Record<string, unknown> }[]; // langchain Document simplified for UI
  intent: QueryIntentType | null;
  searchIntent: SearchIntentType | null;
  explanation: string;
}

// Tool Argument Interfaces
export interface SearchByQueryArgs {
  searchQuery: string;
  limit?: number;
}

export interface GetTopPerformersArgs {
  cluster?: string;
  query?: string;
  limit?: number;
}

export interface GetSerpFeaturesArgs {
  cluster?: string;
  query?: string;
  feature?: string;
  limit?: number;
}

export interface GetClusterDataArgs {
  cluster: string;
  limit?: number;
}

export interface AnalyzeContentTypesArgs {
  cluster?: string;
  query?: string;
  intent?: string;
  positionThreshold?: number;
}