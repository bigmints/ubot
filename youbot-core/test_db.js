import { createConnection } from './dist/data/database/connection.js';
import { createMemoryStore } from './dist/memory/memory-store.js';

process.env.SQLITE_DB_PATH = 'test.sqlite';

const db = createConnection({ config: { provider: 'sqlite' } });
const store = createMemoryStore(db);

async function test() {
  console.log("Retrieving persona...");
  const doc = await store.getDocument("test_persona");
  console.log("doc:", doc);

  console.log("Listing personas...");
  const docs = await store.listDocuments();
  console.log("docs:", docs.length);
  
  console.log("Saving memory...");
  await store.saveMemory("contact-123", "fact", "name", "Pretheesh");
  
  console.log("Retrieving memory...");
  const memories = await store.getMemories("contact-123");
  console.log("memories:", memories.length, memories[0].key, memories[0].value);

  console.log("DONE");
}

test().catch(console.error).finally(() => db.close());
