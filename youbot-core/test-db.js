import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await client.rpc('get_table_info', { table_name: 'youbot_chat_sessions' });
  if (error) {
     console.log('No RPC endpoint maybe? fallback check primary key');
     const { data: cols } = await client.from('youbot_chat_sessions').select('id').limit(1);
     console.log('cols error:', error);
  }
}
run();
