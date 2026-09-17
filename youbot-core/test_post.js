const fs = require('fs');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
if(!config.capabilities) config.capabilities = {};
if(!config.capabilities.models) config.capabilities.models = { providers: {} };
config.capabilities.models.providers['test-provider'] = { apiKey: 'test', enabled: true };
fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
console.log("Wrote test-provider to config.json");
