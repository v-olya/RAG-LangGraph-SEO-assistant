import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Document } from "@langchain/core/documents";
import { getVectorStore, getSupabaseClient } from "@/vectorStore";
import { INTENT_DETECTION } from "../constants";
import { model } from "./models";
import { 
  extractClusterHint, 
  detectClusterFromQuery, 
  normalizeClusterLabel,
  applyIntentFilterToItems
} from "./agenticTasks";
import type { 
  SerpMetadata, 
  SearchByQueryArgs,
  GetTopPerformersArgs,
  GetSerpFeaturesArgs,
  GetClusterDataArgs,
  AnalyzeContentTypesArgs,
  SearchIntentType
} from "../types";

export const searchByQueryTool = new DynamicStructuredTool({
  name: "search_by_query",
  description: "Search SEO documents by semantic similarity to a search query. Use this for general questions.",
  schema: z.object({
    searchQuery: z.string().describe("The search query to find relevant SEO data"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
  }),
  func: async ({ searchQuery, limit }: SearchByQueryArgs): Promise<string> => {
    const clusterHint = await extractClusterHint(searchQuery);
    if (clusterHint) {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from("seo_documents")
        .select("content, metadata")
        .eq("metadata->>cluster", clusterHint)
        .order("metadata->>position", { ascending: true })
        .limit(limit ?? 10);

      if (!error && data && data.length > 0) {
        return JSON.stringify(
          data.map((row: { content: string; metadata: Record<string, unknown> }) => {
            const metadata = row.metadata as unknown as SerpMetadata;
            return {
              content: row.content,
              position: metadata.position,
              domain: metadata.domain,
              cluster: metadata.cluster,
              serp_features: metadata.serp_features,
              date: metadata.iso_date,
            };
          })
        );
      }
    }

    const vectorStore = await getVectorStore();
    const docs = await vectorStore.similaritySearch(searchQuery, limit);
    return JSON.stringify(
      docs.map((d: Document) => {
        const metadata = d.metadata as unknown as SerpMetadata;
        return {
          content: d.pageContent,
          position: metadata.position,
          domain: metadata.domain,
          cluster: metadata.cluster,
          serp_features: metadata.serp_features,
          date: metadata.iso_date,
        };
      })
    );
  },
});

export const getTopPerformersTool = new DynamicStructuredTool({
  name: "get_top_performers",
  description: "Get top-ranking content (positions 1-3) for a specific cluster or query. Use this when user asks about 'best performing', 'top results', etc.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
  }),
  func: async ({ cluster, query, limit }: GetTopPerformersArgs): Promise<string> => {
    const client = getSupabaseClient();
    try {
      let results: Array<Record<string, unknown>> = [];
      const filterCluster = normalizeClusterLabel(cluster) || (query && (await detectClusterFromQuery(query))) || "";
      
      const dbQuery = client
        .from("seo_documents")
        .select("content, metadata")
        .lte("metadata->>position", 3)
        .gte("metadata->>position", 1)
        .order("metadata->>position", { ascending: true })
        .limit(limit || 10);

      if (filterCluster) {
        const { data, error } = await dbQuery.ilike("metadata->>cluster", `%${filterCluster}%`);
        if (error) throw new Error(error.message);
        results = (data || []).map((row: { content: string; metadata: Record<string, unknown> }) => ({
          content: row.content,
          ...(row.metadata as unknown as SerpMetadata),
        }));
      }

      if (results.length === 0 && query?.trim()) {
        const { data, error } = await client
          .from("seo_documents")
          .select("content, metadata")
          .lte("metadata->>position", 3)
          .gte("metadata->>position", 1)
          .ilike("metadata->>query", `%${query.trim()}%`)
          .order("metadata->>position", { ascending: true })
          .limit(limit || 10);
        
        if (error) throw new Error(error.message);
        results = (data || []).map((row: { content: string; metadata: Record<string, unknown> }) => ({
          content: row.content,
          ...(row.metadata as unknown as SerpMetadata),
        }));
      }

      if (results.length === 0) {
        return JSON.stringify({ warning: "No top-ranking snippets found.", results: [] });
      }

      return JSON.stringify(results);
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : "Unknown database error" });
    }
  },
});

