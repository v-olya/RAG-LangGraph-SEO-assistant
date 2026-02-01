import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import type { Embeddings } from '@langchain/core/embeddings';
import type { ProcessedEntry, SerpData } from './types';
import { buildSerpEntries } from '../utils/buildSerpEntries';

const TABLE_NAME = 'seo_documents';
const MATCH_FUNCTION_NAME = 'match_seo_documents';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

let cachedClient: SupabaseClient | undefined;
let cachedEmbeddings: Embeddings | undefined;
let vectorStorePromise: Promise<SupabaseVectorStore> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
    const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return cachedClient;
}

function getEmbeddings(): Embeddings {
  if (!cachedEmbeddings) {
    cachedEmbeddings = new OpenAIEmbeddings({ model: DEFAULT_EMBEDDING_MODEL });
  }
  return cachedEmbeddings;
}

async function createVectorStore(): Promise<SupabaseVectorStore> {
  const client = getSupabaseClient();
  const embeddings = getEmbeddings();
  return SupabaseVectorStore.fromExistingIndex(embeddings, {
    client,
    tableName: TABLE_NAME,
    queryName: MATCH_FUNCTION_NAME
  });
}

export async function getVectorStore(): Promise<SupabaseVectorStore> {
  if (!vectorStorePromise) {
    vectorStorePromise = createVectorStore();
  }
  return vectorStorePromise;
}

export async function upsertProcessedEntries(entries: ProcessedEntry[]): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  const embeddings = getEmbeddings();
  const vectors = await embeddings.embedDocuments(entries.map(entry => entry.text_blob));
  const client = getSupabaseClient();

  const payload = entries.map((entry, index) => ({
    id: entry.id,
    content: entry.text_blob,
    metadata: entry.metadata,
    embedding: vectors[index]
  }));

  const { error } = await client.from(TABLE_NAME).upsert(payload, { onConflict: 'id' });
  if (error) {
    throw new Error(`Failed to upsert embeddings: ${error.message}`);
  }
  return payload.length;
}

export async function ingestSerpData(data: SerpData): Promise<number> {
  const entries = await buildSerpEntries(data);
  return upsertProcessedEntries(entries);
}

export function resetVectorStoreCache(): void {
  vectorStorePromise = null;
}

export { TABLE_NAME as vectorTableName, MATCH_FUNCTION_NAME as matchFunctionName };
