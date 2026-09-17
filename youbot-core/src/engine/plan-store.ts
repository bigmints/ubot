import { log } from '../logger/ring-buffer.js';
import type { DatabaseConnection } from '../data/database/types.js';
import type { TaskPlan, TaskStep } from './task-planner.js';

export async function saveTaskPlan(sessionId: string, plan: TaskPlan, db: DatabaseConnection): Promise<void> {
  try {
    await db.execute(
      `INSERT OR REPLACE INTO youbot_task_plans (id, session_id, original_request, status, created_at) VALUES (?, ?, ?, ?, ?)`,
      [plan.id, sessionId, plan.originalRequest, plan.status, plan.createdAt.toISOString()]
    );

    await db.execute(`DELETE FROM youbot_task_steps WHERE plan_id = ?`, [plan.id]);

    if (plan.steps.length > 0) {
      for (const step of plan.steps) {
        await db.execute(
          `INSERT INTO youbot_task_steps (id, plan_id, description, agent_type, depends_on, status, prompt, result, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [step.id, plan.id, step.description, step.agentType, step.dependsOn.join(','), step.status, step.prompt || null, step.result || null, step.error || null]
        );
      }
    }

    log.info('PlanStore', `Saved plan ${plan.id} with ${plan.steps.length} steps in database`);
  } catch (err: any) {
    log.error('PlanStore', `Failed to save task plan: ${err.message}`);
    throw err;
  }
}

export async function getTaskPlan(planId: string, db: DatabaseConnection): Promise<TaskPlan | null> {
  try {
    const row = await db.get(
      `SELECT * FROM youbot_task_plans WHERE id = ?`,
      [planId]
    );
      
    if (!row) return null;

    const stepRows = await db.query(
      `SELECT * FROM youbot_task_steps WHERE plan_id = ?`,
      [planId]
    );

    const steps: TaskStep[] = stepRows.map((s: any) => ({
      id: s.id,
      description: s.description,
      agentType: s.agent_type,
      dependsOn: s.depends_on ? s.depends_on.split(',') : [],
      status: s.status as TaskStep['status'],
      prompt: s.prompt || undefined,
      result: s.result || undefined,
      error: s.error || undefined
    }));

    return {
      id: row.id,
      sessionId: row.session_id,
      originalRequest: row.original_request,
      steps,
      createdAt: new Date(row.created_at),
      status: row.status as TaskPlan['status']
    };
  } catch (err: any) {
    log.error('PlanStore', `Failed to get task plan: ${err.message}`);
    return null;
  }
}

export async function getActivePlan(sessionId: string, db: DatabaseConnection): Promise<TaskPlan | null> {
  try {
    const row = await db.get(
      `SELECT id FROM youbot_task_plans WHERE session_id = ? AND status IN ('planning', 'executing') ORDER BY created_at DESC LIMIT 1`,
      [sessionId]
    );
      
    if (!row) return null;
    return await getTaskPlan(row.id, db);
  } catch (err: any) {
    log.error('PlanStore', `Failed to get active plan for session ${sessionId}: ${err.message}`);
    return null;
  }
}

export async function updateStepStatus(
  planId: string, 
  stepId: string, 
  status: TaskStep['status'], 
  result?: string, 
  error?: string, 
  db?: DatabaseConnection
): Promise<void> {
  if (!db) return;
  try {
    await db.execute(
      `UPDATE youbot_task_steps SET status = ?, result = ?, error = ? WHERE plan_id = ? AND id = ?`,
      [status, result || null, error || null, planId, stepId]
    );
  } catch (err: any) {
    log.error('PlanStore', `Failed to update step status: ${err.message}`);
  }
}

export async function updatePlanStatus(planId: string, status: TaskPlan['status'], db: DatabaseConnection): Promise<void> {
  try {
    await db.execute(
      `UPDATE youbot_task_plans SET status = ? WHERE id = ?`,
      [status, planId]
    );
  } catch (err: any) {
    log.error('PlanStore', `Failed to update plan status: ${err.message}`);
  }
}
