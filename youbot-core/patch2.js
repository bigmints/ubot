const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');
content = content.replace(`    const isPublicApi = url === '/api/health' 
      || url.startsWith('/api/webchat/')
      || url.startsWith('/api/auth/');`, `    const isPublicApi = url === '/api/health' 
      || url.startsWith('/api/webchat/')
      || url.startsWith('/api/auth/')
      || url.startsWith('/api/integrations/');`);
fs.writeFileSync('src/index.ts', content);
