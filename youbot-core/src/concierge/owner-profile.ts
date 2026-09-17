import { createHash } from 'node:crypto';
export const OWNER_START = '<!-- youbot:owner-profile:start -->';
export const OWNER_END = '<!-- youbot:owner-profile:end -->';
export const OWNER_FIELDS = ['name','role','organization','location','timezone','about','preferences'] as const;
export type OwnerProfile = Record<typeof OWNER_FIELDS[number],string>;
export const documentRevision = (content:string) => createHash('sha256').update(content).digest('hex');
export function readOwnerProfile(document:string): {profile:OwnerProfile;additionalContext:string;revision:string} {
 const start=document.indexOf(OWNER_START),end=document.indexOf(OWNER_END);
 const managed=start>=0&&end>start;
 const source=managed?document.slice(start+OWNER_START.length,end):document;
 const profile=Object.fromEntries(OWNER_FIELDS.map(key=>{
  const match=source.match(new RegExp('^'+key+':\\s*([^\\n]*)','im'));
  let value=match?.[1]?.trim() || '';
  if(value.startsWith('"'))try{value=JSON.parse(value);}catch{/* Keep legacy text. */}
  if(typeof value!=='string')value='';
  return [key,value];
 })) as OwnerProfile;
 return {profile,additionalContext:managed?(document.slice(0,start)+document.slice(end+OWNER_END.length)).trim():document,revision:documentRevision(document)};
}
export function writeOwnerProfile(profile:unknown,additionalContext:unknown):string {
 if(!profile||typeof profile!=='object'||typeof additionalContext!=='string'||additionalContext.length>50000)throw new Error('Enter valid profile details and keep additional context under 50,000 characters.');
 const values=profile as Record<string,unknown>;
 for(const key of OWNER_FIELDS){const value=values[key];if(typeof value!=='string'||value.length>(key==='about'||key==='preferences'?3000:160)||value.includes(OWNER_START)||value.includes(OWNER_END))throw new Error(`Review the ${key} field. It is too long or contains an invalid profile marker.`);}
 if(additionalContext.includes(OWNER_START)||additionalContext.includes(OWNER_END))throw new Error('Additional context contains a reserved profile marker.');
 const timezone=String(values.timezone).trim();if(timezone)try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new Error('Enter a valid time zone, such as Europe/London.');}
 return `${OWNER_START}\n## Owner profile\n${OWNER_FIELDS.map(key=>`${key}: ${JSON.stringify(String(values[key]).trim())}`).join('\n')}\n${OWNER_END}${additionalContext.trim()?'\n\n'+additionalContext.trim():''}\n`;
}
