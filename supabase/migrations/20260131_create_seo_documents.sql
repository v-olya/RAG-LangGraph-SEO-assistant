create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto;

create table if not exists public.seo_documents (
  id text primary key,
  content text not null,
  metadata jsonb not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists seo_documents_embedding_idx
  on public.seo_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 128);

create index if not exists seo_documents_metadata_idx
  on public.seo_documents
  using gin (metadata);

create or replace function public.match_seo_documents(
  query_embedding extensions.vector(1536),
  match_count integer default 10,
  filter jsonb default '{}'::jsonb
) returns table (
  id text,
  content text,
  metadata jsonb,
  similarity double precision
) language plpgsql SET search_path = public, extensions as
$$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.seo_documents as d
  where (
    filter is null
    or filter = '{}'::jsonb
    or d.metadata @> filter
  )
  order by d.embedding <=> query_embedding
  limit greatest(match_count, 1);
end;
$$;
