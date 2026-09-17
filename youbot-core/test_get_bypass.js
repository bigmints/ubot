const http = require('http');
const req = http.request({
  hostname: '127.0.0.1', port: 5081, path: '/api/integrations/models?t=123', method: 'GET'
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(res.statusCode, data));
});
req.end();
