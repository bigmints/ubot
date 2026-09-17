import http from 'http';
import { json, type ApiContext } from '../context.js';
import { getLoadedToolModules } from '../../tools/custom-loader.js';

export async function handleModulesRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {
  if (url === '/api/modules' && method === 'GET') {
    const modules = getLoadedToolModules();
    
    const results = modules.map((m: any) => {
      // Return metadata, including the injected UI options from tool module (if any)
      return {
        name: m.name,
        ui: m.ui,
      };
    });

    json(res, { modules: results });
    return true;
  }
  return false;
}
