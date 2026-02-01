import { NextRequest, NextResponse } from "next/server";
import { runSEOQuery, type SEOGraphResponse } from "../../agenticWorkflow";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  query: string;
  history?: ChatMessage[];
}

export interface ChatResponse {
  success: boolean;
  data?: SEOGraphResponse;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  try {
    const body = (await request.json()) as ChatRequest;
    const { query, history } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Query is required" },
        { status: 400 }
      );
    }

    const result = await runSEOQuery(query.trim(), history);

    return NextResponse.json({
      success: true,
      data: {
        type: result.type,
        answer: result.answer,
        cluster: result.cluster,
        documents: result.documents,
        intent: result.intent,
        explanation: result.explanation,
      },
    });
  } catch (error) {
    console.error("[Chat API Error]", error);
    
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
