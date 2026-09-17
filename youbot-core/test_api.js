const http = require('http');

const req = http.request('http://localhost:5081/api/integrations/models', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let data = '';
  res.on('data', c => data+=c);
  res.on('end', () => {
    console.log("POST res:", data);
    http.get('http://localhost:5081/api/integrations/models', (res2) => {
      let data2 = '';
      res2.on('data', c => data2+=c);
      res2.on('end', () => {
        console.log("GET res:", data2);
      });
    });
  });
});
req.write(JSON.stringify({key: 'openai-compat', apiKey: 'test', model: 'test-model', baseUrl: 'http://test.com/v1'}));
req.end();
