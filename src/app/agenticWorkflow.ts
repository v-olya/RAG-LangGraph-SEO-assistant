import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { z } from "zod";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { getSupabaseClient, getVectorStore } from "@/vectorStore";
import {
  ROUTER_PROMPT_TEMPLATE,
  STRATEGY_SYSTEM_PROMPT,
  COMPARISON_SYSTEM_PROMPT,
  STANDARD_AGENT_PROMPT,
} from "../constants";
import type { 
  QueryIntentType, 
  SearchIntentType, 
  TimeRange, 
  ConversationMessage,
  SEOGraphResponse
} from '../types';
import { model, cheapModel } from "./models";
import { 
  modelWithTools,
  retrievalTools
} from "./tools";
import { 
  detectClusterFromQuery, 
  extractTargetIntent, 
  getFilteredDocsAndContext, 
  computeClusterStats,
  formatSerpFeatureStats,
  extractCommonHeaders,
  getTopItems,
  formatCompetitiveLandscape,
  detectTimeRanges,
  formatTemporalData
} from "./agenticTasks";

// ============================================================================
// 1. Define the Graph State
// ============================================================================

const QueryIntent = z.enum(["STANDARD", "COMPARISON", "STRATEGY"]);

const SEOGraphState = Annotation.Root({
  // Original user query
  query: Annotation<string>,

  // Conversation history for context
  conversationHistory: Annotation<ConversationMessage[]>({
    reducer: (_prev: ConversationMessage[], next: ConversationMessage[]) => next,
    default: () => [],
  }),

  // Classified intent from the router
  intent: Annotation<QueryIntentType | null>({
    reducer: (_prev: QueryIntentType | null, next: QueryIntentType | null) => next,
    default: () => null,
  }),

  // Router explanation for debugging
  routerExplanation: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),

  // Messages for tool-calling agent (STANDARD queries)
  messages: Annotation<BaseMessage[]>({
    reducer: (prev: BaseMessage[], next: BaseMessage[]): BaseMessage[] => [...prev, ...next],
    default: () => [],
  }),

  // Retrieved documents from vector store
  documents: Annotation<Document[]>({
    reducer: (_prev: Document[], next: Document[]) => next,
    default: () => [],
  }),

  // Cluster name for strategy queries
  clusterName: Annotation<string>({
    reducer: (prev: string, next: string) => next || prev,
    default: () => "",
  }),

  // Detected time ranges for comparison queries
  timeRanges: Annotation<{ earlier: TimeRange; later: TimeRange } | null>({
    reducer: (_prev: { earlier: TimeRange; later: TimeRange } | null, next: { earlier: TimeRange; later: TimeRange } | null) => next,
    default: () => null,
  }),

  // Final answer from LLM
  answer: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),

  // Response type for the client
  responseType: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),

  // Detected search intent
  searchIntent: Annotation<SearchIntentType | null>({
    reducer: (prev: SearchIntentType | null, next: SearchIntentType | null) => next || prev,
    default: () => null,
  }),
});

type SEOState = typeof SEOGraphState.State;

const routerSchema = z.object({
  intent: QueryIntent,
  explanation: z.string(),
});

const routerParser = StructuredOutputParser.fromZodSchema(routerSchema);

// ============================================================================
// 2. Define Graph Nodes
// ============================================================================

