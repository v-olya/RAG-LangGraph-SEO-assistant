import { z } from "zod";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { getVectorStore, getSupabaseClient } from "@/vectorStore";
import { INTENT_DETECTION } from "../constants";
import { cheapModel } from "./models";
import type { 
  ConversationMessage, 
  SearchIntentType, 
  TimeRange, 
  ClusterStats,
  SerpMetadata 
} from "../types";

export function normalizeClusterLabel(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim();
  if (cleaned.length === 0) return "";

  return cleaned
    .replace(/[-_]+/g, " ")
    .replace(/^(cluster|niche)[:\-\s]+/i, "")
    .replace(/(?:\s+|[-_]+)?(cluster|niche)$/i, "")
    .trim();
}

export async function extractTargetIntent(query: string, history?: ConversationMessage[]): Promise<string | null> {
  const intentSchema = z.object({
    targetIntent: z.enum(["informational", "navigational", "transactional", "null"]).describe("The specific intent the user wants to filter by, or 'null' if none."),
  });
  
  const parser = StructuredOutputParser.fromZodSchema(intentSchema);
  
  const historyContext: string = history && history.length > 0
    ? `\nConversation history for context:\n${history.map((m: ConversationMessage) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
    : "";

  const prompt = `Analyze if the user explicitly wants to filter results by a specific search intent by using intent-specific terminology.
  
  Query: "${query}"
  ${historyContext}
  
  Rules:
  - Return "transactional" ONLY if the user uses specific keywords: "transactional", "buy", "order", "purchase", "commercial intent".
  - Return "informational" ONLY if the user uses specific keywords: "informational", "guide", "tutorial", "how-to".
  - Return "navigational" ONLY if the user uses specific keywords: "navigational", "official site", "brand search".
  - Return "null" for all other cases, even if the topic has an obvious intent (e.g., "recipe" implies informational, but if the word "informational" or "guide" isn't used, return "null").
  
  Goal: Only return an intent if the user is using it as an explicit technical filter.
  
  ${parser.getFormatInstructions()}
  `;
  
  try {
      const response = await cheapModel.invoke(prompt);
      const parsed = await parser.parse(response.content as string);
      return parsed.targetIntent === "null" ? null : parsed.targetIntent;
  } catch {
      return null;
  }
}

export async function applyIntentFilterToItems<T>({
  query,
  providedIntent,
  items,
  toIntentItem,
}: {
  query?: string;
  providedIntent?: string;
  items: T[];
  // eslint-disable-next-line no-unused-vars
  toIntentItem: (_: T) => { domain?: string; position?: number; snippet?: string };
}): Promise<{
  resolvedIntent: { intent: SearchIntentType; confidence: "low" | "medium" | "high" };
  filteredItems: T[];
  intentFilterApplied: boolean;
  filteredOutCount: number;
}> {
  const resolvedIntent = await resolveSearchIntent(query, providedIntent);
  const intentFilter = await filterItemsByIntent({
    query,
    intent: resolvedIntent.intent,
    items: items.map((item: T, index: number) => ({
      index,
      ...toIntentItem(item),
    })),
  });

  const filteredItems: T[] = intentFilter.keepIndices
    ? items.filter((_: T, idx: number) => intentFilter.keepIndices?.has(idx))
    : items;

  const filteredOutCount = items.length - filteredItems.length;

  return {
    resolvedIntent,
    filteredItems,
    intentFilterApplied: intentFilter.keepIndices !== null,
    filteredOutCount,
  };
}

export function normalizeSearchIntent(intent?: string): SearchIntentType | null {
  if (!intent) return null;
  const normalized = intent.trim().toLowerCase();
  if (normalized.startsWith("info")) return "informational";
  if (normalized.startsWith("nav")) return "navigational";
  if (normalized.startsWith("trans")) return "transactional";
  if (normalized.startsWith("comm") || normalized.includes("investig")) return "transactional";
  if (normalized.startsWith("local")) return "transactional";
  if (normalized.startsWith("unknown")) return "unknown";
  return null;
}

export async function resolveSearchIntent(
  query?: string,
  providedIntent?: string
): Promise<{ intent: SearchIntentType; confidence: "low" | "medium" | "high" }> {
  const normalized = normalizeSearchIntent(providedIntent);
  if (normalized) {
    return { intent: normalized, confidence: "high" };
  }

  if (!query || query.trim().length === 0) {
    return { intent: "unknown", confidence: "low" };
  }

  return detectSearchIntent(query);
}

export async function detectSearchIntent(
  query: string
): Promise<{ intent: SearchIntentType; confidence: "low" | "medium" | "high" }> {
  const SearchIntent = z.enum(["informational", "navigational", "transactional", "unknown"]);
  const intentSchema = z.object({
    intent: SearchIntent,
    confidence: z.enum(["low", "medium", "high"]),
    rationale: z.string().optional(),
  });

  const intentParser = StructuredOutputParser.fromZodSchema(intentSchema);

  const prompt = `Classify the search intent for this query.
Use one of: informational, navigational, transactional, unknown.

Definitions:
- informational: user seeks knowledge, explanations, or how-to
- navigational: user wants a specific site or brand
- transactional: user wants to buy, order, subscribe, or download
- unknown: cannot infer intent

Query: "${query}"

${intentParser.getFormatInstructions()}`;

  try {
    const response = await cheapModel.invoke(prompt);
    const parsed = await intentParser.parse(response.content as string);
    return { intent: parsed.intent as SearchIntentType, confidence: parsed.confidence };
  } catch {
    return { intent: "unknown", confidence: "low" };
  }
}

export async function filterItemsByIntent({
  query,
  intent,
  items,
}: {
  query?: string;
  intent: SearchIntentType;
  items: Array<{ index: number; domain?: string; position?: number; snippet?: string }>;
}): Promise<{ keepIndices: Set<number> | null }> {
  if (!query || intent === "unknown" || items.length === 0) {
    return { keepIndices: null };
  }

  const filterSchema = z.object({
    keep: z.array(z.number()).describe("1-based indices to keep"),
    reason: z.string().optional(),
  });

  const filterParser = StructuredOutputParser.fromZodSchema(filterSchema);

  const prompt = `${INTENT_DETECTION}
Detected intent: ${intent}
Query: "${query}"

Select which items match the intent. Only include items that match.
If unsure, include the item.

Return JSON: {"keep":[1,2,3]}

Items:
${items
  .map((item: { domain?: string; position?: number; snippet?: string }, i: number) => {
    const position = item.position ? ` (pos ${item.position})` : "";
    const snippet = item.snippet ? `: ${item.snippet}` : "";
    return `${i + 1}. ${item.domain || "unknown"}${position}${snippet}`;
  })
  .join("\n")}

${filterParser.getFormatInstructions()}`;

  try {
    const response = await cheapModel.invoke(prompt);
    const parsed = await filterParser.parse(response.content as string);
    const keepIndices = new Set<number>();
    for (const index of parsed.keep || []) {
      if (Number.isInteger(index) && index >= 1 && index <= items.length) {
        keepIndices.add(index - 1);
      }
    }
    return { keepIndices };
  } catch {
    return { keepIndices: null };
  }
}

export async function extractClusterHint(query: string, history?: ConversationMessage[]): Promise<string> {
  const hintSchema = z.object({
    cluster: z.string().optional(),
  });
  const hintParser = StructuredOutputParser.fromZodSchema(hintSchema);

  const historyContext: string = history && history.length > 0
    ? `\nConversation history for context:\n${history.map((m: ConversationMessage) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
    : "";

  const prompt = `Extract the explicit cluster or niche name if the user mentions one or refers to one from previous context.
- Return only the cluster name (no extra words like "cluster" or "niche").
- Treat hyphenated (e.g., "pizza-cluster") as references to the cluster word (e.g., "pizza").
- If the current query is ambiguous (e.g., "and what about transactional?") or uses reference words (e.g., "it", "that"), use the conversation history to identify the cluster being discussed.
- Return an empty string ONLY if no cluster or niche is mentioned or implied by context.

Query: "${query}"
${historyContext}

${hintParser.getFormatInstructions()}`;

  try {
    const response = await cheapModel.invoke(prompt);
    const parsed = await hintParser.parse(response.content as string);
    return normalizeClusterLabel(parsed.cluster);
  } catch {
    return "";
  }
}

export async function detectClusterFromQuery(query: string, minSimilarityScore = 0.8, history?: ConversationMessage[]): Promise<string> {
  const clusterHint = await extractClusterHint(query, history);
  if (clusterHint) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("seo_documents")
      .select("metadata")
      .eq("metadata->>cluster", clusterHint)
      .limit(1);

    if (!error && data && data.length > 0) {
      return clusterHint;
    }
  }

  const vectorStore = await getVectorStore();
  const clusterSearch = await vectorStore.similaritySearchWithScore(query, 1);
  
  if (clusterSearch.length > 0) {
    const [doc, score] = clusterSearch[0];
    if (score >= minSimilarityScore) {
      return doc.metadata.cluster || "";
    }
  }
  
  return "";
}

export async function getFilteredDocsAndContext(
  query: string,
  docs: Document[],
): Promise<{ docs: Document[], context: string }> {
  const targetIntent = await extractTargetIntent(query);
  
  if (targetIntent) {
    const { filteredItems, resolvedIntent } = await applyIntentFilterToItems({
      query: query,
      providedIntent: targetIntent,
      items: docs,
      toIntentItem: (doc: Document) => ({
        domain: doc.metadata.domain as string | undefined,
        position: doc.metadata.position as number | undefined,
        snippet: (doc.pageContent?.substring(0, 150) || "") as string,
      }),
    });
    
    return {
      docs: filteredItems,
      context: `\n## INTENT FILTER\nDetected intent: ${resolvedIntent.intent}\nUse only the provided data (already filtered by intent) in your analysis.`
    };
  }

  return { docs, context: "" };
}

export function computeClusterStats(docs: Document[]): ClusterStats {
  const serpFeatureFrequency = new Map<string, number>();
  const categoryPaths = new Map<string, number>();
  const domains = new Set<string>();
  let earliest = "";
  let latest = "";

  for (const doc of docs) {
    const meta = doc.metadata as SerpMetadata;

    if (meta.domain) {
      domains.add(meta.domain);
    }

    const features = meta.serp_features;
    if (features) {
      for (const feature of features) {
        serpFeatureFrequency.set(feature, (serpFeatureFrequency.get(feature) || 0) + 1);
      }
    }

    const categories = meta.categories;
    if (categories) {
      const path = categories.join(" > ");
      categoryPaths.set(path, (categoryPaths.get(path) || 0) + 1);
    }

    const isoDate = meta.iso_date;
    if (isoDate) {
      if (!earliest || isoDate < earliest) earliest = isoDate;
      if (!latest || isoDate > latest) latest = isoDate;
    }
  }

  return {
    totalDocs: docs.length,
    uniqueDomains: [...domains],
    serpFeatureFrequency,
    categoryPaths,
    dateRange: { earliest, latest },
  };
}

export function formatSerpFeatureStats(frequency: Map<string, number>): string {
  const total = [...frequency.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return "organic only";

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([feature, count]) => {
      const percentage = Math.round((count / total) * 100);
      return `${feature} (${percentage}%)`;
    })
    .join(", ");
}

export function getTopItems(map: Map<string, number>, n: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item]) => item);
}

