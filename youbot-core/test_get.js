const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 5081,
  path: '/api/integrations/models?t=123456',
  method: 'GET',
  headers: {
    'Cookie': 'bypass=true' // Try to bypass or just see if it returns 401
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(res.statusCode);
    console.log(data);
  });
});
req.end();
