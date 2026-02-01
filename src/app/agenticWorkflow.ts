import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { getVectorStore, getSupabaseClient } from "@/lib/vectorStore";
import {
  ROUTER_PROMPT_TEMPLATE,
  STRATEGY_SYSTEM_PROMPT,
  COMPARISON_SYSTEM_PROMPT,
  STANDARD_AGENT_PROMPT,
  INTENT_DETECTION,
} from "../constants";

// ============================================================================
// 1. Define the Graph State
// ============================================================================

const QueryIntent = z.enum(["STANDARD", "COMPARISON", "STRATEGY"]);
type QueryIntentType = z.infer<typeof QueryIntent>;

const SearchIntent = z.enum([
  "informational",
  "navigational",
  "transactional",
  "unknown",
]);
type SearchIntentType = z.infer<typeof SearchIntent>;

interface TimeRange {
  start: string;
  end: string;
}

interface ClusterStats {
  totalDocs: number;
  uniqueDomains: string[];
  serpFeatureFrequency: Map<string, number>;
  categoryPaths: Map<string, number>;
  dateRange: { earliest: string; latest: string };
}

const SEOGraphState = Annotation.Root({
  // Original user query
  query: Annotation<string>,

  // Conversation history for context
  conversationHistory: Annotation<Array<{ role: string; content: string }>>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Classified intent from the router
  intent: Annotation<QueryIntentType | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Router explanation for debugging
  routerExplanation: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  // Messages for tool-calling agent (STANDARD queries)
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // Retrieved documents from vector store
  documents: Annotation<Document[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Cluster name for strategy queries
  clusterName: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  // Detected time ranges for comparison queries
  timeRanges: Annotation<{ earlier: TimeRange; later: TimeRange } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Final answer from LLM
  answer: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),

  // Response type for the client
  responseType: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

type SEOState = typeof SEOGraphState.State;

// ============================================================================
// 2. Define Retrieval Tools for STANDARD queries
// ============================================================================

const searchByQueryTool = new DynamicStructuredTool({
  name: "search_by_query",
  description: "Search SEO documents by semantic similarity to a search query. Use this for general questions.",
  schema: z.object({
    searchQuery: z.string().describe("The search query to find relevant SEO data"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
  }),
  func: async ({ searchQuery, limit }) => {
    const vectorStore = await getVectorStore();
    const docs = await vectorStore.similaritySearch(searchQuery, limit);
    return JSON.stringify(docs.map(d => ({
      content: d.pageContent,
      position: d.metadata.position,
      domain: d.metadata.domain,
      cluster: d.metadata.cluster,
      serp_features: d.metadata.serp_features,
      date: d.metadata.iso_date,
    })));
  },
});

const getTopPerformersTool = new DynamicStructuredTool({
  name: "get_top_performers",
  description: "Get top-ranking content (positions 1-3) for a specific cluster or query. Use this when user asks about 'best performing', 'top results', etc.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    limit: z.number().optional().default(10).describe("Maximum number of results"),
  }),
  func: async ({ cluster, query, limit }) => {
    const client = getSupabaseClient();
    let dbQuery = client
      .from("seo_documents")
      .select("content, metadata")
      .lte("metadata->>position", 3)
      .gte("metadata->>position", 1)
      .order("metadata->>position", { ascending: true })
      .limit(limit || 10);

    if (cluster) {
      dbQuery = dbQuery.ilike("metadata->>cluster", `%${cluster}%`);
    }
    if (query) {
      dbQuery = dbQuery.ilike("metadata->>query", `%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) return JSON.stringify({ error: error.message });

    return JSON.stringify((data || []).map(row => ({
      content: row.content,
      ...row.metadata,
    })));
  },
});

const getSerpFeaturesTool = new DynamicStructuredTool({
  name: "get_serp_features",
  description: "Get documents that have specific SERP features (videos, PAA, answer box, etc.) or list all SERP features for a cluster/query.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    feature: z.string().optional().describe("Filter by specific SERP feature (e.g., 'video', 'peopleAlsoAsk', 'answerBox')"),
    limit: z.number().optional().default(20).describe("Maximum number of results"),
  }),
  func: async ({ cluster, query, feature, limit }) => {
    const client = getSupabaseClient();
    let dbQuery = client
      .from("seo_documents")
      .select("content, metadata")
      .not("metadata->>serp_features", "eq", "[]")
      .limit(limit || 20);

    if (cluster) {
      dbQuery = dbQuery.ilike("metadata->>cluster", `%${cluster}%`);
    }
    if (query) {
      dbQuery = dbQuery.ilike("metadata->>query", `%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) return JSON.stringify({ error: error.message });

    let results = (data || []).map(row => ({
      content: row.content,
      serp_features: row.metadata.serp_features,
      query: row.metadata.query,
      cluster: row.metadata.cluster,
      position: row.metadata.position,
    }));

    // Filter by specific feature if provided
    if (feature) {
      results = results.filter(r =>
        r.serp_features?.some((f: string) => f.toLowerCase().includes(feature.toLowerCase()))
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

const getClusterDataTool = new DynamicStructuredTool({
  name: "get_cluster_data",
  description: "Get all data for a specific cluster including domains, positions, and aggregate stats.",
  schema: z.object({
    cluster: z.string().describe("The cluster name to get data for"),
    limit: z.number().optional().default(50).describe("Maximum number of results"),
  }),
  func: async ({ cluster, limit }) => {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from("seo_documents")
      .select("content, metadata")
      .ilike("metadata->>cluster", `%${cluster}%`)
      .order("metadata->>position", { ascending: true })
      .limit(limit || 50);

    if (error) return JSON.stringify({ error: error.message });

    const results = (data || []).map(row => row.metadata);
    
    // Compute aggregate stats
    const domains = [...new Set(results.map(r => r.domain))];
    const positions = results.map(r => r.position).filter(Boolean);
    const avgPosition = positions.length > 0 
      ? positions.reduce((a, b) => a + b, 0) / positions.length 
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

const analyzeContentTypesTool = new DynamicStructuredTool({
  name: "analyze_content_types",
  description: "Analyze what TYPES of content perform best (e.g., blog posts, product pages, guides, listicles, videos). Use this when user asks about content TYPE, format, or structure that ranks well. Can filter by cluster name or search query.",
  schema: z.object({
    cluster: z.string().optional().describe("Optional: Filter by cluster name"),
    query: z.string().optional().describe("Optional: Filter by search query or topic"),
    intent: z.string().optional().describe("Optional: Search intent (informational, navigational, transactional)"),
    positionThreshold: z.number().optional().default(10).describe("Only analyze content ranking at or above this position"),
  }),
  func: async ({ cluster, query, intent, positionThreshold }) => {
    const client = getSupabaseClient();
    let dbQuery = client
      .from("seo_documents")
      .select("content, metadata")
      .lte("metadata->>position", positionThreshold || 10)
      .order("metadata->>position", { ascending: true })
      .limit(100); // Increased to 100 for comprehensive analysis

    if (cluster) {
      dbQuery = dbQuery.ilike("metadata->>cluster", `%${cluster}%`);
    }
    if (query) {
      dbQuery = dbQuery.ilike("metadata->>query", `%${query}%`);
    }

    const { data, error } = await dbQuery;
    if (error) return JSON.stringify({ error: error.message });

    if (!data || data.length === 0) {
      return JSON.stringify({
        error: "No data found for analysis",
        filters_used: { cluster, query, positionThreshold }
      });
    }

    const {
      resolvedIntent,
      filteredItems: filteredData,
      intentFilterApplied,
      filteredOutCount,
    } = await applyIntentFilterToItems({
      query,
      providedIntent: intent,
      items: data,
      toIntentItem: (row) => ({
        domain: row.metadata.domain,
        position: row.metadata.position,
        snippet: row.content?.substring(0, 150) || "",
      }),
    });

    if (!filteredData.length) {
      return JSON.stringify({
        error: "No results match the detected intent",
        intent: resolvedIntent.intent,
        intent_filter_applied: intentFilterApplied,
        filtered_out: filteredOutCount,
        filters_used: { cluster, query, intent, positionThreshold },
      });
    }

    const contentAnalysisPrompt = `Analyze these search results and categorize each by content type. Use these categories:
- recipe (cooking/food content)
- video_tutorial (video guides)
- blog_post (articles/stories)
- product_review (reviews/ratings)
- how_to_guide (tutorials/instructions)
- listicle (numbered lists, "best of")
- news_article (current events)
- forum_discussion (Q&A/community)
- product_page (e-commerce listings)
- comparison_article (vs articles)
- reference_guide (encyclopedic/wiki)

${INTENT_DETECTION}
Detected intent: ${resolvedIntent.intent}
If intent is NOT "unknown", only include results that match the detected intent.

Return JSON: {"content_type_analysis": [{"content_type": "recipe", "domain": "example.com", "position": 1, "confidence": "high", "reasoning": "brief explanation"}]}

Results:
${filteredData.map((row, i) => `
${i + 1}. ${row.metadata.domain} (pos ${row.metadata.position}): ${row.content?.substring(0, 150)}...`).join('\n')}`;

    const analysisResponse = await model.invoke([
      { role: "system", content: "Categorize web content by type. Return only valid JSON." },
      { role: "user", content: contentAnalysisPrompt }
    ]);

    let analysisResult;
    try {
      const content = analysisResponse.content as string;
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      return JSON.stringify({ 
        error: "Failed to parse LLM analysis", 
        raw_response: analysisResponse.content,
        debug_info: `Analyzed ${data.length} results`
      });
    }

    const analyses = analysisResult.content_type_analysis || [];

    // Optimized aggregation
    const contentTypes: Record<string, { count: number; positions: number[]; examples: string[] }> = {};

    for (const analysis of analyses) {
      const contentType = analysis.content_type;
      const position = analysis.position;
      const domain = analysis.domain;

      if (!contentTypes[contentType]) {
        contentTypes[contentType] = { count: 0, positions: [], examples: [] };
      }

      contentTypes[contentType].count++;
      contentTypes[contentType].positions.push(position);

      if (contentTypes[contentType].examples.length < 1) {
        contentTypes[contentType].examples.push(`${domain} (pos ${position})`);
      }
    }

    const totalResults = analyses.length;

    // Streamlined result formatting
    const analysis = Object.entries(contentTypes)
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
      content_type_breakdown: analysis,
      insight: analysis[0] ? `"${analysis[0].content_type}" leads with ${analysis[0].percentage}%` : "Mixed content types",
      intent: resolvedIntent.intent,
      intent_filter_applied: intentFilterApplied,
      filtered_out: filteredOutCount,
    });
  },
});

const retrievalTools = [
  searchByQueryTool,
  getTopPerformersTool,
  getSerpFeaturesTool,
  getClusterDataTool,
  analyzeContentTypesTool,
];

// ============================================================================
// 3. Initialize Models and Parsers
// ============================================================================

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0,
});

const modelWithTools = model.bindTools(retrievalTools);

const routerSchema = z.object({
  intent: QueryIntent,
  explanation: z.string(),
});

const routerParser = StructuredOutputParser.fromZodSchema(routerSchema);

// ============================================================================
// 4. Define Graph Nodes
// ============================================================================

// ROUTER NODE: Classifies the query intent
async function routerNode(state: SEOState): Promise<Partial<SEOState>> {
  // Include conversation history for context in routing
  const historyContext = state.conversationHistory.length > 0
    ? `\nConversation context:\n${state.conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\n`
    : "";

  const routerPrompt = PromptTemplate.fromTemplate(
    ROUTER_PROMPT_TEMPLATE + historyContext + "\n{format_instructions}"
  );

  const input = await routerPrompt.format({
    query: state.query,
    format_instructions: routerParser.getFormatInstructions(),
  });

  const response = await model.invoke(input);
  const decision = await routerParser.parse(response.content as string);

  console.log(`[Router] Intent: ${decision.intent} - ${decision.explanation}`);

  return {
    intent: decision.intent,
    routerExplanation: decision.explanation,
  };
}

// STANDARD AGENT NODE: Uses tools to query the database flexibly
async function standardAgentNode(state: SEOState): Promise<Partial<SEOState>> {
  // Detect cluster from query for UI display
  const clusterName = await detectClusterFromQuery(state.query);

  const systemPrompt = STANDARD_AGENT_PROMPT;

  // Build messages with conversation history for context
  const historyMessages: BaseMessage[] = state.conversationHistory.map(msg => 
    msg.role === "user" 
      ? new HumanMessage(msg.content)
      : new AIMessage(msg.content)
  );

  const messages: BaseMessage[] = [
    new HumanMessage(systemPrompt),
    ...historyMessages,
    new HumanMessage("Current question: " + state.query),
  ];

  const response = await modelWithTools.invoke(messages);
  
  return {
    messages: [response],
    clusterName,
  };
}

// TOOL EXECUTOR NODE: Executes tool calls from the agent
async function toolExecutorNode(state: SEOState): Promise<Partial<SEOState>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];
  
  const toolMessages: ToolMessage[] = [];
  
  for (const toolCall of toolCalls) {
    const toolName = toolCall.name;
    let result: string;
    
    try {
      // Execute the appropriate tool
      switch (toolName) {
        case "search_by_query":
          result = await searchByQueryTool.invoke(toolCall.args as { searchQuery: string; limit?: number });
          break;
        case "get_top_performers":
          result = await getTopPerformersTool.invoke(toolCall.args as { cluster?: string; query?: string; limit?: number });
          break;
        case "get_serp_features":
          result = await getSerpFeaturesTool.invoke(toolCall.args as { cluster?: string; query?: string; feature?: string; limit?: number });
          break;
        case "get_cluster_data":
          result = await getClusterDataTool.invoke(toolCall.args as { cluster: string; limit?: number });
          break;
        case "analyze_content_types":
          {
            const analyzeArgs = toolCall.args as { cluster?: string; query?: string; intent?: string; positionThreshold?: number };
            result = await analyzeContentTypesTool.invoke({
              ...analyzeArgs,
              query: analyzeArgs.query ?? state.query,
            });
          }
          break;
        default:
          result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
      
      toolMessages.push(new ToolMessage({
        content: result,
        tool_call_id: toolCall.id || "",
      }));
    } catch (error) {
      toolMessages.push(new ToolMessage({
        content: `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tool_call_id: toolCall.id || "",
      }));
    }
  }
  
  return { messages: toolMessages };
}

// STANDARD RESPONSE NODE: Generates final response after tool execution
async function standardResponseNode(state: SEOState): Promise<Partial<SEOState>> {
  // Continue the conversation with tool results
  const response = await modelWithTools.invoke(state.messages);
  
  // Check if more tools need to be called
  const aiResponse = response as AIMessage;
  if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
    return { messages: [response] };
  }
  
  // Extract final answer
  return {
    answer: response.content as string,
    responseType: "standard",
    messages: [response],
  };
}

// Check if standard agent needs more tool calls
function shouldContinueStandard(state: SEOState): "tools" | "respond" | "end" {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage instanceof AIMessage || (lastMessage as AIMessage).tool_calls) {
    const aiMessage = lastMessage as AIMessage;
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      return "tools";
    }
  }
  
  // If we have an answer, we're done
  if (state.answer) {
    return "end";
  }
  
  return "respond";
}

// STRATEGY NODE: Provides cluster-based strategy advice
async function strategyNode(state: SEOState): Promise<Partial<SEOState>> {
  const client = getSupabaseClient();

  // Step 1: Identify the cluster from the query
  const clusterName = await detectClusterFromQuery(state.query) || "General";

  console.log(`[Strategy] Analyzing cluster: ${clusterName}`);

  // Step 2: Retrieve ALL documents for this cluster directly from DB
  const { data: clusterRows, error } = await client
    .from("seo_documents")
    .select("content, metadata")
    .eq("metadata->>cluster", clusterName)
    .order("metadata->>iso_date", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[Strategy] DB query error:", error);
    throw new Error(`Failed to fetch cluster data: ${error.message}`);
  }

  const clusterDocs: Document[] = (clusterRows || []).map((row) => ({
    pageContent: row.content,
    metadata: row.metadata,
  }));

  console.log(`[Strategy] Retrieved ${clusterDocs.length} documents for cluster`);

  const {
    resolvedIntent,
    filteredItems: filteredClusterDocs,
  } = await applyIntentFilterToItems({
    query: state.query,
    items: clusterDocs,
    logLabel: "Strategy",
    toIntentItem: (doc) => ({
      domain: doc.metadata.domain,
      position: doc.metadata.position,
      snippet: doc.pageContent?.substring(0, 150) || "",
    }),
  });

  // Step 3: Compute cluster statistics
  const stats = computeClusterStats(filteredClusterDocs);

  // Step 4: Format aggregated signals for the prompt
  const dominantPath = getTopItems(stats.categoryPaths, 3).join(", ") || "/";
  const topSerpFeatures = formatSerpFeatureStats(stats.serpFeatureFrequency);
  const topHeaders = extractCommonHeaders(filteredClusterDocs.slice(0, 10));
  const competitiveLandscape = formatCompetitiveLandscape(filteredClusterDocs.slice(0, 5));

  // Step 5: Generate strategy response with full context
  const strategyPrompt = PromptTemplate.fromTemplate(STRATEGY_SYSTEM_PROMPT);
  const finalPrompt = await strategyPrompt.format({
    cluster_name: clusterName,
    intent: resolvedIntent.intent,
    dominant_path: dominantPath,
    top_serp_features: topSerpFeatures,
    top_headers: topHeaders,
    text_blobs_from_top_ranks: competitiveLandscape,
  });

  const response = await model.invoke(finalPrompt);

  return {
    clusterName,
    documents: clusterDocs,
    answer: response.content as string,
    responseType: "strategy",
  };
}

// COMPARISON NODE: Analyzes temporal differences in SERP data
async function comparisonNode(state: SEOState): Promise<Partial<SEOState>> {
  const vectorStore = await getVectorStore();
  const client = getSupabaseClient();

  // Step 1: Extract time references from the query
  const timeRanges = await detectTimeRanges(state.query, client);

  console.log(`[Comparison] Time ranges:`, timeRanges);

  // Detect cluster from query for UI display
  const clusterName = await detectClusterFromQuery(state.query);

  // Step 2: Get documents relevant to the query topic
  const topicDocs = await vectorStore.similaritySearch(state.query, 5);
  const relevantQueries = [...new Set(topicDocs.map((d) => d.metadata.query))];

  console.log(`[Comparison] Relevant queries:`, relevantQueries);

  // Step 3: Query DB for earlier period data
  const { data: earlierRows } = await client
    .from("seo_documents")
    .select("content, metadata")
    .gte("metadata->>iso_date", timeRanges.earlier.start)
    .lte("metadata->>iso_date", timeRanges.earlier.end)
    .in("metadata->>query", relevantQueries)
    .order("metadata->>position", { ascending: true })
    .limit(20);

  // Step 4: Query DB for later period data
  const { data: laterRows } = await client
    .from("seo_documents")
    .select("content, metadata")
    .gte("metadata->>iso_date", timeRanges.later.start)
    .lte("metadata->>iso_date", timeRanges.later.end)
    .in("metadata->>query", relevantQueries)
    .order("metadata->>position", { ascending: true })
    .limit(20);

  const earlierDocs: Document[] = (earlierRows || []).map((row) => ({
    pageContent: row.content,
    metadata: row.metadata,
  }));

  const laterDocs: Document[] = (laterRows || []).map((row) => ({
    pageContent: row.content,
    metadata: row.metadata,
  }));

  console.log(
    `[Comparison] Earlier: ${earlierDocs.length} docs, Later: ${laterDocs.length} docs`
  );

  // Step 5: Format comparison data
  const earlierData = formatTemporalData(earlierDocs, "Earlier Period");
  const laterData = formatTemporalData(laterDocs, "Later Period");

  // Step 6: Generate comparison response
  const comparisonPrompt = PromptTemplate.fromTemplate(COMPARISON_SYSTEM_PROMPT);
  const finalPrompt = await comparisonPrompt.format({
    query: state.query,
    earlier_data: earlierData,
    later_data: laterData,
  });

  const response = await model.invoke(finalPrompt);

  return {
    documents: [...earlierDocs, ...laterDocs],
    timeRanges,
    answer: response.content as string,
    responseType: "comparison",
    clusterName,
  };
}

// ============================================================================
// 5. Routing Function for Conditional Edges
// ============================================================================

function routeByIntent(state: SEOState): "standard_agent" | "strategy" | "comparison" {
  switch (state.intent) {
    case "STRATEGY":
      return "strategy";
    case "COMPARISON":
      return "comparison";
    case "STANDARD":
    default:
      return "standard_agent";
  }
}

// ============================================================================
// 6. Build the Graph
// ============================================================================

const workflow = new StateGraph(SEOGraphState)
  // Add nodes
  .addNode("router", routerNode)
  .addNode("standard_agent", standardAgentNode)
  .addNode("tools", toolExecutorNode)
  .addNode("standard_response", standardResponseNode)
  .addNode("strategy", strategyNode)
  .addNode("comparison", comparisonNode)

  // Define edges
  .addEdge(START, "router")
  .addConditionalEdges("router", routeByIntent, {
    standard_agent: "standard_agent",
    strategy: "strategy",
    comparison: "comparison",
  })
  
  // Standard agent loop: agent -> tools -> response (may loop back)
  .addConditionalEdges("standard_agent", shouldContinueStandard, {
    tools: "tools",
    respond: "standard_response",
    end: END,
  })
  .addEdge("tools", "standard_response")
  .addConditionalEdges("standard_response", shouldContinueStandard, {
    tools: "tools",
    respond: "standard_response",
    end: END,
  })
  
  .addEdge("strategy", END)
  .addEdge("comparison", END);

// Compile the graph
export const seoGraph = workflow.compile();

// ============================================================================
// 6. Public API
// ============================================================================

export interface SEOGraphResponse {
  type: string;
  answer: string;
  cluster?: string;
  documents: Document[];
  intent: QueryIntentType | null;
  explanation: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// Main entry point for querying the SEO RAG system
export async function runSEOQuery(
  query: string, 
  history?: ConversationMessage[]
): Promise<SEOGraphResponse> {
  const result = await seoGraph.invoke({ 
    query,
    conversationHistory: history || [],
  });

  return {
    type: result.responseType,
    answer: result.answer,
    cluster: result.clusterName || undefined,
    documents: result.documents,
    intent: result.intent,
    explanation: result.routerExplanation,
  };
}

// ============================================================================
// 7. Helper Functions
// ============================================================================

async function applyIntentFilterToItems<T>({
  query,
  providedIntent,
  items,
  toIntentItem,
  logLabel,
}: {
  query?: string;
  providedIntent?: string;
  items: T[];
  toIntentItem: (item: T) => { domain?: string; position?: number; snippet?: string, item?: typeof item };
  logLabel?: string;
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
    items: items.map((item, index) => ({
      index,
      ...toIntentItem(item),
    })),
  });

  const filteredItems = intentFilter.keepIndices
    ? items.filter((_, idx) => intentFilter.keepIndices?.has(idx))
    : items;

  const filteredOutCount = items.length - filteredItems.length;

  if (logLabel && intentFilter.keepIndices) {
    console.log(
      `[${logLabel}] Intent filter (${resolvedIntent.intent}) removed ${filteredOutCount} items`
    );
  }

  return {
    resolvedIntent,
    filteredItems,
    intentFilterApplied: intentFilter.keepIndices !== null,
    filteredOutCount,
  };
}

function normalizeSearchIntent(intent?: string): SearchIntentType | null {
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

async function resolveSearchIntent(
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

async function detectSearchIntent(
  query: string
): Promise<{ intent: SearchIntentType; confidence: "low" | "medium" | "high" }> {
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
    const response = await model.invoke(prompt);
    const parsed = await intentParser.parse(response.content as string);
    return { intent: parsed.intent, confidence: parsed.confidence };
  } catch {
    return { intent: "unknown", confidence: "low" };
  }
}

async function filterItemsByIntent({
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
  .map((item, i) => {
    const position = item.position ? ` (pos ${item.position})` : "";
    const snippet = item.snippet ? `: ${item.snippet}` : "";
    return `${i + 1}. ${item.domain || "unknown"}${position}${snippet}`;
  })
  .join("\n")}

${filterParser.getFormatInstructions()}`;

  try {
    const response = await model.invoke(prompt);
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

// Detect time ranges from the query for comparison analysis
async function detectTimeRanges(
  query: string,
  client: ReturnType<typeof getSupabaseClient>
): Promise<{ earlier: TimeRange; later: TimeRange }> {
  // First, get the date range available in the database
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

  type DateRow = { iso_date: string } | null;
  const earliestRow = dateRange?.[0] as DateRow;
  const latestRow = latestDate?.[0] as DateRow;
  
  const earliestInDb = earliestRow?.iso_date || "2000-01-01";
  const latestInDb = latestRow?.iso_date || new Date().toISOString().split("T")[0];

  // Try to extract time references from the query
  const timeExtractionSchema = z.object({
    hasTimeReference: z.boolean(),
    earlierPeriod: z.object({
      start: z.string().describe("ISO date string YYYY-MM-DD"),
      end: z.string().describe("ISO date string YYYY-MM-DD"),
    }).optional(),
    laterPeriod: z.object({
      start: z.string().describe("ISO date string YYYY-MM-DD"),
      end: z.string().describe("ISO date string YYYY-MM-DD"),
    }).optional(),
  });

  const timeParser = StructuredOutputParser.fromZodSchema(timeExtractionSchema);

  const timePrompt = `Extract time periods from this SEO query. Today is ${new Date().toISOString().split("T")[0]}.
Available data range: ${earliestInDb} to ${latestInDb}

Query: "${query}"

If the query mentions:
- "since the update" / "after the update" → compare 30 days before update vs 30 days after
- "vs last month" → compare current month vs previous month  
- "over time" / "trend" → compare earliest 30% of data vs latest 30%
- Specific dates → use those dates

{format_instructions}`;

  try {
    const formatted = await timePrompt.replace(
      "{format_instructions}",
      timeParser.getFormatInstructions()
    );
    const response = await model.invoke(formatted);
    const extracted = await timeParser.parse(response.content as string);

    if (extracted.hasTimeReference && extracted.earlierPeriod && extracted.laterPeriod) {
      return {
        earlier: extracted.earlierPeriod,
        later: extracted.laterPeriod,
      };
    }
  } catch (error) {
    console.log("[Comparison] Time extraction failed, using defaults:", error);
  }

  // Default: split available data into two halves
  const earliest = new Date(earliestInDb);
  const latest = new Date(latestInDb);
  const midpoint = new Date((earliest.getTime() + latest.getTime()) / 2);

  return {
    earlier: {
      start: earliestInDb,
      end: midpoint.toISOString().split("T")[0],
    },
    later: {
      start: midpoint.toISOString().split("T")[0],
      end: latestInDb,
    },
  };
}

// Compute aggregate statistics for a cluster
function computeClusterStats(docs: Document[]): ClusterStats {
  const serpFeatureFrequency = new Map<string, number>();
  const categoryPaths = new Map<string, number>();
  const domains = new Set<string>();
  let earliest = "";
  let latest = "";

  for (const doc of docs) {
    const meta = doc.metadata;

    // Track domains
    if (meta.domain) {
      domains.add(meta.domain);
    }

    // Track SERP features
    const features = meta.serp_features as string[] | undefined;
    if (features) {
      for (const feature of features) {
        serpFeatureFrequency.set(feature, (serpFeatureFrequency.get(feature) || 0) + 1);
      }
    }

    // Track category paths
    const categories = meta.categories as string[] | undefined;
    if (categories) {
      const path = categories.join(" > ");
      categoryPaths.set(path, (categoryPaths.get(path) || 0) + 1);
    }

    // Track date range
    const isoDate = meta.iso_date as string;
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

// Format SERP feature statistics for the prompt
function formatSerpFeatureStats(frequency: Map<string, number>): string {
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

// Get top items from a frequency map
function getTopItems(map: Map<string, number>, n: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item]) => item);
}

// Format competitive landscape from top documents
function formatCompetitiveLandscape(docs: Document[]): string {
  return docs
    .map((doc, i) => {
      const meta = doc.metadata;
      const position = meta.position || i + 1;
      const domain = meta.domain || "unknown";
      return `### Rank #${position} - ${domain}\n${doc.pageContent}`;
    })
    .join("\n\n---\n\n");
}

// Format temporal data with metadata context
function formatTemporalData(docs: Document[], periodLabel: string): string {
  if (docs.length === 0) {
    return `${periodLabel}: No data available`;
  }

  const dates = docs.map((d) => d.metadata.iso_date).filter(Boolean);
  const dateRange = dates.length > 0 
    ? `(${Math.min(...dates.map(d => new Date(d).getTime()))} - ${Math.max(...dates.map(d => new Date(d).getTime()))})`
    : "";

  const formatted = docs.slice(0, 10).map((doc) => {
    const meta = doc.metadata;
    return `[${meta.iso_date || "unknown date"}] Position ${meta.position || "?"} - ${meta.domain || "unknown"}
${doc.pageContent}`;
  });

  return `## ${periodLabel} ${dateRange}
${formatted.join("\n\n")}`;
}

// Extract common header patterns from top-ranking documents
function extractCommonHeaders(docs: Document[]): string {
  const headerPatterns: string[] = [];

  for (const doc of docs) {
    const headers = doc.metadata.headers as string[] | undefined;
    if (headers && Array.isArray(headers)) {
      headerPatterns.push(...headers);
    }
    
    // Also extract H1/H2 if available in different format
    const h1 = doc.metadata.h1 as string | undefined;
    const h2s = doc.metadata.h2 as string[] | undefined;
    if (h1) headerPatterns.push(h1);
    if (h2s && Array.isArray(h2s)) headerPatterns.push(...h2s);
  }

  if (headerPatterns.length === 0) {
    return "How to guides, Best of lists, Step-by-step tutorials";
  }

  // Count frequency and return top patterns
  const frequency = new Map<string, number>();
  for (const header of headerPatterns) {
    // Normalize headers to patterns
    const normalized = normalizeHeaderToPattern(header);
    frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([header]) => header)
    .join(", ");
}

// Normalize a header to a content pattern
function normalizeHeaderToPattern(header: string): string {
  const lower = header.toLowerCase();
  
  if (lower.includes("how to")) return "How to guides";
  if (lower.includes("best") || lower.includes("top")) return "Best of lists";
  if (lower.includes("step")) return "Step-by-step tutorials";
  if (lower.includes("guide")) return "Comprehensive guides";
  if (lower.includes("vs") || lower.includes("versus")) return "Comparison articles";
  if (lower.includes("review")) return "Product reviews";
  if (lower.includes("tips")) return "Tips & tricks";
  if (lower.includes("what is") || lower.includes("what are")) return "Definition/explainer content";
  
  return header.slice(0, 50); // Return truncated original if no pattern match
}


// Detect cluster from query using vector store similarity search

async function detectClusterFromQuery(query: string, minSimilarityScore = 0.8): Promise<string> {
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
