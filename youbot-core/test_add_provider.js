const http = require('http');

const body = JSON.stringify({
  key: "openai-compat",
  apiKey: "sk-12345",
  model: "gpt-4",
  baseUrl: "https://api.openai.com/v1",
  modelOverride: "gpt-4"
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 5081,
  path: '/api/integrations/models',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Authorization': 'Bearer testkey' // Wait, I need an API key from config.json to bypass auth!
  }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write(body);
req.end();
