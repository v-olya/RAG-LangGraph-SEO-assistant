# Retrieval-Augmented SEO Assistant

The app implements a RAG workflow for SEO data analysis, built with Next.js (App Router), React, TypeScript, LangChain, Tailwind CSS for styling, Supabase for data persistence, and a custom vector store implementation.

It ingests pre-scraped search engine results pages (SERPs), processes them into searchable documents, builds a vector index, and provides a chat interface to query insights about SEO content, competitor analysis, and search trends. With each new chat message, the model receives the conversation history until the user reloads the chat.

## Quickstart
1. Install dependencies:

   `npm install`

2. Start the local database (requires Docker to be running):

   `npx supabase start`

3. Run the dev server:

   `npm run dev`

4. Preprocess the SERP data:

   `npm run preprocess`

5. Seed the vector store:

   `npm run seed-vector-store`

6. Open the app in the browser (usually at `http://localhost:3000`) and try the chat UI.

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

Copy `.env.example` to `.env.local` and fill in the required values.

## Scripts
- `npm run build` — Build the production version of the app.
- `npm start` — Start the production server.
- `npm run get-serp` — Fetch fresh SERP data (requires API keys).
- `npm run preprocess` — Normalizes and structures raw SERP data from `assets/scrapped/`.
- `npm run seed-vector-store` — Populates the vector store with processed SEO documents.
- `npm run start-cron` — Scheduled tasks for data updates and maintenance.
- `npm run check-db` — Database health checks and maintenance.

## Vector store metadata

When documents are seeded into the vector store, each entry includes a `metadata` object matching the `SerpMetadata` interface (see `src/types.ts`). This metadata is used for filtering, provenance, and cluster grouping:

- **iso_date**: ISO timestamp when the SERP was processed
- **serp_features**: array of SERP features present (e.g., `answerBox`, `videoResults`)
- **cluster**: cluster or query group name (should match entries in `assets/clusters.json`)
- **query**: the search query string
- **type**: type of SERP entry (e.g., `organic`, `news`, etc.)
- **serp_id**: unique identifier for the SERP
- **position**: SERP rank (1-based, optional)
- **domain**: domain of the result
- **categories**: array of category labels

Embeddings are stored in the vector index; metadata is used for retrieval and filtering. Keep the `cluster` value consistent with entries in `assets/clusters.json` to enable accurate cluster comparisons.

**NB! Prepopulate clusters with queries for periodic SERP scraping**

The project expects `assets/clusters.json` to contain cluster definitions (== query lists) used by scheduled scraper to fetch SERP data. 

Each cluster's queries are then consumed by `scripts/getSerp.ts` and the cron runner.

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

NB! If you want to explore a new topic that is unrelated to the previous messages, reload the chat first so the model does not carry over earlier context.

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

## Screenshots

<img src="https://github.com/user-attachments/assets/977b0d29-c758-4555-bb39-3563b42ba94a" />

<img src="https://github.com/user-attachments/assets/5e277d48-24a6-4ed1-9320-139e8ce63f3f" />

<img src="https://github.com/user-attachments/assets/28788579-f92d-4672-b486-09a00625fdde" /> 

<img src="https://github.com/user-attachments/assets/2c95efcc-dcad-4327-a8ce-21bdb24b5b09" />


