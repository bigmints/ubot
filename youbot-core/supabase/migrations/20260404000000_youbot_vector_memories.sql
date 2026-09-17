-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create the agent memories table
create table if not exists public.youbot_agent_memories (
    id uuid primary key default gen_random_uuid(),
    session_id text not null,     -- User/contact session context
    agent_id text not null,       -- The specific agent that learned this
    content text not null,        -- Text representation of memory
    embedding vector(768),        -- The vector embeddings (Gemini text-embedding-004 size 768)
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Index for session and agent lookups
create index if not exists idx_youbot_agent_memories_session on public.youbot_agent_memories(session_id);
create index if not exists idx_youbot_agent_memories_agent on public.youbot_agent_memories(agent_id);

-- Create an HNSW index for fast semantic similarity search
create index if not exists idx_youbot_agent_memories_embedding 
    on public.youbot_agent_memories 
    using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);

-- Function to query memories via Supabase RPC
create or replace function match_agent_memories(
    query_embedding vector(768),
    match_threshold float,
    match_count int,
    filter_session_id text default null,
    filter_agent_id text default null
)
returns table (
    id uuid,
    session_id text,
    agent_id text,
    content text,
    metadata jsonb,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        m.id,
        m.session_id,
        m.agent_id,
        m.content,
        m.metadata,
        1 - (m.embedding <=> query_embedding) as similarity
    from public.youbot_agent_memories m
    where 
        (filter_session_id is null or m.session_id = filter_session_id)
        and (filter_agent_id is null or m.agent_id = filter_agent_id)
        and 1 - (m.embedding <=> query_embedding) > match_threshold
    order by m.embedding <=> query_embedding
    limit match_count;
end;
$$;
