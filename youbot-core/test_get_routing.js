const http = require('http');
const req = http.request({
  hostname: '127.0.0.1', port: 5081, path: '/api/config/model-routing', method: 'GET',
  headers: { 'Authorization': 'Bearer testkey', 'Origin': 'http://localhost:5080' }
}, res => {
  let data = ''; res.on('data', c => data += c);
  res.on('end', () => console.log(res.statusCode, data));
});
req.end();
