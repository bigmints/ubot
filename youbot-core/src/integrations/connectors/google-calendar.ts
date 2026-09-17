import { google, type calendar_v3 } from 'googleapis';
import { z } from 'zod';
import type { ConnectorDefinition } from '../types.js';

const googleCalendarConfigSchema = z.object({
  clientId: z.string().min(1).describe('Google OAuth client ID'),
  clientSecret: z.string().min(1).describe('Google OAuth client secret').meta({ writeOnly: true }),
  refreshToken: z.string().min(1).describe('Google OAuth refresh token').meta({ writeOnly: true }),
  calendarId: z.string().min(1).default('primary'),
  syncFrom: z.string().datetime().optional().describe('Initial RFC3339 lower bound'),
});

type GoogleCalendarConfig = z.infer<typeof googleCalendarConfigSchema>;
type CalendarState = { syncToken?: string; pageToken?: string };

function client(config: GoogleCalendarConfig): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  return google.calendar({ version: 'v3', auth });
}

function eventText(event: calendar_v3.Schema$Event): string {
  const start = event.start?.dateTime || event.start?.date || '';
  const end = event.end?.dateTime || event.end?.date || '';
  return [event.summary || 'Untitled event', start && `${start} to ${end}`, event.location,
    event.description, event.status === 'cancelled' ? 'Cancelled' : '']
    .filter(Boolean).join('\n');
}

export const googleCalendarConnector: ConnectorDefinition<GoogleCalendarConfig> = {
  manifest: {
    protocolVersion: '1.0',
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Synchronize Google Calendar events and run calendar actions.',
    version: '1.0.0',
    documentationUrl: 'https://developers.google.com/calendar/api/guides/overview',
    auth: { type: 'oauth2', description: 'Requires an OAuth refresh token with Calendar access.' },
    capabilities: { incrementalSync: true, webhooks: false, actions: true },
    streams: [{
      name: 'events',
      title: 'Events',
      description: 'Calendar events, including updated and cancelled events.',
      primaryKey: ['externalId'],
      supportsIncremental: true,
      defaultCursorField: 'updated',
    }],
    actions: [
      {
        name: 'create_event', title: 'Create event', description: 'Create a calendar event.',
        inputSchema: {
          type: 'object', required: ['summary', 'startTime', 'endTime'],
          properties: {
            summary: { type: 'string' }, description: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' }, endTime: { type: 'string', format: 'date-time' },
            attendees: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
        name: 'delete_event', title: 'Delete event', description: 'Delete a calendar event.',
        inputSchema: { type: 'object', required: ['eventId'], properties: { eventId: { type: 'string' } } },
      },
    ],
  },
  configSchema: googleCalendarConfigSchema,

  async check({ config }) {
    try {
      await client(config).calendarList.list({ maxResults: 1 });
      return { ok: true, message: 'Google Calendar connection is valid' };
    } catch (error: any) {
      return { ok: false, message: error.message };
    }
  },

  async discover() {
    return this.manifest.streams;
  },

  async *read({ config, state, signal }) {
    const calendar = client(config);
    let current = (state || {}) as CalendarState;

    do {
      if (signal?.aborted) throw new Error('Sync aborted');
      const incremental = Boolean(current.syncToken);
      let response;
      try {
        response = await calendar.events.list({
          calendarId: config.calendarId,
          pageToken: current.pageToken,
          syncToken: current.syncToken,
          timeMin: incremental ? undefined : (config.syncFrom || new Date().toISOString()),
          singleEvents: true,
          showDeleted: true,
          maxResults: 250,
        });
      } catch (error: any) {
        // Google invalidates old sync tokens with HTTP 410. Reset to a full sync.
        if (current.syncToken && error?.response?.status === 410) {
          current = {};
          continue;
        }
        throw error;
      }
      const nextState: CalendarState = response.data.nextPageToken
        ? { syncToken: current.syncToken, pageToken: response.data.nextPageToken }
        : { syncToken: response.data.nextSyncToken || current.syncToken };
      yield {
        records: (response.data.items || []).filter((event) => event.id).map((event) => ({
          sourceId: 'google-calendar',
          stream: 'events',
          externalId: event.id!,
          updatedAt: event.updated || undefined,
          cursor: event.updated || undefined,
          text: eventText(event),
          data: event as Record<string, unknown>,
          metadata: { calendarId: config.calendarId, status: event.status || 'confirmed' },
          acl: (event.attendees || []).map((attendee) => attendee.email).filter((email): email is string => Boolean(email)),
        })),
        state: nextState,
      };
      current = nextState;
    } while (current.pageToken);
  },

  async executeAction({ config, action, input }) {
    const calendar = client(config);
    if (action === 'create_event') {
      const parsed = z.object({
        summary: z.string().min(1), description: z.string().optional(),
        startTime: z.string().datetime(), endTime: z.string().datetime(),
        attendees: z.array(z.string().email()).optional(),
      }).parse(input);
      const response = await calendar.events.insert({
        calendarId: config.calendarId,
        sendUpdates: parsed.attendees?.length ? 'all' : 'none',
        requestBody: {
          summary: parsed.summary, description: parsed.description,
          start: { dateTime: parsed.startTime }, end: { dateTime: parsed.endTime },
          attendees: parsed.attendees?.map((email) => ({ email })),
        },
      });
      return { id: response.data.id, htmlLink: response.data.htmlLink };
    }
    if (action === 'delete_event') {
      const { eventId } = z.object({ eventId: z.string().min(1) }).parse(input);
      await calendar.events.delete({ calendarId: config.calendarId, eventId });
      return { deleted: true, eventId };
    }
    throw new Error(`Unknown action "${action}"`);
  },
};
