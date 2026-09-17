export interface Thread { id:string; name:string; channel:string; address:string; incomingVersion:number; readVersion:number; handled:boolean; paused:boolean; revision:number; createdAt:string; updatedAt:string; lastIncomingAt:string; lastError:string|null; unread:boolean; preview:string; approvals:number; overdue:number; status:'needs'|'handled'|'active' }
export interface Message { id:string; speaker:'visitor'|'owner'|'concierge'; content:string; timestamp:string; delivery:string; channel:string }
export interface Detail { autoReplyEnabled:boolean; thread:Thread; messages:Message[]; hasMore:boolean; replyUnavailable:string|null; approvals:{id:string;question:string;context:string}[]; followups:{id:string;reason:string;follow_up_at:string}[] }
export interface Profile { name:string; introduction:string; purpose:string; tone:'warm'|'direct'|'polished'; knowledge:{id:string;title:string;content:string}[]; boundaries:{answerFromKnowledge:boolean;askBeforePrice:boolean;askBeforeBooking:boolean;escalation:string} }
export const channelName = (channel:string) => ({whatsapp:'WhatsApp',telegram:'Telegram',webchat:'Website'}[channel] || channel);
export const statusName = (t:Thread) => t.status === 'needs' ? 'Requires attention' : t.status === 'handled' ? 'Resolved' : 'Open';
export const time = (value:string) => new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export async function conciergeApi<T>(path:string, body?:unknown, method = 'POST'):Promise<T> {
 const response = await fetch('/api/concierge'+path,{method:body === undefined?'GET':method,headers:{'Content-Type':'application/json'},body:body === undefined?undefined:JSON.stringify(body)});
 const data = await response.json(); if(!response.ok) throw new Error(data.error || 'Could not connect to Youbot. Try again.'); return data;
}