// ROUTER NODE: Classifies the query intent and detects cluster
async function routerNode(state: SEOState): Promise<Partial<SEOState>> {
  const routerPrompt = PromptTemplate.fromTemplate(ROUTER_PROMPT_TEMPLATE);

  const historyContext: string = state.conversationHistory.length > 0
    ? `### CONVERSATION HISTORY\n${state.conversationHistory.map((m: ConversationMessage) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
    : "No previous history.";

  const input = await routerPrompt.format({
    query: state.query,
    history_context: historyContext,
    format_instructions: routerParser.getFormatInstructions(),
  });

  // Detect cluster and classify intent in parallel
  const [response, clusterName, explicitIntent] = await Promise.all([
    cheapModel.invoke(input),
    detectClusterFromQuery(state.query, 0.8, state.conversationHistory),
    extractTargetIntent(state.query, state.conversationHistory),
  ]);
  
  const decision = await routerParser.parse(response.content as string);

  console.log(`[Router] Intent: ${decision.intent}, Cluster: ${clusterName || "none"}, Explicit Intent: ${explicitIntent || "none"} - ${decision.explanation}`);

  return {
    intent: decision.intent,
    routerExplanation: decision.explanation,
    clusterName: clusterName || "",
    searchIntent: (explicitIntent as SearchIntentType) || null,
  };
}

// STANDARD AGENT NODE: Uses tools to query the database flexibly
async function standardAgentNode(state: SEOState): Promise<Partial<SEOState>> {
  const systemPrompt = STANDARD_AGENT_PROMPT;

  const historyMessages: BaseMessage[] = state.conversationHistory.map((msg: ConversationMessage): BaseMessage => 
    msg.role === "user" ? new HumanMessage(msg.content) : new AIMessage(msg.content)
  );

  const messages: BaseMessage[] = [
    new HumanMessage(systemPrompt),
    ...historyMessages,
    new HumanMessage("Current question: " + state.query),
  ];

  const response = await modelWithTools.invoke(messages);
  
  return {
    messages: [response],
    clusterName: state.clusterName,
  };
}

// TOOL EXECUTOR NODE: Executes tool calls from the agent
async function toolExecutorNode(state: SEOState): Promise<Partial<SEOState>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];
  
  const toolMessages: ToolMessage[] = [];
  
  for (const toolCall of toolCalls) {
    let result: string;
    try {
      const tool = retrievalTools.find((t: { name: string }): boolean => t.name === toolCall.name);
      if (tool) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await (tool as any).invoke(toolCall.args);
      } else {
        result = JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
      }
      
      toolMessages.push(new ToolMessage({
        content: result,
        tool_call_id: toolCall.id || "",
      }));
    } catch (error) {
      toolMessages.push(new ToolMessage({
        content: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
        tool_call_id: toolCall.id || "",
      }));
    }
  }
  
  return { messages: toolMessages };
}

// STANDARD RESPONSE NODE: Generates final response after tool execution
async function standardResponseNode(state: SEOState): Promise<Partial<SEOState>> {
  const response = await modelWithTools.invoke(state.messages);
  const aiResponse = response as AIMessage;
  
  if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
    return { messages: [response] };
  }
  
  return {
    answer: response.content as string,
    responseType: "standard",
    messages: [response],
  };
}

function shouldContinueStandard(state: SEOState): "tools" | "respond" | "end" {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  return state.answer ? "end" : "respond";
}

// STRATEGY NODE: Provides cluster-based strategy advice
async function strategyNode(state: SEOState): Promise<Partial<SEOState>> {
  const client = getSupabaseClient();
  const clusterName = state.clusterName || "General";

  const { data: clusterRows, error } = await client
    .from("seo_documents")
    .select("content, metadata")
    .eq("metadata->>cluster", clusterName)
    .limit(100);

  if (error) throw new Error(`DB error: ${error.message}`);

  const clusterDocs: Document[] = (clusterRows as { content: string, metadata: Record<string, unknown> }[] || []).map((row: { content: string, metadata: Record<string, unknown> }): Document => ({
    pageContent: row.content,
    metadata: row.metadata,
  }));

  const { docs: filteredClusterDocs, context: intentContext } = await getFilteredDocsAndContext(
    state.query,
    clusterDocs
  );

  const stats = computeClusterStats(filteredClusterDocs);
  const dominantPath = getTopItems(stats.categoryPaths, 3).join(", ") || "/";
  const topSerpFeatures = formatSerpFeatureStats(stats.serpFeatureFrequency);
  const topHeaders = extractCommonHeaders(filteredClusterDocs.slice(0, 10));
  const competitiveLandscape = formatCompetitiveLandscape(filteredClusterDocs.slice(0, 5));

  const strategyPrompt = PromptTemplate.fromTemplate(STRATEGY_SYSTEM_PROMPT);
  const finalPrompt = await strategyPrompt.format({
    cluster_name: clusterName,
    intent_context: intentContext,
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
  const client = getSupabaseClient();
  const timeRanges = await detectTimeRanges(state.query);
  const clusterName = state.clusterName;

  let relevantQueries: string[] = [];
  if (clusterName) {
    const { data: clusterQueries } = await client
      .from("seo_documents")
      .select("metadata->>query")
      .eq("metadata->>cluster", clusterName);
    if (clusterQueries) {
      relevantQueries = [...new Set((clusterQueries as { query: string }[]).map((q: { query: string }) => q.query).filter(Boolean))];
    }
  }

  if (relevantQueries.length === 0) {
    const vectorStore = await getVectorStore();
    const vectorResults: Document[] = await vectorStore.similaritySearch(state.query, 10);
    relevantQueries = [...new Set(vectorResults.map((doc: Document) => doc.metadata.query as string).filter(Boolean))];
  }

  const { data: rows } = await client
    .from("seo_documents")
    .select("content, metadata")
    .in("metadata->>query", relevantQueries.length > 0 ? relevantQueries : [state.query])
    .gte("metadata->>iso_date", timeRanges.earlier.start)
    .lte("metadata->>iso_date", timeRanges.later.end)
    .limit(100);

  const allDocs: Document[] = (rows as { content: string, metadata: Record<string, unknown> }[] || []).map((row: { content: string, metadata: Record<string, unknown> }): Document => ({
    pageContent: row.content,
    metadata: row.metadata
  }));

  const { docs: filteredDocs, context: intentContext } = await getFilteredDocsAndContext(state.query, allDocs);

  const earlierDocs: Document[] = filteredDocs.filter((d: Document) => d.metadata.iso_date <= timeRanges.earlier.end);
  const laterDocs: Document[] = filteredDocs.filter((d: Document) => d.metadata.iso_date >= timeRanges.later.start);

  const earlierData = formatTemporalData(earlierDocs, "Earlier Period");
  const laterData = formatTemporalData(laterDocs, "Later Period");

  const comparisonPrompt = PromptTemplate.fromTemplate(COMPARISON_SYSTEM_PROMPT);
  const finalPrompt = await comparisonPrompt.format({
    query: state.query,
    earlier_data: earlierData,
    later_data: laterData,
    intent_context: intentContext,
  });

  const response = await model.invoke(finalPrompt);

  return {
    documents: filteredDocs,
    timeRanges,
    answer: response.content as string,
    responseType: "comparison",
  };
}

// ============================================================================
// 3. Routing and Graph Construction
// ============================================================================

function routeByIntent(state: SEOState): "standard_agent" | "strategy" | "comparison" {
  if (state.intent === "STRATEGY") return "strategy";
  if (state.intent === "COMPARISON") return "comparison";
  return "standard_agent";
}

const workflow = new StateGraph(SEOGraphState)
  .addNode("router", routerNode)
  .addNode("standard_agent", standardAgentNode)
  .addNode("tools", toolExecutorNode)
  .addNode("standard_response", standardResponseNode)
  .addNode("strategy", strategyNode)
  .addNode("comparison", comparisonNode)
  .addEdge(START, "router")
  .addConditionalEdges("router", routeByIntent)
  .addConditionalEdges("standard_agent", shouldContinueStandard)
  .addEdge("tools", "standard_response")
  .addConditionalEdges("standard_response", shouldContinueStandard)
  .addEdge("strategy", END)
  .addEdge("comparison", END);

export const seoGraph = workflow.compile();

// Main entry point
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
    searchIntent: result.searchIntent,
    explanation: result.routerExplanation,
  };
}
