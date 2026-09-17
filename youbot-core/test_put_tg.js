const http = require('http');
const body = JSON.stringify({ enabled: true, botToken: 'test', provider: 'telegraf' });
const req = http.request({
  hostname: '127.0.0.1', port: 5081, path: '/api/integrations/telegram', method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Authorization': 'Bearer testkey' }
}, res => {
  let data = ''; res.on('data', c => data += c);
  res.on('end', () => console.log(res.statusCode, data));
});
req.write(body); req.end();
