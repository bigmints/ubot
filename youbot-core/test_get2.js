const http = require('http');
const req = http.request({
  hostname: '127.0.0.1', port: 5081, path: '/api/integrations/models', method: 'GET',
  headers: { 'Authorization': 'Bearer testkey' }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log(data));
});
req.end();
