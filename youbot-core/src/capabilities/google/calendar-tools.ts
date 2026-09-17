import { google } from 'googleapis';
import { loadYoubotConfig } from '../../data/config.js';
import type { ToolDefinition } from '../../tools/types.js';

function getCalendarClient() {
  const config = loadYoubotConfig();
  const creds = config.capabilities?.google?.services?.calendar?.credentials;
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    throw new Error('Google Calendar is not fully configured or authenticated.');
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris?.[0]
  );
  
  oauth2Client.setCredentials({ refresh_token: creds.refresh_token });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export const calendarTools: ToolDefinition[] = [
  {
    name: 'google_calendar_list_events',
    description: 'Lists upcoming events on the user\'s Google Calendar. By default lists the next 10 events.',
    parameters: [
      { name: 'maxResults', type: 'number', description: 'Maximum number of events to return. Defaults to 10.', required: false },
      { name: 'timeMin', type: 'string', description: 'Lower bound for an event\'s end time to filter by. Must be an RFC3339 timestamp. Defaults to current time.', required: false },
      { name: 'timeMax', type: 'string', description: 'Upper bound for an event\'s start time to filter by. Must be an RFC3339 timestamp.', required: false },
    ],
  },
  {
    name: 'google_calendar_create_event',
    description: 'Creates a new event on the user\'s Google Calendar.',
    parameters: [
      { name: 'summary', type: 'string', description: 'Title of the event', required: true },
      { name: 'description', type: 'string', description: 'Description of the event', required: false },
      { name: 'startTime', type: 'string', description: 'Start time of the event as an RFC3339 timestamp (e.g. 2026-06-25T14:00:00Z)', required: true },
      { name: 'endTime', type: 'string', description: 'End time of the event as an RFC3339 timestamp (e.g. 2026-06-25T15:00:00Z)', required: true },
      { name: 'attendees', type: 'array', items: { type: 'string' }, description: 'List of email addresses of attendees to invite', required: false },
    ],
  },
  {
    name: 'google_calendar_delete_event',
    description: 'Deletes an event from the user\'s Google Calendar.',
    parameters: [
      { name: 'eventId', type: 'string', description: 'The ID of the event to delete', required: true },
    ],
  }
];

export async function listEvents(args: Record<string, unknown>): Promise<string> {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: (args.timeMin as string) || new Date().toISOString(),
    timeMax: (args.timeMax as string) || undefined,
    maxResults: (args.maxResults as number) || 10,
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = res.data.items || [];
  if (events.length === 0) {
    return 'No upcoming events found.';
  }

  return events.map((event, i) => {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    return `${i + 1}. ${event.summary} (${start} to ${end}) - ID: ${event.id}`;
  }).join('\n');
}

export async function createEvent(args: Record<string, unknown>): Promise<string> {
  const calendar = getCalendarClient();
  const event = {
    summary: args.summary as string,
    description: args.description as string,
    start: {
      dateTime: args.startTime as string,
    },
    end: {
      dateTime: args.endTime as string,
    },
    attendees: (args.attendees as string[])?.map(email => ({ email })),
  };

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    sendUpdates: args.attendees ? 'all' : 'none',
  });

  return `Event created successfully. Event ID: ${res.data.id}\nLink: ${res.data.htmlLink}`;
}

export async function deleteEvent(args: Record<string, unknown>): Promise<string> {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: 'primary',
    eventId: args.eventId as string,
  });

  return `Event ${args.eventId} deleted successfully.`;
}
