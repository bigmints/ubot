const http = require('http');
const body = JSON.stringify({
  webchat: { enabled: true },
  port: 5080,
  apiKeys: ['testkey']
});
const req = http.request({
  hostname: '127.0.0.1', port: 5081, path: '/api/chat/config', method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
    'Authorization': 'Bearer testkey'
  }
}, res => {
  let data = ''; res.on('data', c => data += c);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write(body); req.end();
