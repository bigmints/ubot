import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const cfgPath = path.resolve(process.cwd(), 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const client = createClient(cfg.memory.supabase_url, cfg.memory.supabase_service_key);

async function check() {
  const { data, error } = await client.rpc('get_table_info', { table_name: 'youbot_chat_sessions' });
  console.log('RPC result', data, error);
}

check();