export function formatCompetitiveLandscape(docs: Document[]): string {
  return docs
    .map((doc, i) => {
      const meta = doc.metadata;
      const position = meta.position || i + 1;
      const domain = meta.domain || "unknown";
      return `### Rank #${position} - ${domain}\n${doc.pageContent}`;
    })
    .join("\n\n---\n\n");
}

export function formatTemporalData(docs: Document[], periodLabel: string): string {
  if (docs.length === 0) {
    return `${periodLabel}: No data available`;
  }

  const formatted: string[] = docs.slice(0, 10).map((doc: Document) => {
    const meta = doc.metadata as SerpMetadata;
    return `[${meta.iso_date || "unknown date"}] Position ${meta.position || "?"} - ${meta.domain || "unknown"}
${doc.pageContent}`;
  });

  return `## ${periodLabel}
${formatted.join("\n\n")}`;
}

export async function detectTimeRanges(
  query: string,
): Promise<{ earlier: TimeRange; later: TimeRange }> {
  const client = getSupabaseClient();
  const { data: dateRange } = await client
    .from("seo_documents")
    .select("metadata->iso_date")
    .order("metadata->iso_date", { ascending: true })
    .limit(1);

  const { data: latestDate } = await client
    .from("seo_documents")
    .select("metadata->iso_date")
    .order("metadata->iso_date", { ascending: false })
    .limit(1);

  const earliestInDb = (dateRange as { iso_date: string }[] | null)?.[0]?.iso_date || "2000-01-01";
  const latestInDb = (latestDate as { iso_date: string }[] | null)?.[0]?.iso_date || new Date().toISOString().split("T")[0];

  const timeExtractionSchema = z.object({
    hasTimeReference: z.boolean(),
    earlierPeriod: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
    laterPeriod: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
  });
  const timeParser = StructuredOutputParser.fromZodSchema(timeExtractionSchema);
  const prompt = `Extract time periods from this SEO query. Today is ${new Date().toISOString().split("T")[0]}.
Available data range: ${earliestInDb} to ${latestInDb}
Query: "${query}"
${timeParser.getFormatInstructions()}`;

  try {
    const response = await cheapModel.invoke(prompt);
    const extracted = await timeParser.parse(response.content as string);
    if (extracted.hasTimeReference && extracted.earlierPeriod && extracted.laterPeriod) {
      return { earlier: extracted.earlierPeriod, later: extracted.laterPeriod };
    }
  } catch {
    // Fall back to default split
  }

  const midpoint = new Date((new Date(earliestInDb).getTime() + new Date(latestInDb).getTime()) / 2);
  return {
    earlier: { start: earliestInDb, end: midpoint.toISOString().split("T")[0] },
    later: { start: midpoint.toISOString().split("T")[0], end: latestInDb },
  };
}

export function extractCommonHeaders(docs: Document[]): string {
  const headerPatterns: string[] = [];
  for (const doc of docs) {
    const metadata = doc.metadata as SerpMetadata;
    const h1 = metadata.h1;
    const h2s = metadata.h2;
    if (h1) headerPatterns.push(h1);
    if (h2s) headerPatterns.push(...h2s);
  }
  if (headerPatterns.length === 0) return "How to guides, Best of lists";
  
  const frequency: Map<string, number> = new Map<string, number>();
  for (const header of headerPatterns) {
    const normalized: string = normalizeHeaderToPattern(header);
    frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
  }
  return [...frequency.entries()].sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0, 5).map(([h]: [string, number]) => h).join(", ");
}

export function normalizeHeaderToPattern(header: string): string {
  const lower = header.toLowerCase();
  if (lower.includes("how to")) return "How to guides";
  if (lower.includes("best") || lower.includes("top")) return "Best of lists";
  if (lower.includes("step")) return "Step-by-step tutorials";
  if (lower.includes("guide")) return "Comprehensive guides";
  return header.slice(0, 50);
}
