import { EventEmitter } from 'events';

export interface AgentMessage {
  id: string;
  sourceAgent: string;
  targetAgent?: string; // Optional: if omitted, broadcast to all listeners of the topic
  topic: string;
  payload: any;
  timestamp: Date;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

/**
 * Internal Message Bus for Inter-Agent Communication
 * Allows agents to publish events that other agents (or the manager) can subscribe to.
 */
export class MessageBus {
  private static instance: MessageBus;
  private emitter: EventEmitter;

  private constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0); // Unlimited listeners for the crew
  }

  public static getInstance(): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus();
    }
    return MessageBus.instance;
  }

  /** Publish a message to a specific topic */
  public publish(sourceAgent: string, topic: string, payload: any, targetAgent?: string): AgentMessage {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      sourceAgent,
      targetAgent,
      topic,
      payload,
      timestamp: new Date()
    };
    
    // Emit to exact topic
    this.emitter.emit(topic, message);
    
    // Emit to a catch-all for debugging/global logging
    this.emitter.emit('*', message);
    
    console.log(`[MessageBus] ${sourceAgent} published to '${topic}'`);
    return message;
  }

  /** Subscribe to a topic */
  public subscribe(topic: string, handler: MessageHandler): () => void {
    this.emitter.on(topic, handler);
    // Return an unsubscribe function
    return () => {
      this.emitter.off(topic, handler);
    };
  }

  /** Subscribe to all messages (for the manager or logging) */
  public subscribeAll(handler: MessageHandler): () => void {
    this.emitter.on('*', handler);
    return () => {
      this.emitter.off('*', handler);
    };
  }
}

export const messageBus = MessageBus.getInstance();
