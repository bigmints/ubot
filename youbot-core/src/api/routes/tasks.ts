import http from 'http';
import { json, error, type ApiContext } from '../context.js';
import { authenticate } from '../middleware/auth.js';

export async function handleTasksRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  method: string,
  ctx: ApiContext,
): Promise<boolean> {
  if (!url.startsWith('/api/tasks')) return false;

  const authResult = authenticate(req);
  if (!authResult.authenticated) {
    error(res, 'Authentication required', 401);
    return true;
  }

  // GET /api/tasks
  if (url === '/api/tasks' && method === 'GET') {
    try {
      const db = ctx.coreDb;
      if (!db) {
        error(res, 'Database not configured', 500);
        return true;
      }
      
      // Get all task plans, order by newest
      const plans = await db.query(`SELECT * FROM youbot_task_plans ORDER BY created_at DESC`);
      const steps = await db.query(`SELECT * FROM youbot_task_steps`);
      
      const planMap = (plans || []).map((p: any) => ({
        id: p.id,
        sessionId: p.session_id,
        originalRequest: p.original_request,
        status: p.status,
        createdAt: new Date(p.created_at),
        updatedAt: new Date(p.updated_at),
        steps: (steps || []).filter((s: any) => s.plan_id === p.id).map((s: any) => ({
          id: s.id,
          description: s.description,
          status: s.status,
          result: s.result,
          error: s.error,
        }))
      }));

      // Also get spawned sessions (subagents)
      const spawned = await db.query(`SELECT * FROM youbot_spawned_sessions ORDER BY start_time DESC`);
      
      const spawnedMap = (spawned || []).map((s: any) => {
        const sStatus = s.status === 'running' ? 'executing' : s.status;
        return {
          id: s.id,
          sessionId: s.agent_id ? `${s.agent_id} (subagent)` : 'subagent',
          originalRequest: s.task,
          status: sStatus,
          createdAt: new Date(s.start_time),
          updatedAt: new Date(s.end_time || s.start_time),
          steps: [{
            id: `step-${s.id}`,
            description: s.task,
            status: sStatus,
            result: s.result,
            error: s.error,
          }]
        };
      });

      // Set CORS intentionally since this is an internal API
      res.setHeader('Access-Control-Allow-Origin', '*'); 
      json(res, { plans: [...planMap, ...spawnedMap].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) });
    } catch (err: any) {
      error(res, err.message, 500);
    }
    return true;
  }

  return false;
}
