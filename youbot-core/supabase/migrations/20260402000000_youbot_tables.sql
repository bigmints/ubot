-- ============================================================
-- YOUBOT Core Tables
-- All tables used by the YOUBOT engine for sessions, messages,
-- memories, automation, metering, and experiments.
-- ============================================================

-- Chat sessions
CREATE TABLE IF NOT EXISTS youbot_chat_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'web',
  name TEXT NOT NULL DEFAULT 'Chat',
  owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_youbot_sessions_type ON youbot_chat_sessions(type);
CREATE INDEX IF NOT EXISTS idx_youbot_sessions_updated ON youbot_chat_sessions(updated_at);

-- Chat messages
CREATE TABLE IF NOT EXISTS youbot_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB,
  owner_id UUID
);
CREATE INDEX IF NOT EXISTS idx_youbot_messages_session ON youbot_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_youbot_messages_timestamp ON youbot_chat_messages(timestamp);

-- Agent memories
CREATE TABLE IF NOT EXISTS youbot_memories (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'extracted',
  confidence REAL NOT NULL DEFAULT 0.8,
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_youbot_memories_contact ON youbot_memories(contact_id);

-- Soul documents (persona YAML)
CREATE TABLE IF NOT EXISTS youbot_soul_documents (
  persona_id TEXT NOT NULL,
  content TEXT NOT NULL,
  owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, owner_id)
);

-- Config store (key-value)
CREATE TABLE IF NOT EXISTS youbot_config (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'database',
  owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, owner_id)
);

-- Follow-ups
CREATE TABLE IF NOT EXISTS youbot_follow_ups (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  reason TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  follow_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  result TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
    owner_id UUID,
    approval_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_youbot_followups_status ON youbot_follow_ups(status);

-- Capability log
CREATE TABLE IF NOT EXISTS youbot_capability_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  module_name TEXT,
  triage_verdict TEXT,
  triage_reason TEXT,
  test_passed BOOLEAN,
  test_details TEXT,
  request TEXT,
  session_id TEXT,
  source TEXT DEFAULT 'web',
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent registry
CREATE TABLE IF NOT EXISTS youbot_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  priority TEXT NOT NULL DEFAULT 'medium',
  config JSONB,
  stats JSONB,
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent tasks
CREATE TABLE IF NOT EXISTS youbot_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES youbot_agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  progress INTEGER DEFAULT 0,
  data JSONB,
  result JSONB,
  error TEXT,
  owner_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Todo items
CREATE TABLE IF NOT EXISTS youbot_todos (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, session_id)
);

-- Async jobs
CREATE TABLE IF NOT EXISTS youbot_async_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task plans
CREATE TABLE IF NOT EXISTS youbot_task_plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  original_request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task steps
CREATE TABLE IF NOT EXISTS youbot_task_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES youbot_task_plans(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  tool_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spawned sessions
CREATE TABLE IF NOT EXISTS youbot_spawned_sessions (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  depth INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LLM usage metering
CREATE TABLE IF NOT EXISTS youbot_llm_usage (
  id SERIAL PRIMARY KEY,
  model TEXT NOT NULL,
  purpose TEXT,
  provider_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prompt experiments
CREATE TABLE IF NOT EXISTS youbot_prompt_experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  variants_json TEXT NOT NULL DEFAULT '[]',
  traffic_split_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Experiment results
CREATE TABLE IF NOT EXISTS youbot_experiment_results (
  id SERIAL PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES youbot_prompt_experiments(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  session_id TEXT,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  tool_successes INTEGER NOT NULL DEFAULT 0,
  tool_failures INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending approvals
CREATE TABLE IF NOT EXISTS youbot_pending_approvals (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  context TEXT,
  requester_jid TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scheduled tasks
CREATE TABLE IF NOT EXISTS youbot_scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tag TEXT,
  schedule TEXT NOT NULL,
  data TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tool metrics
CREATE TABLE IF NOT EXISTS youbot_tool_metrics (
  id SERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  session_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