export type CollectionCoverage = 'complete'|'partial'|'unknown';
export type CollectionStatus = 'draft'|'published'|'needs-review';
export type CollectionFieldValue = string|number|boolean|null|{amount:number;currency:string}|string[];
export interface CollectionField { id:string; label:string; type:string; public?:boolean; unit?:string; multiple?:boolean; enumValues?:string[] }
export interface CollectionItem {
 id:string;
 revision:number;
 values:Record<string,CollectionFieldValue>;
 status:'unknown'|'available'|'unavailable';
 archived:boolean;
 validThrough?:string;
 updatedAt:string;
 publishedAt?:string;
 evidence?:Array<{sourceRevisionId:string;inputId?:string;fieldId?:string}>;
}
export interface CollectionSummary {
 id:string;
 name:string;
 domain?:string;
 revision:number;
 publicationRevision:number;
 itemCount?:number;
 publishedCount?:number;
 needsReviewCount?:number;
 status?:CollectionStatus;
 updatedAt?:string;
}
export interface CollectionProposal {
 id:string;
 collectionId:string;
 baseRevision:number;
 operations:Array<{kind:string;itemId?:string;values?:Record<string,CollectionFieldValue>;field?:CollectionField}>;
 unresolvedIssues:string[];
 sourceRevisionIds:string[];
 payloadHash:string;
 createdAt:string;
}
export type CollectionAuthoringJobStatus='accepted'|'ingested'|'organizing'|'needs-review'|'conflict'|'pending'|'failed';
export interface CollectionAuthoringJob {
 id:string;
 requestId:string;
 collectionId:string;
 kind:'text'|'pdf'|'image'|'url';
 status:CollectionAuthoringJobStatus;
 attempt:number;
 baseRevision:number;
 sourceRevisionId?:string;
 ingestId?:string;
 proposalId?:string;
 acceptedCount?:number;
 generated?:{operations:CollectionProposal['operations'];unresolvedIssues:string[];sourceRevisionIds:string[]};
 conflict?:{expectedRevision:number;currentRevision:number};
 warning?:string;
 recoverable:boolean;
 createdAt:string;
 updatedAt:string;
}
export interface CollectionAuthoringJobsPayload {jobs:CollectionAuthoringJob[];count:number}
export interface CollectionAuthoringJobPayload {job:CollectionAuthoringJob;proposal?:CollectionProposal;view?:CollectionView}
export interface CollectionMessage {
 id:string;
 speaker:'owner'|'concierge';
 content:string;
 createdAt:string;
 state?:'sending'|'saved'|'needs-review'|'error';
}
export interface CollectionView {
 collection:CollectionSummary;
 schema:CollectionField[];
 items:CollectionItem[];
 publishedItems:CollectionItem[];
 view:{version:'1';layout:'cards'|'gallery'|'agenda'|'detail';titleField?:string;subtitleField?:string;imageField?:string;visibleFields?:string[];startField?:string;endField?:string;groupByField?:string};
 proposals:CollectionProposal[];
 messages:CollectionMessage[];
 reviewedPayloadHash?:string;
 sourceCoverage?:CollectionCoverage;
}
export interface CollectionAuthoringResult {
 job:CollectionAuthoringJob;
 message?:CollectionMessage;
 proposal?:CollectionProposal;
 collection?:CollectionSummary;
 view?:CollectionView;
 acceptedCount?:number;
 unresolvedCount?:number;
}
export interface CollectionSourceResult {
 job:CollectionAuthoringJob;
 source:{kind:'url'|'image';reference:string;label:string;sha256:string;mediaType:string;characterCount:number};
 acceptedCount:number;
 unresolvedCount:number;
 duplicate:boolean;
 proposal?:CollectionProposal;
 view?:CollectionView;
}
export interface CollectionPdfResult {
 job:CollectionAuthoringJob;
 outcome:'success'|'partial';
 recoverable:boolean;
 requestId:string;
 sourceRevisionId:string;
 ingestId:string;
 file:{name:string;mimeType:'application/pdf';sizeBytes:number;sha256:string};
 coverage:{status:'complete'|'partial';totalPages:number;extractedPages:number;unresolvedPages:number[];extractedCount:number;unresolvedCount:number;characterCount?:number};
 acceptedCount:number;
 duplicate:boolean;
 organization:{status:'ready'|'pending';proposalId?:string;updatedCount:number;unresolvedCount:number;warning?:string};
 proposal?:CollectionProposal;
 view?:CollectionView;
}
export interface CollectionSourceReview {
 sourceRevisionId:string;
 collectionId:string;
 file?:{name:string;mimeType:string;sizeBytes:number;sha256:string};
 label?:string;
 coverage?:{status:'complete'|'partial'|'unknown';totalPages?:number;extractedPages?:number;unresolvedPages?:number[];extractedCount?:number;unresolvedCount?:number;characterCount?:number};
 ingest?:{id?:string;createdAt?:string;acceptedCount?:number};
 source?:{label?:string;reportedCoverage?:string;coverageNote?:string};
 segments:Array<{inputId:string;page?:number|string;section?:string;charCount?:number;text:string;truncated?:boolean}>;
 nextCursor?:number|null;
}
export interface CollectionAnswerPreview {
 label:'Preview · not sent'|string;
 sent:false;
 query:string;
 answer:string;
 supportingItems:Array<{itemId:string;itemRevision:number;values:Record<string,CollectionFieldValue>;status?:string;evidenceReceiptId?:string;sourceReferences?:string[];evidenceIds?:string[]}>;
 evidenceReceiptIds:string[];
 coverage:{status:string;resultCount:number;totalCount:number;exhaustive:boolean};
 limitations:string[];
}

type CollectionToolResult<T> =
 | {ok:true;data:T;warnings?:Array<{code:string;message:string}>}
 | {ok:false;error:{code?:string;message:string;retryable?:boolean;details?:Record<string,unknown>}};

