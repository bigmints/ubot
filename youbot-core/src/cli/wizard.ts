import * as readline from 'readline/promises';
import { Writable } from 'node:stream';
import { loadYoubotConfig, saveYoubotConfig } from '../data/config.js';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface WizardModule {
  id: string;
  question: string;
  defaultVal?: string;
  isPassword?: boolean;
  apply: (value: string, config: any) => void;
}

const wizardModules: WizardModule[] = [
  {
    id: 'adminUser',
    question: 'Enter Dashboard Admin Username:',
    defaultVal: 'admin',
    apply: (val, config) => {
      config.server = config.server || {};
      config.server.auth = config.server.auth || {};
      config.server.auth.username = val;
    }
  },
  {
    id: 'adminPass',
    question: 'Enter Dashboard Password (leave blank to auto-generate):',
    isPassword: true,
    apply: (val, config) => {
      config.server = config.server || {};
      config.server.auth = config.server.auth || {};
      const finalVal = val || crypto.randomBytes(8).toString('hex');
      config.server.auth.password = finalVal;
      console.log('\n🔑 Dashboard password saved.');
    }
  },
  {
    id: 'supabaseUrl',
    question: 'Enter Supabase URL (e.g. https://xyz.supabase.co):',
    apply: (val, config) => {
      config.database = config.database || { provider: 'supabase' };
      if (val) config.database.supabase_url = val;
    }
  },
  {
    id: 'supabaseKey',
    question: 'Enter Supabase Service Role Key (sb_secret_...):',
    isPassword: true,
    apply: (val, config) => {
      config.database = config.database || { provider: 'supabase' };
      if (val) config.database.supabase_service_key = val;
    }
  },
  {
    id: 'llmProvider',
    question: 'Choose default LLM Provider (gemini/ollama/lmstudio):',
    defaultVal: 'gemini',
    apply: (val, config) => {
      config.capabilities = config.capabilities || {};
      config.capabilities.models = config.capabilities.models || {};
      config.capabilities.models.default = val;
    }
  },
  {
    id: 'llmApiKey',
    question: 'Enter API Key for the LLM Provider:',
    isPassword: true,
    apply: (val, config) => {
      config.capabilities = config.capabilities || {};
      config.capabilities.models = config.capabilities.models || {};
      config.capabilities.models.providers = config.capabilities.models.providers || {};
      
      const provider = config.capabilities.models.default || 'gemini';
      config.capabilities.models.providers[provider] = config.capabilities.models.providers[provider] || {};
      if (val) config.capabilities.models.providers[provider].apiKey = val;
    }
  }
];

async function runAutoMigration(connectionString: string, migrationsDir: string) {
  console.log(`\n🚀 Connecting to Postgres for Auto-Migration...`);
  
  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found at: ${migrationsDir}`);
    return;
  }

  const sqlConnections = postgres(connectionString, { ssl: 'require' });
  
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log(`⚠️ No migration scripts (.sql) found in ${migrationsDir}.`);
    }

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      
      console.log(`📦 Running migration: ${file}...`);
      // Warning: Standard postgres.js doesn't natively batch complex statements trivially using template literal syntax.
      // Since it's raw schema SQL, we can execute it utilizing unsafe execution.
      await sqlConnections.unsafe(sqlContent);
      console.log(`✅ Success: ${file}\n`);
    }

    console.log(`🎉 Database tables created successfully!`);
  } catch (err: any) {
    console.error(`❌ Auto-migration failed: ${err.message}`);
  } finally {
    await sqlConnections.end();
  }
}

async function main() {
  console.log(`
=========================================
🤖 Welcome to the YOUBOT Interactive Setup!
=========================================
This wizard will securely collect your credentials
and prepare your environment instantly. (Press Enter to use defaults)
`);

  class SecretAwareOutput extends Writable {
    muted = false;

    _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      if (!this.muted) process.stdout.write(chunk, encoding);
      callback();
    }
  }

  const output = new SecretAwareOutput();
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
  });

  const ask = async (prompt: string, secret = false): Promise<string> => {
    if (!secret || !process.stdin.isTTY) return rl.question(prompt);
    process.stdout.write(prompt);
    output.muted = true;
    try {
      return await rl.question('');
    } finally {
      output.muted = false;
      process.stdout.write('\n');
    }
  };

  const config = loadYoubotConfig();

  for (const module of wizardModules) {
    const promptStr = module.defaultVal 
      ? `\n${module.question} [${module.defaultVal}]: `
      : `\n${module.question} `;
      
    let answer = await ask(promptStr, module.isPassword === true);
    answer = answer.trim();
    
    if (!answer && module.defaultVal) {
      answer = module.defaultVal;
    }

    module.apply(answer, config);
  }

  saveYoubotConfig(config);
  console.log(`\n💾 Configuration saved securely.`);

  // Auto-Migration Prompt
  console.log(`\n=========================================`);
  console.log(`🛠  Database Auto-Migration Initialization`);
  console.log(`=========================================`);
  const migrateAnswer = await rl.question(`\nWould you like YOUBOT to automatically create your Supabase tables right now? (y/n) [y]: `);
  
  const wantsMigration = migrateAnswer.trim().toLowerCase() !== 'n';
  
  if (wantsMigration) {
    const connStr = await ask(`\nEnter your Supabase Postgres Connection String (e.g. postgresql://postgres.xyz:pwd@aws...): `, true);
    
    if (connStr.trim()) {
      const YOUBOT_HOME = process.env.YOUBOT_HOME || '';
  const migrationsDir = path.join(process.env.YOUBOT_APP_HOME || YOUBOT_HOME, 'migrations');
      await runAutoMigration(connStr.trim(), migrationsDir);
    } else {
      console.log(`⚠️ Skipped: No connection string provided.`);
    }
  } else {
    console.log(`⏩ Auto-migration skipped.`);
  }

  rl.close();
  console.log(`\n✅ Setup Sequence Complete! Youbot is ready to execute.`);
}

main().catch(console.error);
