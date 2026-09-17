const fs = require('fs');
let lastKeys = '';
setInterval(() => {
  try {
    const raw = fs.readFileSync('config.json', 'utf8');
    const cfg = JSON.parse(raw);
    const keys = Object.keys(cfg.capabilities?.models?.providers || {}).join(',');
    if (keys !== lastKeys) {
      console.log(new Date().toISOString(), 'Providers in config.json:', keys);
      lastKeys = keys;
    }
  } catch(e) {}
}, 500);