export class CollectionApiError extends Error {
 readonly code?:string;
 readonly retryable?:boolean;
 readonly details?:Record<string,unknown>;
 readonly job?:CollectionAuthoringJob;
 constructor(message:string,options:{code?:string;retryable?:boolean;details?:Record<string,unknown>;job?:CollectionAuthoringJob}={}){
  super(message);
  this.name='CollectionApiError';
  this.code=options.code;
  this.retryable=options.retryable;
  this.details=options.details;
  this.job=options.job;
 }
}

function unwrapCollectionPayload<T>(payload:unknown,responseOk:boolean):T {
 const outer=payload as {result?:CollectionToolResult<T>|T;error?:string|{code?:string;message?:string;retryable?:boolean;details?:Record<string,unknown>};code?:string;retryable?:boolean;details?:Record<string,unknown>;job?:CollectionAuthoringJob}|CollectionToolResult<T>|T;
 if(!responseOk){
  const failure=outer as {error?:string|{code?:string;message?:string;retryable?:boolean;details?:Record<string,unknown>};code?:string;retryable?:boolean;details?:Record<string,unknown>;job?:CollectionAuthoringJob};
  const nested=typeof failure.error==='object'?failure.error:undefined;
  const message=typeof failure.error==='string'?failure.error:nested?.message;
  throw new CollectionApiError(message||'Could not update collections. Try again.',{code:failure.code||nested?.code,retryable:failure.retryable??nested?.retryable,details:failure.details||nested?.details,job:failure.job});
 }
 const wrapped=(typeof outer==='object'&&outer!==null&&'result' in outer?(outer as {result?:CollectionToolResult<T>|T}).result:outer) as CollectionToolResult<T>|T|undefined;
 if(wrapped&&typeof wrapped==='object'&&'ok' in wrapped){
  if(!wrapped.ok)throw new CollectionApiError(wrapped.error.message,{code:wrapped.error.code,retryable:wrapped.error.retryable,details:wrapped.error.details});
  return wrapped.data;
 }
 return wrapped as T;
}

/** Unwraps the host envelope while keeping engine failures visible to owner screens. */
export async function collectionApi<T>(path:string, body?:unknown, method = 'POST'):Promise<T> {
 const response=await fetch('/api/concierge/collections'+path,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=await response.json().catch(()=>({error:'Youbot returned an unreadable response.'}));
 return unwrapCollectionPayload<T>(payload,response.ok);
}

export function uploadCollectionFile<T>(
 path:string,
 file:File,
 fields:{requestId:string;expectedRevision?:number},
 onProgress?:(stage:'reading'|'uploading'|'processing',percent:number)=>void,
):Promise<T>{
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('The file could not be read. Choose it again.'));
  reader.onprogress=event=>{if(event.lengthComputable)onProgress?.('reading',Math.round((event.loaded/event.total)*30));};
  reader.onload=()=>{
   const encoded=String(reader.result||'');
   const comma=encoded.indexOf(',');
   if(comma<0){reject(new Error('The file could not be encoded. Choose it again.'));return;}
   onProgress?.('uploading',30);
   const request=new XMLHttpRequest();
   request.open('POST','/api/concierge/collections'+path);
   request.setRequestHeader('Content-Type','application/json');
   request.upload.onprogress=event=>{if(event.lengthComputable)onProgress?.('uploading',30+Math.round((event.loaded/event.total)*35));};
   request.upload.onload=()=>onProgress?.('processing',70);
   request.onerror=()=>reject(new Error('The file upload was interrupted. Try again.'));
   request.onload=()=>{
    try{
     const payload=JSON.parse(request.responseText||'{}') as unknown;
     onProgress?.('processing',100);
     resolve(unwrapCollectionPayload<T>(payload,request.status>=200&&request.status<300));
    }catch(error){reject(error instanceof Error?error:new Error('Youbot returned an unreadable file result.'));}
   };
   const extension=file.name.toLowerCase().split('.').pop();
   const mimeType=file.type||({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[extension||'']||'application/octet-stream';
   request.send(JSON.stringify({filename:file.name,mimeType,base64:encoded.slice(comma+1),...fields}));
  };
  reader.readAsDataURL(file);
 });
}