export const getSerpFeaturesTool = new DynamicStructuredTool({
  name: "get_serp_features",
  description: "Get documents that have specific SERP features (videos, PAA, answer box, etc.) or list all SERP features for a cluster/query.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    feature: z.string().optional().describe("Filter by specific SERP feature (e.g., 'video', 'peopleAlsoAsk', 'answerBox')"),
    limit: z.number().optional().default(20).describe("Maximum number of results"),
  }),
  func: async ({ cluster, query, feature, limit }: GetSerpFeaturesArgs): Promise<string> => {
    const client = getSupabaseClient();
    
    // Normalize cluster label for consistent matching
    const resolvedCluster: string =
      normalizeClusterLabel(cluster) ||
      ((query && (await detectClusterFromQuery(query))) || "");

    let dbQuery = client
      .from("seo_documents")
      .select("content, metadata")
      .not("metadata->>serp_features", "eq", "[]")
      .limit(limit || 20);

    if (resolvedCluster) {
      dbQuery = dbQuery.ilike("metadata->>cluster", `%${resolvedCluster}%`);
    }
    if (query) {
      dbQuery = dbQuery.ilike("metadata->>query", `%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) return JSON.stringify({ error: error.message });

    let results = (data || []).map((row: { content: string; metadata: Record<string, unknown> }) => {
      const metadata = row.metadata as unknown as SerpMetadata;
      return {
        content: row.content,
        serp_features: metadata.serp_features,
        query: metadata.query,
        cluster: metadata.cluster,
        position: metadata.position,
      };
    });

    // Filter by specific feature if provided
    if (feature) {
      results = results.filter((r: { serp_features?: string[] }) =>
        r.serp_features?.some((f: string) => f.toLowerCase().includes((feature as string).toLowerCase()))
      );
    }

    // Also compute feature frequency
    const featureFrequency: Record<string, number> = {};
    for (const r of results) {
      for (const f of (r.serp_features || [])) {
        featureFrequency[f] = (featureFrequency[f] || 0) + 1;
      }
    }

    return JSON.stringify({
      feature_frequency: featureFrequency,
      sample_results: results.slice(0, 10),
    });
  },
});

export const getClusterDataTool = new DynamicStructuredTool({
  name: "get_cluster_data",
  description: "Get all data for a specific cluster including domains, positions, and aggregate stats.",
  schema: z.object({
    cluster: z.string().describe("The cluster name to get data for"),
    limit: z.number().optional().default(50).describe("Maximum number of results"),
  }),
  func: async ({ cluster, limit }: GetClusterDataArgs): Promise<string> => {
    const client = getSupabaseClient();
    
    // Normalize cluster label for consistent matching
    const resolvedCluster: string = normalizeClusterLabel(cluster) || cluster;
    
    const { data, error } = await client
      .from("seo_documents")
      .select("content, metadata")
      .ilike("metadata->>cluster", `%${resolvedCluster}%`)
      .order("metadata->>position", { ascending: true })
      .limit(limit || 50);

    if (error) return JSON.stringify({ error: error.message });

    const results: SerpMetadata[] = (data || []).map((row: { metadata: Record<string, unknown> }) => row.metadata as unknown as SerpMetadata);
    
    // Compute aggregate stats
    const domains: string[] = [...new Set(results.map((r: SerpMetadata) => r.domain))];
    const positions: number[] = results.map((r: SerpMetadata) => r.position).filter((p): p is number => typeof p === 'number');
    const avgPosition: number | null = positions.length > 0 
      ? positions.reduce((a: number, b: number) => a + b, 0) / positions.length 
      : null;

    return JSON.stringify({
      requested_cluster: cluster,
      total_results: results.length,
      unique_domains: domains,
      avg_position: avgPosition,
      sample_data: results.slice(0, 15),
    });
  },
});

export const analyzeContentTypesTool = new DynamicStructuredTool({
  name: "analyze_content_types",
  description: "Analyze what TYPES of content perform best (e.g., blog posts, product pages, guides, listicles, videos). Use this when user asks about content TYPE, format, or structure that ranks well. Can filter by cluster name or search query.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    intent: z.string().optional().describe("Optional: Search intent (informational, navigational, transactional)"),
    positionThreshold: z.number().optional().default(10).describe("Only analyze content ranking at or above this position"),
  }),
  func: async ({ cluster, query, intent, positionThreshold }: AnalyzeContentTypesArgs): Promise<string> => {
    const client = getSupabaseClient();
    
    const resolvedCluster: string =
      normalizeClusterLabel(cluster) ||
      cluster || 
      ((query && (await detectClusterFromQuery(query))) || "");

    let dbQuery = client
      .from("seo_documents")
      .select("content, metadata")
      .lte("metadata->>position", positionThreshold || 10)
      .order("metadata->>position", { ascending: true })
      .limit(100);

    if (resolvedCluster) {
      dbQuery = dbQuery.ilike("metadata->>cluster", `%${resolvedCluster}%`);
    }
    if (query) {
      dbQuery = dbQuery.ilike("metadata->>query", `%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) return JSON.stringify({ error: error.message });

    if (!data || data.length === 0) {
      return JSON.stringify({
        error: "No data found for analysis",
        filters_used: { cluster: resolvedCluster, query, positionThreshold }
      });
    }

    let filteredData = data;
    let resolvedIntent: { intent: SearchIntentType; confidence: "low" | "medium" | "high" } = { intent: "unknown", confidence: "low" };
    let intentFilterApplied = false;
    let filteredOutCount = 0;

    if (intent) {
      const filterResult = await applyIntentFilterToItems({
        query,
        providedIntent: intent,
        items: data,
        toIntentItem: (row: { content: string; metadata: Record<string, unknown> }) => ({
          domain: (row.metadata as unknown as SerpMetadata).domain as string,
          position: (row.metadata as unknown as SerpMetadata).position as number | undefined,
          snippet: row.content?.substring(0, 150) || "",
        }),
      });
      resolvedIntent = filterResult.resolvedIntent;
      filteredData = filterResult.filteredItems;
      intentFilterApplied = filterResult.intentFilterApplied;
      filteredOutCount = filterResult.filteredOutCount;

      if (!filteredData.length) {
        return JSON.stringify({
          error: "No results match the specified intent",
          intent: resolvedIntent.intent,
          intent_filter_applied: intentFilterApplied,
          filtered_out: filteredOutCount,
          filters_used: { cluster, query, intent, positionThreshold },
        });
      }
    }

    const intentInstructions = intentFilterApplied
      ? `\n${INTENT_DETECTION}\nDetected intent: ${resolvedIntent.intent}\nOnly include results that match this intent.`
      : "";

    const contentAnalysisPrompt: string = `Analyze these search results and categorize each by content type (e.g., Blog Post, Product Page, Guide, Video).
${intentInstructions}

Results:
${filteredData.map((row: { content: string; metadata: Record<string, unknown> }, i: number) => `
${i + 1}. ${(row.metadata as unknown as SerpMetadata).domain} (pos ${(row.metadata as unknown as SerpMetadata).position}):
${row.content?.substring(0, 1000)}`).join('\n\n')}

Return a JSON object with a key "content_type_analysis" containing a list of objects with:
- "content_type": The category
- "position": The rank
- "domain": The domain`;

    const analysisResponse = await model.invoke([
      { role: "system", content: "You are an SEO expert. Categorize results into clear content types. Return valid JSON." },
      { role: "user", content: contentAnalysisPrompt }
    ]);

    let analysisResult;
    try {
      const content = (analysisResponse.content as string).trim();
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        analysisResult = JSON.parse(content.substring(jsonStart, jsonEnd));
      } else {
        throw new Error();
      }
    } catch {
      return JSON.stringify({ 
        error: "Failed to parse content analysis", 
        raw_response: analysisResponse.content.toString().substring(0, 200) 
      });
    }

    const analyses = (analysisResult.content_type_analysis as Array<{
      content_type: string;
      position: number;
      domain: string;
    }>) || [];
    const contentTypes: Record<string, { count: number; positions: number[]; examples: string[] }> = {};

    for (const analysis of analyses) {
      const { content_type, position, domain } = analysis;
      if (!contentTypes[content_type]) {
        contentTypes[content_type] = { count: 0, positions: [], examples: [] };
      }
      contentTypes[content_type].count++;
      contentTypes[content_type].positions.push(position);
      if (contentTypes[content_type].examples.length < 1) {
        contentTypes[content_type].examples.push(`${domain} (pos ${position})`);
      }
    }

    const totalResults = analyses.length;
    const breakdown = Object.entries(contentTypes)
      .map(([type, typeData]) => ({
        content_type: type,
        count: typeData.count,
        percentage: Math.round((typeData.count / totalResults) * 100),
        avg_position: (typeData.positions.reduce((a, b) => a + b, 0) / typeData.positions.length).toFixed(1),
        top_3_count: typeData.positions.filter(p => p <= 3).length,
        examples: typeData.examples,
      }))
      .sort((a, b) => b.count - a.count);

    return JSON.stringify({
      summary: `Analyzed ${totalResults} top results`,
      content_type_breakdown: breakdown,
      intent: resolvedIntent.intent,
      intent_filter_applied: intentFilterApplied,
      filtered_out: filteredOutCount,
    });
  },
});

export const retrievalTools = [
  searchByQueryTool,
  getTopPerformersTool,
  getSerpFeaturesTool,
  getClusterDataTool,
  analyzeContentTypesTool,
];

export const modelWithTools = model.bindTools(retrievalTools);
