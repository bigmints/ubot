import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const cfgPath = path.resolve(process.cwd(), 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const supabase = createClient(cfg.database.supabase_url, cfg.database.supabase_service_key);

async function checkChatSessions() {
  const { data: sessions } = await supabase.from('youbot_chat_sessions').select('*');
  console.log("Total chat sessions:", sessions?.length);
  
  if (sessions) {
    const subagents = sessions.filter(s => s.id.startsWith('subagent-'));
    console.log("Subagent chat sessions:", subagents.length);
    if (subagents.length > 0) {
       console.log("Sample:", subagents[0].id);
    }
  }
}
checkChatSessions();
