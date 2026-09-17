import { z } from 'zod';

export const INTEGRATION_PROTOCOL_VERSION = '1.0' as const;

export const connectorStreamSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  primaryKey: z.array(z.string().min(1)).min(1).default(['externalId']),
  supportsIncremental: z.boolean().default(false),
  defaultCursorField: z.string().min(1).optional(),
});

export const connectorActionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
});

export const connectorManifestSchema = z.object({
  protocolVersion: z.literal(INTEGRATION_PROTOCOL_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  documentationUrl: z.string().url().optional(),
  auth: z.object({
    type: z.enum(['none', 'api_key', 'basic', 'oauth2', 'custom']),
    description: z.string().optional(),
  }),
  capabilities: z.object({
    incrementalSync: z.boolean().default(false),
    webhooks: z.boolean().default(false),
    actions: z.boolean().default(false),
  }),
  streams: z.array(connectorStreamSchema).default([]),
  actions: z.array(connectorActionSchema).default([]),
});

export const externalRecordSchema = z.object({
  sourceId: z.string().min(1),
  stream: z.string().min(1),
  externalId: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
  cursor: z.unknown().optional(),
  text: z.string().default(''),
  data: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).default({}),
  acl: z.array(z.string()).default([]),
  fingerprint: z.string().optional(),
});

export const connectorCheckResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type ConnectorStream = z.infer<typeof connectorStreamSchema>;
export type ConnectorAction = z.infer<typeof connectorActionSchema>;
export type ExternalRecord = z.infer<typeof externalRecordSchema>;
export type ConnectorCheckResult = z.infer<typeof connectorCheckResultSchema>;
