/**
 * Crew Registry
 * 
 * Manages the multi-agent system state, providing discovery, validation, and lifecycle bounds
 * for specialized agents. Replaces the isolated `agents` Map in older orchestrator builds.
 */

import { loadAgentDefinitions } from './agent-loader.js';
import type { AgentDefinition } from './types.js';

export class CrewRegistry {
  private static instance: CrewRegistry;
  private agents: Map<string, AgentDefinition> = new Map();
  private workspacePath: string = '';

  private constructor() {}

  public static getInstance(): CrewRegistry {
    if (!CrewRegistry.instance) {
      CrewRegistry.instance = new CrewRegistry();
    }
    return CrewRegistry.instance;
  }

  /** Initialize and load agents */
  public initialize(workspacePath: string): void {
    if (!workspacePath) return;
    this.workspacePath = workspacePath;
    this.reloadAgents();
  }

  /** Reload all agents directly from the workspace */
  public reloadAgents(): void {
    if (!this.workspacePath) return;

    const loadedAgents = loadAgentDefinitions(this.workspacePath);
    this.agents.clear();

    for (const agent of loadedAgents) {
      this.agents.set(agent.id, agent);
      console.log(`[CrewRegistry] Registered specialized agent: ${agent.id} (${agent.name})`);
    }
  }

  /** Fetch a specific agent definition by ID */
  public getAgent(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** Check if an agent exists */
  public hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  /** Retrieve all loaded specialized agents */
  public listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /** Register an agent dynamically at runtime */
  public registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
    console.log(`[CrewRegistry] Dynamically registered agent: ${agent.id}`);
  }
}

export const crewRegistry = CrewRegistry.getInstance();
