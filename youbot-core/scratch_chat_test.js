import { loadYoubotConfig } from './dist/data/config.js';

const cfg = loadYoubotConfig();
let configUpdates = {};

const models = cfg.capabilities?.models;
if (models?.providers) {
  const defaultKey = models.default || Object.keys(models.providers)[0] || '';
  const llmProviders = Object.entries(models.providers)
    .filter(([_, p]) => p.enabled !== false)
    .map(([key, p]) => {
      let baseUrl = (p.baseUrl || '').trim();
      return {
        id: key,
        name: key,
        provider: key,
        baseUrl,
        apiKey: (p.apiKey || '').trim(),
        model: (p.model || '').trim(),
        isDefault: key === defaultKey,
        models: p.models,
      };
    });
  if (llmProviders.length > 0) {
    configUpdates.llmProviders = llmProviders;
  }
}

if (cfg.modelRouting) {
  configUpdates.modelRouting = cfg.modelRouting;
}

console.log('Mapped llmProviders:', JSON.stringify(configUpdates.llmProviders, null, 2));
console.log('Mapped modelRouting:', JSON.stringify(configUpdates.modelRouting, null, 2));

