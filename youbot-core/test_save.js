import { loadYoubotConfig, saveYoubotConfig, activeConfigPath } from './src/data/config.js';
console.log("Initial path:", activeConfigPath);
const cfg = loadYoubotConfig();
console.log("Loaded path:", activeConfigPath);
if (!cfg.capabilities) cfg.capabilities = {};
if (!cfg.capabilities.models) cfg.capabilities.models = { providers: {} };
cfg.capabilities.models.providers['test-script'] = { enabled: true, apiKey: "TEST" };
saveYoubotConfig(cfg);
console.log("Saved to:", activeConfigPath);
