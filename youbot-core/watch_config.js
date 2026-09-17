const fs = require('fs');
console.log("Watching config.json...");
let lastContent = fs.readFileSync('config.json', 'utf8');
fs.watch('config.json', (eventType, filename) => {
  try {
    const newContent = fs.readFileSync('config.json', 'utf8');
    if (newContent !== lastContent) {
      console.log(`[${new Date().toISOString()}] config.json changed! Length: ${newContent.length}`);
      lastContent = newContent;
    }
  } catch (e) {}
});
