import { getSupabaseClient } from '../src/lib/vectorStore';
import { OpenAIEmbeddings } from '@langchain/openai';

async function checkSelect() {
  const client = getSupabaseClient();
  const { data, error } = await client.from('seo_documents').select('id, content').limit(5);
  if (error) {
    console.error('Select Error:', error);
  } else {
    console.log('Sample documents:', data);
  }

  // Test vector search
  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  const queryEmbedding = await embeddings.embedQuery('best pizza oven');
  const { data: matchData, error: matchError } = await client.rpc('match_seo_documents', { query_embedding: queryEmbedding, match_count: 3 });
  if (matchError) {
    console.error('Match Error:', matchError);
  } else {
    console.log('Vector search results:', matchData);
  }
}

checkSelect();