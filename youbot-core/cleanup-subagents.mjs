import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const cfgPath = path.resolve(process.cwd(), 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const supabase = createClient(cfg.database.supabase_url, cfg.database.supabase_service_key);

async function purgeSubagentSessions() {
  const { data: sessions } = await supabase.from('youbot_chat_sessions').select('id');
  const idsToDelete = sessions?.filter(s => s.id.startsWith('subagent-')).map(s => s.id) || [];
  
  if (idsToDelete.length > 0) {
    const { error } = await supabase.from('youbot_chat_sessions').delete().in('id', idsToDelete);
    if (!error) {
       console.log(`Successfully purged ${idsToDelete.length} obsolete subagent wrapper sessions.`);
    } else {
       console.error(error);
    }
  } else {
    console.log("No subagent spacer sessions to clean up.");
  }
}

purgeSubagentSessions();
