export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface EmailMessage {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailSkill {
  sendEmail(message: EmailMessage): Promise<EmailResult>;
  verifyConnection(): Promise<boolean>;
}

// LLM Types

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
}

export interface LLMCompletionResponse {
  id: string;
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface LLMClientConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  defaultOptions?: LLMCompletionOptions;
}

export interface LLMClient {
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResponse>;
  stream(messages: LLMMessage[], options?: LLMCompletionOptions): AsyncIterable<string>;
}