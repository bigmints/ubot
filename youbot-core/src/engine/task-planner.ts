/**
 * Task Decomposition Planner
 * 
 * Breaks complex requests into executable sub-tasks with dependencies.
 */

export interface TaskStep {
  id: string;              // e.g., "step-1"
  description: string;     // Human-readable description
  agentType: string;       // target agent (coder, general, nexus, etc)
  dependsOn: string[];     // Step IDs that must complete first
  status: 'pending' | 'awaiting_approval' | 'rejected' | 'running' | 'completed' | 'failed' | 'skipped';
  prompt?: string;         // The prompt to send to the subagent
  result?: string;         // Output from the subagent
  error?: string;          // Error if failed
}

export interface TaskPlan {
  id: string;
  sessionId: string;
  originalRequest: string;
  steps: TaskStep[];
  createdAt: Date;
  status: 'planning' | 'executing' | 'awaiting_approval' | 'completed' | 'failed' | 'partial';
}

/**
 * Creates a task plan by decomposing a complex request using an LLM.
 */
export async function createTaskPlan(
  sessionId: string,
  request: string,
  agentTypes: string[],
  generate: (system: string, user: string) => Promise<string>
): Promise<TaskPlan> {
  const planId = `plan-${Date.now().toString(36)}`;
  
  if (isSimpleRequest(request)) {
    return {
      id: planId,
      sessionId,
      originalRequest: request,
      steps: [
        {
          id: 'step-1',
          description: request,
          agentType: 'nexus',
          dependsOn: [],
          status: 'pending',
          prompt: request
        }
      ],
      createdAt: new Date(),
      status: 'executing'
    };
  }

  const systemPrompt = `You are Nexus, the Chief Orchestrator. Given a complex request, break it into sequential steps using your crew.

Available agent types and capabilities:
${agentTypes.map(a => `- ${a}`).join('\n')}

Rules:
- Each step should be a single, clear action for one agent
- Use dependsOn to express ordering (step 2 depends on step 1's output)
- Steps with no dependsOn can run in parallel
- Assign tasks to the lowest Autonomy Tier agent capable of doing it
- If the task requires specialized tools, pick the correct specialist
- If the task is simple (1-2 steps), return just 1-2 steps
- If the task doesn't need a specialist, return a single step with agentType "nexus"

Respond with ONLY valid JSON (no markdown fences):
{
  "steps": [
    { "id": "step-1", "description": "...", "agentType": "researcher", "dependsOn": [], "prompt": "..." },
    { "id": "step-2", "description": "...", "agentType": "writer", "dependsOn": ["step-1"], "prompt": "Using the research from the previous step: {step-1.result}, write..." }
  ]
}`;

  const response = await generate(systemPrompt, `Request: ${request}`);
  
  try {
    // Clean up response in case of markdown fences
    const jsonStr = response.replace(/```json\n?/, '').replace(/\n?```/, '').trim();
    const data = JSON.parse(jsonStr);
    
    if (!data.steps || !Array.isArray(data.steps)) {
      throw new Error('Invalid plan format: missing steps array');
    }

    const steps: TaskStep[] = data.steps.map((s: any) => ({
      ...s,
      status: 'pending',
      dependsOn: s.dependsOn || []
    }));

    // Validate dependencies
    const stepIds = new Set(steps.map(s => s.id));
    for (const step of steps) {
      for (const depId of step.dependsOn) {
        if (!stepIds.has(depId)) {
          throw new Error(`Invalid dependency: step ${step.id} depends on non-existent step ${depId}`);
        }
      }
    }

    // Check for circular dependencies
    if (hasCircularDependencies(steps)) {
      throw new Error('Circular dependencies detected in task plan');
    }

    return {
      id: planId,
      sessionId,
      originalRequest: request,
      steps,
      createdAt: new Date(),
      status: 'executing'
    };
  } catch (err: any) {
    console.error(`[TaskPlanner] Failed to parse or validate plan: ${err.message}`);
    // Fallback to a single general step if planning fails
    return {
      id: planId,
      sessionId,
      originalRequest: request,
      steps: [
        {
          id: 'step-1',
          description: request,
          agentType: 'nexus',
          dependsOn: [],
          status: 'pending',
          prompt: request
        }
      ],
      createdAt: new Date(),
      status: 'executing'
    };
  }
}

/**
 * Returns groups of steps that can run in parallel (topological sort).
 */
export function getExecutionOrder(steps: TaskStep[]): TaskStep[][] {
  const groups: TaskStep[][] = [];
  const completedIds = new Set<string>();
  const remainingSteps = [...steps];

  while (remainingSteps.length > 0) {
    const currentGroup = remainingSteps.filter(step => 
      step.dependsOn.every(depId => completedIds.has(depId))
    );

    if (currentGroup.length === 0) {
      // This should not happen if circular dependency check passed
      break;
    }

    groups.push(currentGroup);
    currentGroup.forEach(step => {
      completedIds.add(step.id);
      const idx = remainingSteps.indexOf(step);
      remainingSteps.splice(idx, 1);
    });
  }

  return groups;
}

/**
 * Heuristic to check if a request is simple enough to not need decomposition.
 */
export function isSimpleRequest(request: string): boolean {
  const lower = request.toLowerCase();
  
  // Complexity markers
  const markers = [' then ', ' after that ', ' and then ', ' followed by ', ' first ', ' finally '];
  if (markers.some(m => lower.includes(m))) return false;
  
  // Word count heuristic
  const words = request.split(/\s+/).filter(Boolean);
  if (words.length > 20) return false;
  
  // Count verbs (very rough approximation)
  const commonVerbs = ['search', 'find', 'write', 'create', 'publish', 'post', 'check', 'get', 'send'];
  let verbCount = 0;
  for (const verb of commonVerbs) {
    if (lower.includes(verb)) verbCount++;
  }
  
  return verbCount <= 1;
}

/**
 * Detects circular dependencies in a set of steps.
 */
function hasCircularDependencies(steps: TaskStep[]): boolean {
  const adj = new Map<string, string[]>();
  steps.forEach(s => adj.set(s.id, s.dependsOn));

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function isCyclic(id: string): boolean {
    if (recStack.has(id)) return true;
    if (visited.has(id)) return false;

    visited.add(id);
    recStack.add(id);

    const neighbors = adj.get(id) || [];
    for (const neighbor of neighbors) {
      if (isCyclic(neighbor)) return true;
    }

    recStack.delete(id);
    return false;
  }

  for (const step of steps) {
    if (isCyclic(step.id)) return true;
  }

  return false;
}
