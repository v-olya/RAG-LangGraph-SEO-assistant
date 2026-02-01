# Retrieval-Augmented SEO Assistant

The app implements a RAG workflow for SEO data analysis. It ingests pre-scraped search engine results pages (SERPs), processes them into searchable documents, builds a vector index for semantic search, and provides a chat interface to query insights about SEO content, competitor analysis, and search trends.

Built with Next.js (App Router), React, TypeScript, LangChain, Tailwind CSS for styling, Supabase for data persistence, and a custom vector store implementation.

## Quickstart
1. Install dependencies:

   `npm install`

2. Run the dev server:

   `npm run dev`

3. Preprocess the SERP data:

   `npm run preprocess`

4. Seed the vector store:

   `npm run seed-vector-store`

5. Open the app in the browser (usually at `http://localhost:3000`) and try the chat UI.

Notes:
- Some scripts expect Supabase connection/env vars to be configured. See `.env.example` and `supabase/config.toml`.
- The `assets/` folder contains scraped JSON, clusters definition, and processed.json with metadata added.

## Environment Variables

The following environment variables are required for the application to function:

- `OPENAI_API_KEY` — Required for AI-powered chat responses and embeddings
- `SERPER_API_KEY` — Required for fetching fresh SERP data (used by `npm run get-serp`)
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (for server-side operations)

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

## Scripts
- `npm run build` — Build the production version of the app.
- `npm start` — Start the production server.
- `npm run get-serp` — Fetch fresh SERP data (requires API keys).
- `npm run preprocess` — Normalizes and structures raw SERP data from `assets/scrapped/`.
- `npm run seed-vector-store` — Populates the vector store with processed SEO documents.
- `npm run start-cron` — Scheduled tasks for data updates and maintenance.
- `npm run check-db` — Database health checks and maintenance.

## Agentic Processing

Chat component (`src/components/Chat.tsx`) and API route (`src/app/api/chat/route.ts`) allows users to ask questions and get AI-powered responses based on the indexed SEO data.

User queries are classified and routed through specialized workflows (STANDARD for data analysis, COMPARISON for time-based insights, STRATEGY for recommendations) using LangGraph-powered agents with access to retrieval tools.

## Agentic Workflow

The app features an agentic workflow built with LangGraph that intelligently handles user queries through query classification and specialized handling:

- **Query Classification**: Incoming queries are routed by an AI router into three categories:
  - **STANDARD**: Data-driven questions (e.g., "What content performs best?") - handled by a tool-calling agent that searches the vector store and database for relevant SEO insights.
  - **COMPARISON**: Time-based analysis (e.g., "How have rankings changed?") - compares SERP data across different time periods.
  - **STRATEGY**: Actionable recommendations (e.g., "What should I do to rank?") - generates content roadmaps and SEO strategies for specific clusters.

- **Query Handling**: Each intent type uses specialized logic:
  - STANDARD queries leverage tools including:
    - **Semantic Search**: Finds relevant SEO documents by similarity to user queries.
    - **Top Performer Filter**: Retrieves top-ranking content (positions 1-3) for clusters or topics.
    - **SERP Features Analysis**: Identifies documents with specific features like videos, PAA, or answer boxes.
    - **Cluster Data Retrieval**: Gets comprehensive data for specific clusters including domains and stats.
    - **Content Type Analysis**: Analyzes what types of content (blogs, guides, etc.) perform best.
  - COMPARISON queries detect time ranges and compare SERP features, positions, and content types.
  - STRATEGY queries analyze cluster data to provide competitive insights and 30-day content plans.

This agentic approach ensures context-aware, accurate responses tailored to different types of SEO inquiries.

## Query Examples

Here are some example queries you can try in the chat interface, categorized by the type of analysis they trigger:

### STANDARD Queries (Data Analysis)
- "What content types are performing best for ... cluster/query?"
- "What SERP features appear most often in search results for ...?"

### COMPARISON Queries (Time-Based Analysis)
- "How the serch intent for ... changed since last month?"
- "How has the content landscape evolved over the past quarter?"

### STRATEGY Queries (Recommendations & Action Plans)
- "What should I do to rank for 'healthy meal ideas'?"
- "Create a content strategy for the 'home workout equipment' cluster"

## Further Development

- Integrate with embeddings providers like OpenAI or local models to enhance vector quality.
- Expand data sources beyond SERPs (e.g., site audits, backlink data).
- Add authentication, user sessions, and persistent chat history.
- Implement tests for utilities and API endpoints.
