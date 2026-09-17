import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolResult } from '@youbot/collection-engine';
import { describe, expect, it } from 'vitest';
import { YoubotCollectionService, channelActor, ownerActor } from '../service.js';

type Money = { amount: number; currency: string };
type Values = Record<string, unknown>;
type FixtureItem = { id: string; status?: 'available' | 'unavailable' | 'unknown'; values: Values };
type Fixture = {
  key: string;
  name: string;
  domain: string;
  source: string;
  schema: Array<Record<string, unknown>>;
  view: Record<string, unknown>;
  items: FixtureItem[];
};
type SearchRow = { collectionId: string; item: { id: string; revision: number; values: Values } };
type Question = {
  id: string;
  business: string;
  question: string;
  args: Record<string, unknown>;
  expectedIds: string[];
  ordered?: boolean;
  verify?: (rows: SearchRow[], data: Record<string, unknown>) => void;
};

const money = (amount: number, currency = 'AED'): Money => ({ amount, currency });

function unwrap(result: ToolResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data as Record<string, unknown>;
}

function rows(data: Record<string, unknown>): SearchRow[] {
  return data.items as SearchRow[];
}

function evidence(sourceRevisionId: string, values: Values) {
  return Object.keys(values).map((fieldId) => ({ sourceRevisionId, fieldId }));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const PRIVATE_CANARIES = [
  'DOCTOR-PRIVATE-050-555-0199',
  'REALTY-PRIVATE-SELLER-555',
  'DESIGN-PRIVATE-FLOOR-3700',
  'GUITAR-PRIVATE-DOOR-CODE-8124',
  'SALON-PRIVATE-STAFF-RATE-55',
  'OTHER-ENTITY-ONLY-CANARY',
] as const;

const fixtures: Fixture[] = [
  {
    key: 'doctor',
    name: '[E2E] Harbor Family Clinic',
    domain: 'health-services',
    source: 'Family medicine in Dubai Marina. In-person AED 350; video AED 250. Same-day appointments and all availability require staff confirmation. Emergency symptoms are not handled. DOCTOR-PRIVATE-050-555-0199 is owner-only.',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true, identity: 'candidate' },
      { id: 'mode', label: 'Mode', type: 'string', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'hours', label: 'Hours', type: 'string', public: true },
      { id: 'availabilityNote', label: 'Availability', type: 'string', public: true },
      { id: 'safetyNote', label: 'Safety', type: 'string', public: true },
      { id: 'privatePhone', label: 'Private phone', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'cards', titleField: 'service', visibleFields: ['mode', 'price', 'hours', 'availabilityNote', 'safetyNote'] },
    items: [
      { id: 'doctor-in-person', values: { service: 'Family medicine consultation', mode: 'in-person', price: money(350), hours: 'Monday, Wednesday and Thursday 09:00–17:00; Tuesday 12:00–20:00; Friday 09:00–13:00', availabilityNote: 'Same-day appointments may be available but must be confirmed by staff.', safetyNote: 'Emergency symptoms are not handled; contact emergency services.', privatePhone: 'DOCTOR-PRIVATE-050-555-0199' } },
      { id: 'doctor-video', values: { service: 'Family medicine consultation', mode: 'video', price: money(250), hours: 'During clinic opening hours', availabilityNote: 'Appointment availability must be confirmed by staff.', safetyNote: 'Emergency symptoms are not handled; contact emergency services.' } },
      { id: 'doctor-travel', values: { service: 'Travel health consultation', mode: 'in-person', price: null, hours: 'During clinic opening hours', availabilityNote: 'Appointment availability must be confirmed by staff.', safetyNote: 'Emergency symptoms are not handled; contact emergency services.' } },
    ],
  },
  {
    key: 'realty',
    name: '[E2E] Palm & Key Realty',
    domain: 'properties',
    source: 'PK-101 and PK-102 are available; PK-103 is unavailable and its price is unknown. Viewing and current availability must be confirmed. REALTY-PRIVATE-SELLER-555 is owner-only.',
    schema: [
      { id: 'listingId', label: 'Listing ID', type: 'string', public: true, identity: 'strong' },
      { id: 'name', label: 'Property', type: 'string', public: true },
      { id: 'location', label: 'Location', type: 'string', public: true },
      { id: 'bedrooms', label: 'Bedrooms', type: 'number', public: true },
      { id: 'bathrooms', label: 'Bathrooms', type: 'number', public: true },
      { id: 'area', label: 'Area', type: 'number', unit: 'sq ft', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'priceNote', label: 'Price note', type: 'string', public: true },
      { id: 'viewingNote', label: 'Viewing', type: 'string', public: true },
      { id: 'privateSeller', label: 'Private seller note', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'gallery', titleField: 'name', subtitleField: 'location', visibleFields: ['listingId', 'bedrooms', 'bathrooms', 'area', 'price', 'availability', 'viewingNote'] },
    items: [
      { id: 'property-pk-101', status: 'available', values: { listingId: 'PK-101', name: 'Marina View Apartment', location: 'Dubai Marina', bedrooms: 2, bathrooms: 2, area: 1220, price: money(1850000), availability: 'Available, subject to agent confirmation', viewingNote: 'Viewing times and current availability must be confirmed by the agent.', privateSeller: 'REALTY-PRIVATE-SELLER-555' } },
      { id: 'property-pk-102', status: 'available', values: { listingId: 'PK-102', name: 'Garden Townhouse', location: 'Arabian Ranches', bedrooms: 3, bathrooms: 3, area: 2100, price: money(2750000), availability: 'Available, subject to agent confirmation', viewingNote: 'Viewing times and current availability must be confirmed by the agent.' } },
      { id: 'property-pk-103', status: 'unavailable', values: { listingId: 'PK-103', name: 'Creek Studio', location: 'Dubai Creek Harbour', bedrooms: 0, bathrooms: 1, area: 510, price: null, availability: 'Unavailable', priceNote: 'Price unknown', viewingNote: 'Viewing times and current availability must be confirmed by the agent.' } },
    ],
  },
  {
    key: 'designer',
    name: '[E2E] Mira Vale Design',
    domain: 'creative-services',
    source: 'Brand Starter AED 4500, Website Launch AED 9500, Design Day AED 2000. Deposit 50 percent after proposal approval. Availability requires confirmation. DESIGN-PRIVATE-FLOOR-3700 is owner-only.',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true, identity: 'strong' },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'timeline', label: 'Timeline', type: 'string', public: true },
      { id: 'includes', label: 'Includes', type: 'string', public: true },
      { id: 'deposit', label: 'Deposit', type: 'string', public: true },
      { id: 'portfolio', label: 'Portfolio', type: 'string', multiple: true, public: true },
      { id: 'availabilityNote', label: 'Availability', type: 'string', public: true },
      { id: 'privateFloor', label: 'Private floor', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'cards', titleField: 'service', subtitleField: 'timeline', visibleFields: ['price', 'includes', 'deposit', 'portfolio', 'availabilityNote'] },
    items: [
      { id: 'design-brand-starter', values: { service: 'Brand Starter', price: money(4500), timeline: '2 weeks', includes: 'Logo, color palette and typography', deposit: '50 percent after proposal approval', portfolio: ['Cedar Coffee identity', 'Luma skincare packaging'], availabilityNote: 'New-project availability is unknown until Mira confirms.', privateFloor: 'DESIGN-PRIVATE-FLOOR-3700' } },
      { id: 'design-website-launch', values: { service: 'Website Launch', price: money(9500), timeline: '4–6 weeks', includes: 'Up to 5 responsive pages', deposit: '50 percent after proposal approval', portfolio: ['Northstar coaching website'], availabilityNote: 'New-project availability is unknown until Mira confirms.' } },
      { id: 'design-day', values: { service: 'Design Day', price: money(2000), timeline: 'One focused day', includes: 'One focused design day', deposit: '50 percent after proposal approval', portfolio: [], availabilityNote: 'New-project availability is unknown until Mira confirms.' } },
    ],
  },
  {
    key: 'guitar',
    name: '[E2E] Samir Guitar Studio',
    domain: 'classes',
    source: 'Beginner Foundations starts 7 October 2026. Adult Intermediate starts 8 October 2026. Private lessons are 45 minutes. Seats and schedules require confirmation. Closed on public holidays. GUITAR-PRIVATE-DOOR-CODE-8124 is owner-only.',
    schema: [
      { id: 'name', label: 'Class', type: 'string', public: true, identity: 'strong' },
      { id: 'format', label: 'Format', type: 'string', public: true },
      { id: 'ageMinimum', label: 'Minimum age', type: 'number', public: true },
      { id: 'schedule', label: 'Schedule', type: 'string', public: true },
      { id: 'startsAt', label: 'Starts', type: 'datetime', public: true },
      { id: 'sessions', label: 'Sessions', type: 'number', public: true },
      { id: 'durationMinutes', label: 'Duration', type: 'number', unit: 'minutes', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'capacity', label: 'Capacity', type: 'number', public: true },
      { id: 'notes', label: 'Notes', type: 'string', public: true },
      { id: 'privateDoorCode', label: 'Private door code', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'agenda', titleField: 'name', startField: 'startsAt', visibleFields: ['format', 'schedule', 'sessions', 'durationMinutes', 'price', 'capacity', 'notes'] },
    items: [
      { id: 'guitar-beginner', values: { name: 'Beginner Foundations', format: 'course', ageMinimum: 12, schedule: 'Wednesdays 18:00–19:00', startsAt: '2026-10-07T18:00:00+04:00', sessions: 8, durationMinutes: 60, price: money(1200), capacity: 8, notes: 'Course seat availability must be confirmed. Closed on public holidays.', privateDoorCode: 'GUITAR-PRIVATE-DOOR-CODE-8124' } },
      { id: 'guitar-intermediate', values: { name: 'Adult Intermediate', format: 'course', ageMinimum: 18, schedule: 'Thursdays 19:00–20:00', startsAt: '2026-10-08T19:00:00+04:00', sessions: 6, durationMinutes: 60, price: money(1050), capacity: 6, notes: 'Course seat availability must be confirmed. Closed on public holidays.' } },
      { id: 'guitar-private', values: { name: 'Private lesson', format: 'private', ageMinimum: null, schedule: 'Schedule by confirmation', startsAt: null, sessions: 1, durationMinutes: 45, price: money(220), capacity: 1, notes: 'Schedule must be confirmed. Closed on public holidays.' } },
    ],
  },
  {
    key: 'salon',
    name: '[E2E] Noor Beauty Lounge',
    domain: 'beauty-services',
    source: 'Haircut, blow-dry, manicure, facial and hair colour. Last booking starts 90 minutes before closing. Patch test 48 hours before first hair-colour service. Availability needs confirmation. SALON-PRIVATE-STAFF-RATE-55 is owner-only.',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true, identity: 'strong' },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'durationMinutes', label: 'Duration', type: 'number', unit: 'minutes', public: true },
      { id: 'hours', label: 'Hours', type: 'string', public: true },
      { id: 'lastBooking', label: 'Last booking', type: 'string', public: true },
      { id: 'requirements', label: 'Requirements', type: 'string', public: true },
      { id: 'availabilityNote', label: 'Availability', type: 'string', public: true },
      { id: 'privateStaffRate', label: 'Private staff rate', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'cards', titleField: 'service', visibleFields: ['price', 'durationMinutes', 'hours', 'lastBooking', 'requirements', 'availabilityNote'] },
    items: [
      { id: 'salon-haircut', values: { service: "Women's haircut", price: money(180), durationMinutes: 60, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', availabilityNote: 'Booking availability must be confirmed by staff.', privateStaffRate: 'SALON-PRIVATE-STAFF-RATE-55' } },
      { id: 'salon-blow-dry', values: { service: 'Blow-dry', price: money(120), durationMinutes: 45, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', availabilityNote: 'Booking availability must be confirmed by staff.' } },
      { id: 'salon-classic-manicure', values: { service: 'Classic manicure', price: money(90), durationMinutes: 45, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', availabilityNote: 'Booking availability must be confirmed by staff.' } },
      { id: 'salon-gel-manicure', values: { service: 'Gel manicure', price: money(150), durationMinutes: 60, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', availabilityNote: 'Booking availability must be confirmed by staff.' } },
      { id: 'salon-facial', values: { service: 'Signature facial', price: money(320), durationMinutes: 75, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', availabilityNote: 'Booking availability must be confirmed by staff.' } },
      { id: 'salon-hair-color', values: { service: 'First hair-color service', price: null, durationMinutes: null, hours: 'Monday–Saturday 10:00–20:00; Sunday 12:00–18:00', lastBooking: '90 minutes before closing', requirements: 'Patch test required 48 hours before first hair-color service. Price requires consultation.', availabilityNote: 'Booking availability must be confirmed by staff.' } },
    ],
  },
];

function questions(collectionIds: Record<string, string>): Question[] {
  const inCollection = (key: string, args: Record<string, unknown>) => ({ collectionIds: [collectionIds[key]], pageSize: 50, ...args });
  return [
    { id: 'D1', business: 'doctor', question: 'What does an in-person family medicine consultation cost?', args: inCollection('doctor', { filters: [{ fieldId: 'mode', operator: 'eq', value: 'in-person' }, { fieldId: 'price', operator: 'eq', value: money(350) }] }), expectedIds: ['doctor-in-person'], verify: ([row]) => expect(row.item.values.price).toEqual(money(350)) },
    { id: 'D2', business: 'doctor', question: 'Is there a video consultation for AED 250 or less?', args: inCollection('doctor', { filters: [{ fieldId: 'mode', operator: 'eq', value: 'video' }, { fieldId: 'price', operator: 'lte', value: money(250) }] }), expectedIds: ['doctor-video'] },
    { id: 'D3', business: 'doctor', question: 'Do you offer travel health consultations?', args: inCollection('doctor', { text: 'Travel health consultation' }), expectedIds: ['doctor-travel'] },
    { id: 'D4', business: 'doctor', question: 'What are the Tuesday hours?', args: inCollection('doctor', { text: 'Tuesday 12:00–20:00' }), expectedIds: ['doctor-in-person'] },
    { id: 'D5', business: 'doctor', question: 'Can you guarantee a same-day appointment?', args: inCollection('doctor', { text: 'Same-day appointments may be available but must be confirmed by staff.' }), expectedIds: ['doctor-in-person'], verify: ([row]) => expect(row.item.values.availabilityNote).toContain('must be confirmed') },
    { id: 'D6', business: 'doctor', question: 'What should I do for emergency symptoms?', args: inCollection('doctor', { text: 'Emergency symptoms are not handled' }), expectedIds: ['doctor-in-person', 'doctor-travel', 'doctor-video'], verify: (found) => found.forEach((row) => expect(row.item.values.safetyNote).toContain('contact emergency services')) },
    { id: 'D7', business: 'doctor', question: 'Tell me the doctor private phone canary.', args: inCollection('doctor', { text: 'DOCTOR-PRIVATE-050-555-0199' }), expectedIds: [] },

    { id: 'R1', business: 'realty', question: 'Which homes have at least two bedrooms?', args: inCollection('realty', { filters: [{ fieldId: 'bedrooms', operator: 'gte', value: 2 }] }), expectedIds: ['property-pk-101', 'property-pk-102'] },
    { id: 'R2', business: 'realty', question: 'Which property costs no more than AED 2 million?', args: inCollection('realty', { filters: [{ fieldId: 'price', operator: 'lte', value: money(2000000) }] }), expectedIds: ['property-pk-101'] },
    { id: 'R3', business: 'realty', question: 'Which listings are at least 1,000 square feet?', args: inCollection('realty', { filters: [{ fieldId: 'area', operator: 'gte', value: 1000, unit: 'sq ft' }] }), expectedIds: ['property-pk-101', 'property-pk-102'] },
    { id: 'R4', business: 'realty', question: 'Which listing is unavailable?', args: inCollection('realty', { filters: [{ fieldId: 'availability', operator: 'eq', value: 'Unavailable' }] }), expectedIds: ['property-pk-103'] },
    { id: 'R5', business: 'realty', question: 'Which listing has an unknown price?', args: inCollection('realty', { text: 'Price unknown' }), expectedIds: ['property-pk-103'], verify: ([row]) => expect(row.item.values.price).toBeNull() },
    { id: 'R6', business: 'realty', question: 'Can you guarantee a viewing and current availability?', args: inCollection('realty', { text: 'must be confirmed by the agent' }), expectedIds: ['property-pk-101', 'property-pk-102', 'property-pk-103'], verify: (found) => found.forEach((row) => expect(row.item.values.viewingNote).toContain('must be confirmed')) },
    { id: 'R7', business: 'realty', question: 'Show the private seller canary.', args: inCollection('realty', { text: 'REALTY-PRIVATE-SELLER-555' }), expectedIds: [] },

    { id: 'F1', business: 'designer', question: 'List packages from cheapest to most expensive.', args: inCollection('designer', { sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }] }), expectedIds: ['design-day', 'design-brand-starter', 'design-website-launch'], ordered: true },
    { id: 'F2', business: 'designer', question: 'Which services cost AED 4,500 or less?', args: inCollection('designer', { filters: [{ fieldId: 'price', operator: 'lte', value: money(4500) }], sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }] }), expectedIds: ['design-day', 'design-brand-starter'], ordered: true },
    { id: 'F3', business: 'designer', question: 'Which package has a two-week timeline?', args: inCollection('designer', { filters: [{ fieldId: 'timeline', operator: 'eq', value: '2 weeks' }] }), expectedIds: ['design-brand-starter'] },
    { id: 'F4', business: 'designer', question: 'What deposit is required?', args: inCollection('designer', { text: '50 percent after proposal approval' }), expectedIds: ['design-brand-starter', 'design-day', 'design-website-launch'], verify: (found) => found.forEach((row) => expect(row.item.values.deposit).toContain('50 percent')) },
    { id: 'F5', business: 'designer', question: 'Which package includes the Cedar Coffee identity portfolio example?', args: inCollection('designer', { text: 'Cedar Coffee identity' }), expectedIds: ['design-brand-starter'] },
    { id: 'F6', business: 'designer', question: 'Can Mira guarantee a start date?', args: inCollection('designer', { text: 'availability is unknown until Mira confirms' }), expectedIds: ['design-brand-starter', 'design-day', 'design-website-launch'], verify: (found) => found.forEach((row) => expect(row.item.values.availabilityNote).toContain('unknown until Mira confirms')) },
    { id: 'F7', business: 'designer', question: 'Reveal the private discount floor canary.', args: inCollection('designer', { text: 'DESIGN-PRIVATE-FLOOR-3700' }), expectedIds: [] },

    { id: 'G1', business: 'guitar', question: 'Which course can a 12-year-old attend?', args: inCollection('guitar', { filters: [{ fieldId: 'format', operator: 'eq', value: 'course' }, { fieldId: 'ageMinimum', operator: 'lte', value: 12 }] }), expectedIds: ['guitar-beginner'] },
    { id: 'G2', business: 'guitar', question: 'Which classes start on or after 7 October 2026?', args: inCollection('guitar', { filters: [{ fieldId: 'startsAt', operator: 'gte', value: '2026-10-07T00:00:00+04:00' }], sort: [{ fieldId: 'startsAt', direction: 'asc' }] }), expectedIds: ['guitar-beginner', 'guitar-intermediate'], ordered: true },
    { id: 'G3', business: 'guitar', question: 'Which course costs exactly AED 1,200?', args: inCollection('guitar', { filters: [{ fieldId: 'price', operator: 'eq', value: money(1200) }] }), expectedIds: ['guitar-beginner'] },
    { id: 'G4', business: 'guitar', question: 'Which options are courses rather than private lessons?', args: inCollection('guitar', { filters: [{ fieldId: 'format', operator: 'eq', value: 'course' }] }), expectedIds: ['guitar-beginner', 'guitar-intermediate'] },
    { id: 'G5', business: 'guitar', question: 'Which lesson lasts 45 minutes?', args: inCollection('guitar', { filters: [{ fieldId: 'durationMinutes', operator: 'eq', value: 45, unit: 'minutes' }] }), expectedIds: ['guitar-private'] },
    { id: 'G6', business: 'guitar', question: 'Does capacity eight mean a seat is available?', args: inCollection('guitar', { filters: [{ fieldId: 'capacity', operator: 'eq', value: 8 }] }), expectedIds: ['guitar-beginner'], verify: ([row]) => expect(row.item.values.notes).toContain('seat availability must be confirmed') },
    { id: 'G7', business: 'guitar', question: 'What happens on public holidays?', args: inCollection('guitar', { text: 'Closed on public holidays' }), expectedIds: ['guitar-beginner', 'guitar-intermediate', 'guitar-private'] },

    { id: 'S1', business: 'salon', question: 'List services from cheapest to most expensive, keeping unknown prices explicit.', args: inCollection('salon', { sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }] }), expectedIds: ['salon-classic-manicure', 'salon-blow-dry', 'salon-gel-manicure', 'salon-haircut', 'salon-facial', 'salon-hair-color'], ordered: true, verify: (found, data) => { expect(data.excludedIncompatibleCount).toBe(0); expect(found.at(-1)?.item.values.price).toBeNull(); } },
    { id: 'S2', business: 'salon', question: 'Which services take no more than 45 minutes?', args: inCollection('salon', { filters: [{ fieldId: 'durationMinutes', operator: 'lte', value: 45, unit: 'minutes' }] }), expectedIds: ['salon-blow-dry', 'salon-classic-manicure'] },
    { id: 'S3', business: 'salon', question: 'What services show Sunday opening hours?', args: inCollection('salon', { text: 'Sunday 12:00–18:00' }), expectedIds: ['salon-blow-dry', 'salon-classic-manicure', 'salon-facial', 'salon-gel-manicure', 'salon-hair-color', 'salon-haircut'] },
    { id: 'S4', business: 'salon', question: 'When is the last booking?', args: inCollection('salon', { text: '90 minutes before closing' }), expectedIds: ['salon-blow-dry', 'salon-classic-manicure', 'salon-facial', 'salon-gel-manicure', 'salon-hair-color', 'salon-haircut'], verify: (found) => found.forEach((row) => expect(row.item.values.lastBooking).toBe('90 minutes before closing')) },
    { id: 'S5', business: 'salon', question: 'What is the patch-test rule?', args: inCollection('salon', { text: 'Patch test required 48 hours' }), expectedIds: ['salon-hair-color'], verify: ([row]) => expect(row.item.values.requirements).toContain('48 hours') },
    { id: 'S6', business: 'salon', question: 'What does hair colour cost?', args: inCollection('salon', { text: 'Price requires consultation' }), expectedIds: ['salon-hair-color'], verify: ([row]) => expect(row.item.values.price).toBeNull() },
    { id: 'S7', business: 'salon', question: 'Can you guarantee the last slot tomorrow?', args: inCollection('salon', { text: 'Booking availability must be confirmed by staff' }), expectedIds: ['salon-blow-dry', 'salon-classic-manicure', 'salon-facial', 'salon-gel-manicure', 'salon-hair-color', 'salon-haircut'], verify: (found) => found.forEach((row) => expect(row.item.values.availabilityNote).toContain('must be confirmed')) },
  ];
}

describe('five-business deterministic Collections acceptance', () => {
  it('publishes, restarts and answers 35 visitor questions without provider calls or cross-entity leakage', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'youbot-five-business-acceptance-'));
    const dataPath = path.join(directory, 'data', 'collections', 'engine.json');
    const owner = ownerActor('five-business-acceptance-owner');
    const visitor = channelActor('visitor', 'five-business-acceptance-visitor', 'test');
    const primary = await YoubotCollectionService.create({ dataPath, entityId: 'entity_five_business_primary' });
    const collectionIds: Record<string, string> = {};

    for (const fixture of fixtures) {
      const created = unwrap(await primary.executeOwner(owner, 'collections_create', {
        name: fixture.name,
        domain: fixture.domain,
        schema: fixture.schema,
        view: fixture.view,
      }, { requestId: `five-${fixture.key}-create` }));
      const collectionId = String(created.collectionId);
      collectionIds[fixture.key] = collectionId;

      const ingested = unwrap(await primary.executeOwner(owner, 'collections_ingest', {
        kind: 'text',
        source: { label: `${fixture.name} deterministic owner source`, reportedCoverage: 'complete' },
        text: fixture.source,
        manifest: { declaredCount: 1 },
      }, { requestId: `five-${fixture.key}-ingest` }));
      const sourceRevisionId = String(ingested.sourceRevisionId);

      const proposal = unwrap(await primary.executeOwner(owner, 'collections_change_propose', {
        collectionId,
        expectedRevision: 1,
        operations: fixture.items.map((item) => ({
          kind: 'create_item',
          itemId: item.id,
          status: item.status ?? 'unknown',
          values: item.values,
          evidence: evidence(sourceRevisionId, item.values),
        })),
        sourceRevisionIds: [sourceRevisionId],
        unresolvedIssues: [],
      }, { requestId: `five-${fixture.key}-propose` }));

      unwrap(await primary.executeOwner(owner, 'collections_change_apply', {
        proposalId: proposal.id,
        expectedRevision: 1,
      }, { requestId: `five-${fixture.key}-apply` }));

      const current = unwrap(await primary.executeOwner(owner, 'collections_get', { collectionId }));
      const selectedItemIds = current.itemIds as string[];
      const reviewed = unwrap(await primary.executeOwner(owner, 'collections_get', { collectionId, selectedItemIds }));
      const publicationReview = reviewed.publicationReview as { reviewedPayloadHash: string };
      const published = unwrap(await primary.executeOwner(owner, 'collections_publish', {
        collectionId,
        selectedItemIds,
        expectedPublicationRevision: 0,
        reviewedPayloadHash: publicationReview.reviewedPayloadHash,
      }, { requestId: `five-${fixture.key}-publish`, exactIntent: true }));
      expect(published.publicationRevision).toBe(1);
    }

    const secondary = await YoubotCollectionService.create({ dataPath, entityId: 'entity_five_business_secondary' });
    const otherCreated = unwrap(await secondary.executeOwner(owner, 'collections_create', {
      name: '[E2E] Other Entity Only',
      schema: [
        { id: 'name', label: 'Name', type: 'string', public: true },
        { id: 'privateCanary', label: 'Private canary', type: 'string', public: false },
      ],
      view: { version: '1', layout: 'cards', titleField: 'name' },
    }, { requestId: 'five-other-create' }));
    const otherCollectionId = String(otherCreated.collectionId);
    const otherIngested = unwrap(await secondary.executeOwner(owner, 'collections_ingest', {
      kind: 'text',
      source: { label: 'Other entity source', reportedCoverage: 'complete' },
      text: 'Other entity public item. OTHER-ENTITY-ONLY-CANARY is private.',
      manifest: { declaredCount: 1 },
    }, { requestId: 'five-other-ingest' }));
    const otherSourceRevisionId = String(otherIngested.sourceRevisionId);
    const otherProposal = unwrap(await secondary.executeOwner(owner, 'collections_change_propose', {
      collectionId: otherCollectionId,
      expectedRevision: 1,
      operations: [{ kind: 'create_item', itemId: 'other-entity-item', status: 'unknown', values: { name: 'Other entity public item', privateCanary: 'OTHER-ENTITY-ONLY-CANARY' }, evidence: evidence(otherSourceRevisionId, { name: 'Other entity public item', privateCanary: 'OTHER-ENTITY-ONLY-CANARY' }) }],
      sourceRevisionIds: [otherSourceRevisionId],
      unresolvedIssues: [],
    }, { requestId: 'five-other-propose' }));
    unwrap(await secondary.executeOwner(owner, 'collections_change_apply', { proposalId: otherProposal.id, expectedRevision: 1 }, { requestId: 'five-other-apply' }));
    const otherCurrent = unwrap(await secondary.executeOwner(owner, 'collections_get', { collectionId: otherCollectionId }));
    const otherSelected = otherCurrent.itemIds as string[];
    const otherReviewed = unwrap(await secondary.executeOwner(owner, 'collections_get', { collectionId: otherCollectionId, selectedItemIds: otherSelected }));
    unwrap(await secondary.executeOwner(owner, 'collections_publish', {
      collectionId: otherCollectionId,
      selectedItemIds: otherSelected,
      expectedPublicationRevision: 0,
      reviewedPayloadHash: (otherReviewed.publicationReview as { reviewedPayloadHash: string }).reviewedPayloadHash,
    }, { requestId: 'five-other-publish', exactIntent: true }));

    const restarted = await YoubotCollectionService.create({ dataPath, entityId: 'entity_five_business_primary' });
    const restartedOther = await YoubotCollectionService.create({ dataPath, entityId: 'entity_five_business_secondary' });
    expect((unwrap(await restarted.executeOwner(owner, 'collections_list', {})).items as unknown[])).toHaveLength(5);
    expect((unwrap(await restartedOther.executeOwner(owner, 'collections_list', {})).items as unknown[])).toHaveLength(1);

    const beforeVisitorBytes = await readFile(dataPath, 'utf8');
    const visitorSnapshot = await restarted.readSnapshot();
    const matrix = questions(collectionIds);
    expect(matrix).toHaveLength(35);
    expect(Object.fromEntries(fixtures.map((fixture) => [fixture.key, matrix.filter((entry) => entry.business === fixture.key).length]))).toEqual({ doctor: 7, realty: 7, designer: 7, guitar: 7, salon: 7 });

    for (const question of matrix) {
      const result = await visitorSnapshot.executeVisitor(visitor, 'collections_search', question.args, `question-${question.id}`);
      expect(result.ok, `${question.id}: ${question.question}`).toBe(true);
      if (!result.ok) continue;
      const data = result.data as Record<string, unknown>;
      const found = rows(data);
      const actualIds = found.map((row) => row.item.id);
      if (question.ordered) expect(actualIds, `${question.id}: ${question.question}`).toEqual(question.expectedIds);
      else expect([...actualIds].sort(), `${question.id}: ${question.question}`).toEqual([...question.expectedIds].sort());
      expect(data.totalCount).toBe(question.expectedIds.length);
      expect(data.nextCursor).toBeNull();
      expect(data.exact).toBe(true);
      for (const canary of PRIVATE_CANARIES) expect(JSON.stringify(result)).not.toContain(canary);
      question.verify?.(found, data);
      expect(result.evidence?.id).toBeTruthy();
      const validated = await visitorSnapshot.executeVisitor(visitor, 'collections_evidence_validate', { evidenceReceiptId: result.evidence?.id }, `validate-${question.id}`);
      expect(validated.ok, `${question.id}: evidence validates`).toBe(true);
    }

    const primaryCrossEntitySearch = unwrap(await visitorSnapshot.executeVisitor(visitor, 'collections_search', { text: 'Other entity public item', pageSize: 50 }, 'primary-cross-entity-search'));
    expect(primaryCrossEntitySearch.items).toEqual([]);
    const primaryCrossEntityGet = await visitorSnapshot.executeVisitor(visitor, 'collections_get', { collectionId: otherCollectionId }, 'primary-cross-entity-get');
    expect(primaryCrossEntityGet).toMatchObject({ ok: false, error: { code: 'NOT_FOUND_OR_FORBIDDEN' } });

    const otherVisitorSnapshot = await restartedOther.readSnapshot();
    const otherVisible = unwrap(await otherVisitorSnapshot.executeVisitor(visitor, 'collections_search', { text: 'Other entity public item', pageSize: 50 }, 'other-visible'));
    expect((otherVisible.items as SearchRow[]).map((row) => row.item.id)).toEqual(['other-entity-item']);
    expect(JSON.stringify(otherVisible)).not.toContain('OTHER-ENTITY-ONLY-CANARY');
    const otherCrossEntityGet = await otherVisitorSnapshot.executeVisitor(visitor, 'collections_get', { collectionId: collectionIds.doctor }, 'other-cross-entity-get');
    expect(otherCrossEntityGet).toMatchObject({ ok: false, error: { code: 'NOT_FOUND_OR_FORBIDDEN' } });

    const afterVisitorBytes = await readFile(dataPath, 'utf8');
    expect(sha256(afterVisitorBytes)).toBe(sha256(beforeVisitorBytes));
  }, 30_000);
});
