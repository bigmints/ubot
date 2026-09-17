import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SQLiteConnection} from '../../data/database/sqlite.js';
import {createMemoryStore} from '../../memory/memory-store.js';
import {createSoul} from '../../memory/soul.js';
import {LocalWorkspaceProvider} from '../../data/local-workspace.js';
import {readOwnerProfile,writeOwnerProfile,documentRevision,OWNER_START,OWNER_END} from '../owner-profile.js';
const profile={name:'Alex',role:'Designer',organization:'Studio',location:'Dubai',timezone:'Asia/Dubai',about:'Art commissions',preferences:'Professional and concise'};
describe('structured owner profiles',()=>{
 it('reads legacy field capitalization while preserving the original context',()=>{
  const legacy='Name: Alex Morgan\nRole: Studio director';
  const parsed=readOwnerProfile(legacy);expect(parsed.profile.name).toBe('Alex Morgan');expect(parsed.profile.role).toBe('Studio director');expect(parsed.additionalContext).toBe(legacy);
 });
 it('retains legacy context through repeated edits without duplicating managed fields',()=>{
  const legacy='# Existing context\nname: Previous name\n\nImportant original notes.';
  const first=writeOwnerProfile(profile,readOwnerProfile(legacy).additionalContext);
  const parsed=readOwnerProfile(first);expect(parsed.profile).toEqual(profile);expect(parsed.additionalContext).toBe(legacy);
  const second=writeOwnerProfile({...parsed.profile,name:'Sam'},parsed.additionalContext);
  expect(second.split(OWNER_START)).toHaveLength(2);expect(second.split(OWNER_END)).toHaveLength(2);expect(readOwnerProfile(second).additionalContext).toBe(legacy);
 });
 it('round-trips multiline text, quotes and non-English names',()=>{
  const value={...profile,name:'علي',about:'Line one\nA "quoted" second line'};
  expect(readOwnerProfile(writeOwnerProfile(value,'')).profile).toEqual(value);
 });
 it('rejects invalid time zones, marker injection and oversized fields',()=>{
  expect(()=>writeOwnerProfile({...profile,timezone:'invalid/place'},'')).toThrow('time zone');
  expect(()=>writeOwnerProfile({...profile,about:OWNER_END},'')).toThrow('marker');
  expect(()=>writeOwnerProfile(profile,OWNER_START)).toThrow('marker');
  expect(()=>writeOwnerProfile({...profile,name:'a'.repeat(161)},'')).toThrow('name');
 });
});
describe('profile persistence',()=>{
 let directory:string,db:SQLiteConnection,workspace:LocalWorkspaceProvider,memory:ReturnType<typeof createMemoryStore>,soul:ReturnType<typeof createSoul>;
 beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'youbot-profile-'));db=new SQLiteConnection({config:{path:join(directory,'test.sqlite')}});memory=createMemoryStore(db);await memory.saveDocument('__owner__','Original owner context');await memory.saveDocument('__bot__','Original agent context');workspace=new LocalWorkspaceProvider(join(directory,'workspace'));soul=createSoul(memory,workspace.rootPath,workspace);});
 afterEach(async()=>{await db.close();await rm(directory,{recursive:true,force:true});});
 it('persists profile content to both prompt storage and workspace',async()=>{
  const original=await soul.getDocument('__owner__');const content=writeOwnerProfile(profile,original);
  await soul.saveDocument('__owner__',content,documentRevision(original));
  expect((await memory.getDocument('__owner__'))?.content).toBe(content);expect(workspace.readFile('SOUL.md')).toBe(content);
  expect(await soul.buildSoulPrompt('visitor',false)).toContain('Art commissions');
 });
 it('accepts only one concurrent save against the same revision',async()=>{
  const revision=documentRevision(await soul.getDocument('__owner__'));
  const results=await Promise.allSettled([soul.saveDocument('__owner__','First update',revision),soul.saveDocument('__owner__','Second update',revision)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect(await soul.getDocument('__owner__')).toBe('First update');
 });
 it('rejects a background profile update based on outdated context',async()=>{
  const revision=documentRevision(await soul.getDocument('__owner__'));await soul.saveDocument('__owner__','Owner edit',revision);
  await expect(soul.saveDocument('__owner__','Old background rewrite',revision)).rejects.toMatchObject({name:'ProfileConflict'});expect(await soul.getDocument('__owner__')).toBe('Owner edit');
 });
 it('restores prompt storage and reports failure if the workspace write fails',async()=>{
  const original=await soul.getDocument('__owner__');vi.spyOn(workspace,'writeFile').mockImplementation(()=>{throw new Error('Read-only workspace');});
  await expect(soul.saveDocument('__owner__','New value',documentRevision(original))).rejects.toThrow('Read-only workspace');expect((await memory.getDocument('__owner__'))?.content).toBe(original);
 });
 it('does not write the workspace when database persistence fails',async()=>{
  const write=vi.spyOn(workspace,'writeFile');vi.spyOn(memory,'saveDocument').mockRejectedValue(new Error('Database unavailable'));
  await expect(soul.saveDocument('__owner__','New value')).rejects.toThrow('Database unavailable');expect(write).not.toHaveBeenCalled();
 });
});
