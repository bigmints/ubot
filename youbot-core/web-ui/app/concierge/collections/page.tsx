"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Layers3,
  Loader2,
  Pencil,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ListToolbar } from "@/components/list-toolbar";
import { PageHeader } from "@/components/page-header";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { clearTopBarDetailName, setTopBarDetailName } from "@/components/page-breadcrumb";
import {
  collectionApi,
  CollectionApiError,
  uploadCollectionFile,
  type CollectionAnswerPreview,
  type CollectionAuthoringJob,
  type CollectionAuthoringJobPayload,
  type CollectionAuthoringJobsPayload,
  type CollectionAuthoringResult,
  type CollectionFieldValue,
  type CollectionItem,
  type CollectionMessage,
  type CollectionPdfResult,
  type CollectionSourceResult,
  type CollectionProposal,
  type CollectionSourceReview,
  type CollectionSummary,
  type CollectionView,
} from "@/lib/concierge";

type CollectionListPayload = CollectionSummary[] | {collections?:CollectionSummary[];items?:CollectionSummary[]};
type CollectionSearchRow = CollectionItem|{collectionId:string;item:CollectionItem};
type CollectionSearchPayload = CollectionSearchRow[] | {items?:CollectionSearchRow[];results?:CollectionSearchRow[]};
type CollectionViewPayload = CollectionView | {view:CollectionView};
type UploadStage='idle'|'reading'|'uploading'|'processing'|'success'|'partial'|'failed';
const MAX_PDF_BYTES=10*1024*1024;
const MAX_IMAGE_BYTES=6*1024*1024;
type AttachmentKind='pdf'|'image';

function summaries(payload:CollectionListPayload):CollectionSummary[]{
  if(Array.isArray(payload))return payload;
  return payload.collections||payload.items||[];
}

function viewData(payload:CollectionViewPayload):CollectionView{
  return 'collection' in payload?payload:payload.view;
}

function searchItems(payload:CollectionSearchPayload):CollectionItem[]{
  const rows=Array.isArray(payload)?payload:payload.items||payload.results||[];
  return rows.map(row=>'item' in row?row.item:row);
}

function displayValue(value:CollectionFieldValue|undefined,unit?:string){
  if(value===undefined||value===null||value==='')return 'Unknown';
  if(Array.isArray(value))return value.join(', ');
  if(typeof value==='object')return `${value.currency} ${new Intl.NumberFormat().format(value.amount)}`;
  if(typeof value==='boolean')return value?'Yes':'No';
  return `${value}${unit?` ${unit}`:''}`;
}

function timeLabel(value?:string){
  if(!value)return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}

function isOutdated(validThrough?:string,now=Date.now()){
  if(!validThrough)return false;
  const expiresAt=/^\d{4}-\d{2}-\d{2}$/.test(validThrough)
    ?Date.parse(`${validThrough}T00:00:00.000Z`)+86_400_000
    :Date.parse(validThrough);
  return Number.isFinite(expiresAt)&&now>=expiresAt;
}

function sizeLabel(bytes:number){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

function wholeHttpUrl(value:string){
  const trimmed=value.trim();
  try{
    const parsed=new URL(trimmed);
    return parsed.protocol==='http:'||parsed.protocol==='https:'?trimmed:undefined;
  }catch{return undefined;}
}

function attachmentKind(file:File):AttachmentKind|undefined{
  const mimeType=file.type.toLowerCase();
  const name=file.name.toLowerCase();
  if(mimeType==='application/pdf'||(!mimeType&&name.endsWith('.pdf')))return 'pdf';
  if(['image/png','image/jpeg','image/webp'].includes(mimeType))return 'image';
  if(!mimeType&&['.png','.jpg','.jpeg','.webp'].some(extension=>name.endsWith(extension)))return 'image';
  return undefined;
}

function attachmentLabel(file:File){
  return attachmentKind(file)==='pdf'?'PDF':'Image';
}

function proposalSummary(operation:CollectionProposal['operations'][number]){
  if(operation.kind==='create_item')return 'Add a new item';
  if(operation.kind==='update_item')return `Update ${Object.keys(operation.values||{}).length} field${Object.keys(operation.values||{}).length===1?'':'s'}`;
  if(operation.kind==='set_schema_field')return `Add or revise ${operation.field?.label||'a field'}`;
  if(operation.kind==='set_view')return 'Update the collection view';
  return 'Review a proposed change';
}

function authoringJobStatusLabel(status:CollectionAuthoringJob['status']){
  if(status==='needs-review')return 'Needs review';
  if(status==='conflict')return 'Collection changed';
  if(status==='failed')return 'Failed';
  if(status==='pending')return 'Pending';
  if(status==='organizing')return 'Organizing';
  if(status==='ingested')return 'Source saved';
  return 'Accepted';
}

function authoringJobKindLabel(kind:CollectionAuthoringJob['kind']){
  if(kind==='pdf')return 'PDF source';
  if(kind==='image')return 'Image source';
  if(kind==='url')return 'Website source';
  return 'Text source';
}

function authoringJobProgress(job:CollectionAuthoringJob){
  if(job.warning)return job.warning;
  if(job.status==='needs-review')return 'Organization finished. The proposed changes are ready for owner review.';
  if(job.status==='conflict')return 'Organization finished, but the collection changed before the proposal could be stored.';
  if(job.status==='failed')return 'The saved operation could not complete.';
  if(job.status==='pending')return 'The source is saved. Organization can resume from this operation.';
  if(job.status==='organizing')return 'Youbot is organizing the saved source.';
  if(job.status==='ingested')return 'The source is saved and waiting to be organized.';
  return 'The operation was accepted and will preserve its progress.';
}

export default function CollectionsPage(){
  const [collections,setCollections]=useState<CollectionSummary[]>([]);
  const [collectionSearch,setCollectionSearch]=useState('');
  const [collectionFilter,setCollectionFilter]=useState('all');
  const [collectionSort,setCollectionSort]=useState('recent');
  const [selectedId,setSelectedId]=useState('');
  const [detail,setDetail]=useState<CollectionView|null>(null);
  const [loading,setLoading]=useState(true);
  const [detailLoading,setDetailLoading]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [creating,setCreating]=useState(false);
  const [newContent,setNewContent]=useState('');
  const [newFile,setNewFile]=useState<File|null>(null);
  const [newProgress,setNewProgress]=useState('');
  const [newLocked,setNewLocked]=useState(false);
  const newFileRef=useRef<HTMLInputElement|null>(null);
  const creationAttemptRef=useRef<{
    requestId:string; text:string; file:File|null;
    suggestion?:{name:string;preset:'generic'|'properties'|'classes';category:string};
    collection?:CollectionSummary;
  }|null>(null);
  const [draft,setDraft]=useState('');
  const [composerOpen,setComposerOpen]=useState(false);
  const composerRef=useRef<HTMLTextAreaElement|null>(null);
  const attachmentInputRef=useRef<HTMLInputElement|null>(null);
  const [sourceLabel,setSourceLabel]=useState('');
  const authoringAttemptRef=useRef<{collectionId:string;text:string;sourceLabel:string;requestId:string}|null>(null);
  const [proposal,setProposal]=useState<CollectionProposal|null>(null);
  const [selectedItems,setSelectedItems]=useState<string[]>([]);
  const [search,setSearch]=useState('');
  const [itemFilter,setItemFilter]=useState('all');
  const [itemSort,setItemSort]=useState('view');
  const [searching,setSearching]=useState(false);
  const [searchResults,setSearchResults]=useState<CollectionItem[]|null>(null);
  const [preview,setPreview]=useState(false);
  const [detailItemId,setDetailItemId]=useState('');
  const [editing,setEditing]=useState<CollectionItem|null>(null);
  const [editValues,setEditValues]=useState<Record<string,string>>({});
  const [localMessages,setLocalMessages]=useState<CollectionMessage[]>([]);
  const [authoringJobs,setAuthoringJobs]=useState<CollectionAuthoringJob[]>([]);
  const [attachmentFile,setAttachmentFile]=useState<File|null>(null);
  const [attachmentRequestId,setAttachmentRequestId]=useState('');
  const [attachmentStage,setAttachmentStage]=useState<UploadStage>('idle');
  const [attachmentProgress,setAttachmentProgress]=useState(0);
  const [sourceResult,setSourceResult]=useState<CollectionSourceResult|CollectionPdfResult|null>(null);
  const [attachmentFailure,setAttachmentFailure]=useState('');
  const [sourceReview,setSourceReview]=useState<CollectionSourceReview|null>(null);
  const [sourceLoading,setSourceLoading]=useState(false);
  const [previewQuery,setPreviewQuery]=useState('');
  const [answerPreview,setAnswerPreview]=useState<CollectionAnswerPreview|null>(null);
  const [answerError,setAnswerError]=useState<{message:string;code?:string;retryable?:boolean}|null>(null);
  const [answerLoading,setAnswerLoading]=useState(false);
  const interruptedJob=authoringJobs.find(job=>job.status==='failed'||job.status==='pending'||job.status==='conflict'||(job.status==='needs-review'&&!job.proposalId&&!!job.warning));
  const sourceDialogOpenerRef=useRef<HTMLButtonElement|null>(null);
  const detailSheetOpenerRef=useRef<HTMLElement|null>(null);
  const editorDialogOpenerRef=useRef<HTMLElement|null>(null);
  const selectedIdRef=useRef('');
  const navigationRevisionRef=useRef(0);
  const detailRequestRef=useRef(0);
  const collectionsRequestRef=useRef(0);
  const searchRequestRef=useRef(0);
  const sourceRequestRef=useRef(0);

  const runSearch=useCallback(async(term:string)=>{
    const collectionId=selectedIdRef.current;
    if(!collectionId||!term.trim()||preview){setSearchResults(null);return;}
    const searchRequest=searchRequestRef.current+1;
    searchRequestRef.current=searchRequest;
    setSearching(true);setError('');
    try{
      const query=new URLSearchParams({collectionIds:collectionId,text:term.trim(),pageSize:'100'});
      const result=searchItems(await collectionApi<CollectionSearchPayload>(`/search?${query}`));
      if(selectedIdRef.current===collectionId&&searchRequestRef.current===searchRequest&&!preview)setSearchResults(result);
    }catch(e){if(selectedIdRef.current===collectionId&&searchRequestRef.current===searchRequest&&!preview)setError((e as Error).message);}finally{if(searchRequestRef.current===searchRequest)setSearching(false);}
  },[preview]);

  useEffect(()=>{
    if(selectedId&&detail?.collection.name)setTopBarDetailName(detail.collection.name);
    else clearTopBarDetailName();
    return clearTopBarDetailName;
  },[selectedId,detail?.collection.name]);

  const loadCollections=useCallback(async()=>{
    const request=collectionsRequestRef.current+1;
    collectionsRequestRef.current=request;
    setLoading(true);setError('');
    try{
      const payload=await collectionApi<CollectionListPayload>('?pageSize=100');
      const next=summaries(payload);
      if(collectionsRequestRef.current===request)setCollections(next);
    }catch(e){if(collectionsRequestRef.current===request)setError((e as Error).message);}finally{if(collectionsRequestRef.current===request)setLoading(false);}
  },[]);

  const loadDetail=useCallback(async(id:string,asPreview=false)=>{
    if(!id){setDetail(null);setAuthoringJobs([]);return;}
    const navigationRevision=navigationRevisionRef.current;
    const detailRequest=detailRequestRef.current+1;
    detailRequestRef.current=detailRequest;
    setDetailLoading(true);setError('');
    try{
      const suffix=asPreview?'?audience=visitor&preview=1':'';
      const [payload,jobsPayload]=await Promise.all([
        collectionApi<CollectionViewPayload>(`/${encodeURIComponent(id)}/view${suffix}`),
        collectionApi<CollectionAuthoringJobsPayload>(`/authoring-jobs?collectionId=${encodeURIComponent(id)}&limit=20`),
      ]);
      let next=viewData(payload);
      let nextProposal=next.proposals?.find(item=>!item.operations.every(operation=>operation.kind==='set_view'))||null;
      let jobs=jobsPayload.jobs||[];
      const resumable=!asPreview&&nextProposal?jobs.find(job=>job.proposalId===nextProposal?.id):undefined;
      if(resumable){
        const resumed=await collectionApi<CollectionAuthoringJobPayload>(`/authoring-jobs/${encodeURIComponent(resumable.id)}`);
        jobs=jobs.map(job=>job.id===resumed.job.id?resumed.job:job);
        if(resumed.view)next=resumed.view;
        if(resumed.proposal)nextProposal=resumed.proposal;
      }
      if(selectedIdRef.current!==id||navigationRevisionRef.current!==navigationRevision||detailRequestRef.current!==detailRequest)return;
      setAuthoringJobs(jobs);
      setDetail(next);
      setProposal(nextProposal);
      setLocalMessages(next.messages||[]);
      const eligible=(next.items||[]).filter(item=>!item.archived).map(item=>item.id);
      setSelectedItems(eligible);
    }catch(e){if(selectedIdRef.current===id&&navigationRevisionRef.current===navigationRevision&&detailRequestRef.current===detailRequest)setError((e as Error).message);}finally{if(selectedIdRef.current===id&&navigationRevisionRef.current===navigationRevision&&detailRequestRef.current===detailRequest)setDetailLoading(false);}
  },[]);

  useEffect(()=>{void loadCollections();},[loadCollections]);
  useEffect(()=>{setComposerOpen(false);setDraft('');setSourceLabel('');authoringAttemptRef.current=null;selectedIdRef.current=selectedId;searchRequestRef.current+=1;sourceRequestRef.current+=1;setPreview(false);setDetailItemId('');setSearch('');setSearchResults(null);setAttachmentFile(null);setSourceResult(null);setAttachmentFailure('');setAttachmentStage('idle');setSourceReview(null);setSourceLoading(false);setAnswerPreview(null);setPreviewQuery('');setAuthoringJobs([]);if(selectedId)void loadDetail(selectedId);},[selectedId,loadDetail]);
  useEffect(()=>{
    if(!selectedId||preview)return;
    const term=search.trim();
    if(!term){searchRequestRef.current+=1;setSearchResults(null);setSearching(false);return;}
    const timeout=window.setTimeout(()=>void runSearch(term),250);
    return()=>window.clearTimeout(timeout);
  },[detail?.collection.revision,preview,runSearch,search,selectedId]);
  useEffect(()=>{
    const syncFromUrl=()=>{
      const params=new URLSearchParams(window.location.search);
      const collectionId=params.get('collection')||'';
      navigationRevisionRef.current+=1;
      selectedIdRef.current=collectionId;
      setCreating(params.get('new')==='1');
      setSelectedId(collectionId);
    };
    syncFromUrl();
    window.addEventListener('popstate',syncFromUrl);
    return()=>window.removeEventListener('popstate',syncFromUrl);
  },[]);

  const selectedCollection=useMemo(()=>detail?.collection.id===selectedId?detail.collection:collections.find(item=>item.id===selectedId)||null,[collections,selectedId,detail]);
  const visibleCollections=useMemo(()=>collections.filter(collection=>{
    if(collectionFilter==='published'&&!(collection.publishedCount||0))return false;
    if(collectionFilter==='draft'&&(collection.itemCount||0)>0&&(collection.publishedCount||0)>=(collection.itemCount||0))return false;
    if(collectionFilter==='review'&&!(collection.needsReviewCount||0))return false;
    return collection.name.toLocaleLowerCase().includes(collectionSearch.trim().toLocaleLowerCase());
  }).sort((left,right)=>{
    if(collectionSort==='name')return left.name.localeCompare(right.name,undefined,{sensitivity:'base'});
    if(collectionSort==='items')return (right.itemCount||0)-(left.itemCount||0);
    const difference=Date.parse(right.updatedAt||'')-Date.parse(left.updatedAt||'');
    return Number.isNaN(difference)?0:difference;
  }),[collectionFilter,collectionSearch,collectionSort,collections]);
  const publishedRevisions=useMemo(()=>new Map((detail?.publishedItems||[]).map(item=>[item.id,item.revision])),[detail]);
  const pendingItemIds=useMemo(()=>new Set((proposal?.operations||[]).map(operation=>operation.itemId).filter((id):id is string=>!!id)),[proposal]);
  const detailItem=useMemo(()=>{
    const items=preview?(detail?.publishedItems||[]):(detail?.items||[]);
    return items.find(item=>item.id===detailItemId)||null;
  },[detail,detailItemId,preview]);
  const detailTitleField=detail?.schema.find(field=>field.id===detail.view.titleField)||detail?.schema[0];
  const visibleItems=useMemo(()=>{
    if(!detail)return [];
    let items=[...(!preview&&searchResults?searchResults:preview?(detail.publishedItems||[]):detail.items||[])];
    if(preview&&search.trim()){
      const query=search.trim().toLocaleLowerCase();
      items=items.filter(item=>Object.values(item.values).some(value=>displayValue(value).toLocaleLowerCase().includes(query)));
    }
    items=items.filter(item=>{
      const published=publishedRevisions.get(item.id)===item.revision;
      if(itemFilter==='published')return published;
      if(itemFilter==='draft')return !published;
      if(itemFilter==='outdated')return isOutdated(item.validThrough);
      return true;
    });
    const titleField=detail.schema.find(field=>field.id===detail.view.titleField)||detail.schema[0];
    if(itemSort==='name')return items.sort((left,right)=>displayValue(titleField&&left.values[titleField.id]).localeCompare(displayValue(titleField&&right.values[titleField.id]),undefined,{sensitivity:'base'}));
    if(itemSort==='recent')return items.sort((left,right)=>Date.parse(right.updatedAt)-Date.parse(left.updatedAt));
    if(detail.view.layout==='agenda'&&detail.view.startField){
      const startField=detail.view.startField;
      return items.sort((a,b)=>String(a.values[startField]||'').localeCompare(String(b.values[startField]||'')));
    }
    return items;
  },[detail,itemFilter,itemSort,preview,publishedRevisions,search,searchResults]);

  function upsertAuthoringJob(job:CollectionAuthoringJob){
    setAuthoringJobs(current=>[job,...current.filter(item=>item.id!==job.id)].sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt)).slice(0,20));
  }

  function hydrateAuthoringJob(result:CollectionAuthoringJobPayload){
    upsertAuthoringJob(result.job);
    if(result.view){setDetail(result.view);setLocalMessages(result.view.messages||[]);}
    const nextProposal=result.proposal||result.view?.proposals?.find(item=>!item.operations.every(operation=>operation.kind==='set_view'));
    if(nextProposal)setProposal(nextProposal);
  }

  function changeNewContent(value:string){
    setNewContent(value);setError('');
    if(!newLocked)creationAttemptRef.current=null;
  }

  function chooseNewFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    if(!file)return;
    const kind=attachmentKind(file);
    if(!kind){setError('Choose a PDF, PNG, JPEG, or WebP image.');event.target.value='';return;}
    const limit=kind==='pdf'?MAX_PDF_BYTES:MAX_IMAGE_BYTES;
    if(file.size>limit){setError(`Choose a ${kind==='pdf'?'PDF smaller than 10 MB':'image smaller than 6 MB'}.`);event.target.value='';return;}
    setNewFile(file);setError('');creationAttemptRef.current=null;
  }

  async function createCollection(event:FormEvent){
    event.preventDefault();
    if((!newContent.trim()&&!newFile)||busy)return;
    const navigationRevision=navigationRevisionRef.current;
    const attempt=creationAttemptRef.current||{requestId:crypto.randomUUID(),text:newContent.trim(),file:newFile};
    creationAttemptRef.current=attempt;
    const isCurrent=()=>navigationRevisionRef.current===navigationRevision;
    setBusy('create');setError('');setNotice('');
    try{
      const sourceUrl=!attempt.file?wholeHttpUrl(attempt.text):undefined;
      if(!attempt.suggestion){
        setNewProgress(attempt.file?`Reading your ${attachmentLabel(attempt.file).toLowerCase()}…`:sourceUrl?'Reading the website…':'Finding a name and category…');
        const result=attempt.file
          ?await uploadCollectionFile<{suggestion:NonNullable<typeof attempt.suggestion>}>('/suggest',attempt.file,{requestId:attempt.requestId+'-suggest'},stage=>{if(isCurrent())setNewProgress(stage==='processing'?'Finding a name and category…':`Reading your ${attachmentLabel(attempt.file!).toLowerCase()}…`);})
          :await collectionApi<{suggestion:NonNullable<typeof attempt.suggestion>}>('/suggest',sourceUrl?{url:sourceUrl,requestId:attempt.requestId+'-suggest'}:{text:attempt.text,requestId:attempt.requestId+'-suggest'});
        attempt.suggestion=result.suggestion;
      }
      if(!isCurrent())return;
      // Once saving begins, keep these exact arguments for a lost-response retry.
      setNewLocked(true);
      if(!attempt.collection){
        setNewProgress('Creating '+attempt.suggestion.name+'…');
        const result=await collectionApi<CollectionSummary|{collection:CollectionSummary}>('',{
          name:attempt.suggestion.name,preset:attempt.suggestion.preset,category:attempt.suggestion.category,requestId:attempt.requestId+'-create',
        });
        attempt.collection='collection' in result?result.collection:result;
      }
      if(!isCurrent()){await loadCollections();return;}
      setNewProgress('Organizing your information…');
      const created=attempt.collection;
      const fields={requestId:attempt.requestId+'-content',expectedRevision:created.revision};
      const result=attempt.file
        ?attachmentKind(attempt.file)==='pdf'
          ?await uploadCollectionFile<CollectionPdfResult>(`/${encodeURIComponent(created.id)}/upload`,attempt.file,fields)
          :await uploadCollectionFile<CollectionSourceResult>(`/${encodeURIComponent(created.id)}/sources`,attempt.file,fields)
        :sourceUrl
          ?await collectionApi<CollectionSourceResult>(`/${encodeURIComponent(created.id)}/sources`,{url:sourceUrl,...fields})
          :await collectionApi<CollectionAuthoringResult>(`/${encodeURIComponent(created.id)}/messages`,{content:attempt.text,...fields});
      await loadCollections();
      if(!isCurrent())return;
      setCreating(false);setNewContent('');setNewFile(null);setNewLocked(false);creationAttemptRef.current=null;
      setNotice(result.proposal?'Your collection is ready to review.':result.job.warning||'Your information is saved. Open the saved operation to continue organizing.');
      selectedIdRef.current=created.id;
      window.history.replaceState(null,'',`?collection=${encodeURIComponent(created.id)}`);
      setSelectedId(created.id);
    }catch(e){
      if(isCurrent())setError((e as Error).message);
    }finally{
      setBusy('');setNewProgress('');
    }
  }

  async function submitAuthoring(event:FormEvent){
    event.preventDefault();
    if(!selectedCollection||!draft.trim()||busy)return;
    const collectionId=selectedCollection.id;
    const content=draft.trim();
    const label=sourceLabel.trim();
    const sourceUrl=wholeHttpUrl(content);
    const cached=authoringAttemptRef.current;
    const attempt=cached&&cached.collectionId===collectionId&&cached.text===content&&cached.sourceLabel===label
      ?cached
      :{collectionId,text:content,sourceLabel:label,requestId:crypto.randomUUID()};
    authoringAttemptRef.current=attempt;
    const optimistic:CollectionMessage|undefined=sourceUrl?undefined:{id:`pending-${crypto.randomUUID()}`,speaker:'owner',content,createdAt:new Date().toISOString(),state:'sending'};
    if(optimistic)setLocalMessages(current=>[...current,optimistic]);
    setBusy(sourceUrl?'source':'message');setError('');setNotice('');setAttachmentFailure('');
    try{
      const fields={expectedRevision:selectedCollection.revision,requestId:attempt.requestId};
      const result=sourceUrl
        ?await collectionApi<CollectionSourceResult>(`/${encodeURIComponent(collectionId)}/sources`,{url:sourceUrl,...fields})
        :await collectionApi<CollectionAuthoringResult>(`/${encodeURIComponent(collectionId)}/messages`,{content,sourceLabel:label||undefined,...fields});
      if(selectedIdRef.current!==collectionId){await loadCollections();return;}
      setDraft('');setSourceLabel('');authoringAttemptRef.current=null;
      if(sourceUrl){setSourceResult(result as CollectionSourceResult);setAttachmentStage('success');}
      upsertAuthoringJob(result.job);
      if(optimistic&&'message' in result&&result.message)setLocalMessages(current=>[...current.filter(message=>message.id!==optimistic.id),result.message!]);
      else if(optimistic)setLocalMessages(current=>current.map(message=>message.id===optimistic.id?{...message,state:'saved'}:message));
      if(result.proposal){setProposal(result.proposal);setNotice('A change proposal is ready for review.');}
      else setNotice(result.job.warning||'Your information is saved. Organization is not finished yet.');
      if(result.view)setDetail(result.view);else await loadDetail(collectionId);
      await loadCollections();
    }catch(e){
      if(selectedIdRef.current!==collectionId)return;
      if(e instanceof CollectionApiError&&e.job){
        upsertAuthoringJob(e.job);
        if(optimistic)setLocalMessages(current=>current.map(message=>message.id===optimistic.id?{...message,state:'saved'}:message));
        await loadDetail(collectionId);
      }else if(optimistic){
        setLocalMessages(current=>current.map(message=>message.id===optimistic.id?{...message,state:'error'}:message));
      }
      setError((e as Error).message);
    }finally{setBusy('');}
  }

  function chooseAttachment(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]||null;
    setSourceResult(null);setAttachmentFailure('');setAttachmentProgress(0);
    if(!file){setAttachmentFile(null);setAttachmentStage('idle');return;}
    const kind=attachmentKind(file);
    if(!kind){
      setAttachmentFile(null);setAttachmentStage('failed');setAttachmentFailure('Choose a PDF, PNG, JPEG, or WebP image.');event.target.value='';return;
    }
    const limit=kind==='pdf'?MAX_PDF_BYTES:MAX_IMAGE_BYTES;
    if(file.size>limit){
      setAttachmentFile(null);setAttachmentStage('failed');setAttachmentFailure(`This ${kind==='pdf'?'PDF':'image'} is ${sizeLabel(file.size)}. The limit is ${kind==='pdf'?'10 MB':'6 MB'}.`);event.target.value='';return;
    }
    setAttachmentFile(file);setAttachmentRequestId(crypto.randomUUID());setAttachmentStage('idle');
  }

  async function submitAttachment(){
    if(!attachmentFile||!selectedCollection||busy)return;
    const collectionId=selectedCollection.id;
    const kind=attachmentKind(attachmentFile);
    if(!kind)return;
    setBusy('attachment');setAttachmentFailure('');setSourceResult(null);setAttachmentStage('reading');setAttachmentProgress(0);setError('');setNotice('');
    try{
      const path=kind==='pdf'?`/${encodeURIComponent(collectionId)}/upload`:`/${encodeURIComponent(collectionId)}/sources`;
      const fields={requestId:attachmentRequestId||crypto.randomUUID(),expectedRevision:selectedCollection.revision};
      const result=kind==='pdf'
        ?await uploadCollectionFile<CollectionPdfResult>(path,attachmentFile,fields,(stage,percent)=>{setAttachmentStage(stage);setAttachmentProgress(percent);})
        :await uploadCollectionFile<CollectionSourceResult>(path,attachmentFile,fields,(stage,percent)=>{setAttachmentStage(stage);setAttachmentProgress(percent);});
      if(selectedIdRef.current!==collectionId){await loadCollections();return;}
      setSourceResult(result);setAttachmentStage('outcome' in result?result.outcome:'success');setAttachmentProgress(100);
      upsertAuthoringJob(result.job);
      if(result.proposal)setProposal(result.proposal);
      if(result.view)setDetail(result.view);else await loadDetail(collectionId);
      if(result.proposal)setNotice(`The ${kind==='pdf'?'PDF':'image'} source is saved and its proposed changes are ready to review. Nothing has been published.`);
      else setNotice(result.job.warning||`The ${kind==='pdf'?'PDF':'image'} source is saved. Organization is not finished yet.`);
    }catch(e){
      if(selectedIdRef.current!==collectionId)return;
      const message=(e as Error).message;
      if(e instanceof CollectionApiError&&e.job){upsertAuthoringJob(e.job);await loadDetail(collectionId);}
      setAttachmentFailure(message);setAttachmentStage('failed');setError(message);
    }finally{setBusy('');}
  }

  async function retryAuthoringJob(job:CollectionAuthoringJob){
    if(!selectedCollection||busy||!job.recoverable||job.status==='organizing')return;
    const collectionId=selectedCollection.id;
    setBusy(`job:${job.id}`);setError('');setNotice('');
    try{
      const result=await collectionApi<CollectionAuthoringJobPayload>(`/authoring-jobs/${encodeURIComponent(job.id)}/retry`,{
        expectedRevision:selectedCollection.revision,
        requestId:crypto.randomUUID(),
      });
      if(selectedIdRef.current!==collectionId){await loadCollections();return;}
      hydrateAuthoringJob(result);
      const hasProposal=!!result.proposal||!!result.view?.proposals.some(item=>item.id===result.job.proposalId);
      if(result.job.status==='needs-review'&&hasProposal)setNotice('The saved source was organized. Its proposed changes are ready to review.');
      else setNotice(result.job.warning||'Your information is saved. Organization is not finished yet.');
      await loadCollections();
    }catch(e){
      if(selectedIdRef.current!==collectionId)return;
      if(e instanceof CollectionApiError&&e.code==='REVISION_CONFLICT'&&e.job){
        upsertAuthoringJob(e.job);
        await loadDetail(selectedCollection.id);
        setError('The collection changed again while the saved source was being organized. The current version is loaded; retry the saved operation when ready.');
      }else setError((e as Error).message);
    }finally{setBusy('');}
  }

  async function inspectSource(sourceRevisionId:string,inputId?:string,opener?:HTMLButtonElement|null){
    if(opener)sourceDialogOpenerRef.current=opener;
    const navigationRevision=navigationRevisionRef.current;
    const collectionId=selectedIdRef.current;
    const sourceRequest=sourceRequestRef.current+1;
    sourceRequestRef.current=sourceRequest;
    setSourceLoading(true);setSourceReview(null);setError('');
    try{
      const query=new URLSearchParams({pageSize:'50'});if(inputId)query.set('inputId',inputId);
      const result=await collectionApi<CollectionSourceReview>(`/sources/${encodeURIComponent(sourceRevisionId)}?${query}`);
      if(sourceRequestRef.current===sourceRequest&&navigationRevisionRef.current===navigationRevision&&selectedIdRef.current===collectionId)setSourceReview(result);
    }catch(e){if(sourceRequestRef.current===sourceRequest&&navigationRevisionRef.current===navigationRevision&&selectedIdRef.current===collectionId)setError((e as Error).message);}finally{if(sourceRequestRef.current===sourceRequest)setSourceLoading(false);}
  }

  async function requestAnswerPreview(){
    if(!selectedCollection||!previewQuery.trim()||answerLoading)return;
    const collectionId=selectedCollection.id;
    setAnswerLoading(true);setAnswerPreview(null);setAnswerError(null);setError('');
    try{
      const result=await collectionApi<CollectionAnswerPreview>(`/${encodeURIComponent(selectedCollection.id)}/answer-preview`,{query:previewQuery.trim()});
      if(selectedIdRef.current===collectionId)setAnswerPreview(result);
    }catch(e){
      if(selectedIdRef.current===collectionId){
        const failure=e as CollectionApiError;
        setAnswerError({message:failure.message,code:failure.code,retryable:failure.retryable});
      }
    }finally{setAnswerLoading(false);}
  }

  function runAnswerPreview(event:FormEvent){
    event.preventDefault();
    void requestAnswerPreview();
  }

  async function applyProposal(){
    if(!proposal||!selectedCollection||busy)return;
    const collectionId=selectedCollection.id;
    setBusy('apply');setError('');setNotice('');
    try{
      await collectionApi(`/${'proposals'}/${encodeURIComponent(proposal.id)}/apply`,{expectedRevision:selectedCollection.revision,requestId:crypto.randomUUID()});
      if(selectedIdRef.current!==collectionId){await loadCollections();return;}
      setProposal(null);setComposerOpen(false);setSourceResult(null);setAttachmentFile(null);setAttachmentFailure('');setNotice('Changes saved as a draft. Published information is unchanged.');
      await Promise.all([loadDetail(selectedCollection.id),loadCollections()]);
    }catch(e){if(selectedIdRef.current===collectionId)setError((e as Error).message);}finally{setBusy('');}
  }

  async function publishSelected(){
    if(!detail||!selectedCollection||selectedItems.length===0||busy)return;
    if(!window.confirm(`Publish ${selectedItems.length} selected item${selectedItems.length===1?'':'s'} to visitors?`))return;
    const collectionId=selectedCollection.id;
    setBusy('publish');setError('');setNotice('');
    try{
      const reviewQuery=new URLSearchParams({selectedItemIds:selectedItems.join(',')});
      const reviewed=viewData(await collectionApi<CollectionViewPayload>(`/${encodeURIComponent(selectedCollection.id)}/view?${reviewQuery}`));
      if(!reviewed.reviewedPayloadHash)throw new Error('The selected draft could not be verified for publication. Reload and review it again.');
      await collectionApi(`/${encodeURIComponent(selectedCollection.id)}/publish`,{
        selectedItemIds:selectedItems,
        expectedPublicationRevision:selectedCollection.publicationRevision,
        reviewedPayloadHash:reviewed.reviewedPayloadHash,
        requestId:crypto.randomUUID(),
      });
      if(selectedIdRef.current!==collectionId){await loadCollections();return;}
      setNotice('Selected items are now published for visitors.');
      await Promise.all([loadDetail(selectedCollection.id),loadCollections()]);
    }catch(e){if(selectedIdRef.current===collectionId)setError((e as Error).message);}finally{setBusy('');}
  }

  async function saveDirectEdit(event:FormEvent){
    event.preventDefault();
    if(!editing||!detail||!selectedCollection||busy)return;
    const collectionId=selectedCollection.id;
    const values:Record<string,CollectionFieldValue>={};
    for(const field of detail.schema){
      if(!(field.id in editValues))continue;
      const raw=editValues[field.id].trim();
      if(field.type==='number')values[field.id]=raw===''?null:Number(raw);
      else if(field.type==='boolean')values[field.id]=raw==='true';
      else if(field.type==='money'){
        const match=raw.match(/^([A-Za-z]{3})\s+(-?\d+(?:\.\d+)?)$/);
        if(!match){setError(`${field.label} must use a currency and amount, for example AED 90000.`);return;}
        values[field.id]={currency:match[1].toUpperCase(),amount:Number(match[2])};
      }
      else if(field.multiple)values[field.id]=raw?raw.split(',').map(value=>value.trim()).filter(Boolean):[];
      else values[field.id]=raw||null;
    }
    setBusy('edit');setError('');
    try{
      const result=await collectionApi<CollectionProposal|{proposal:CollectionProposal}>(`/${encodeURIComponent(selectedCollection.id)}/proposals`,{
        expectedRevision:selectedCollection.revision,
        operations:[{kind:'update_item',itemId:editing.id,values}],
        sourceRevisionIds:[],unresolvedIssues:[],requestId:crypto.randomUUID(),
      });
      if(selectedIdRef.current!==collectionId)return;
      setProposal('proposal' in result?result.proposal:result);setEditing(null);setNotice('Your edit is ready to review before it is applied.');
    }catch(e){if(selectedIdRef.current===collectionId)setError((e as Error).message);}finally{setBusy('');}
  }

  function startEdit(item:CollectionItem,opener:HTMLElement){
    editorDialogOpenerRef.current=opener;
    const values:Record<string,string>={};
    for(const field of detail?.schema||[]){
      const current=item.values[field.id];
      values[field.id]=current===null||current===undefined?'':Array.isArray(current)?current.join(', '):typeof current==='object'?`${current.currency} ${current.amount}`:String(current);
    }
    setEditValues(values);setEditing(item);
  }

  function showCollectionList(){
    navigationRevisionRef.current+=1;searchRequestRef.current+=1;sourceRequestRef.current+=1;selectedIdRef.current='';
    setCreating(false);setSelectedId('');setDetail(null);setDetailItemId('');setEditing(null);setSourceReview(null);setSourceLoading(false);setNotice('');setError('');
    window.history.pushState(null,'',window.location.pathname);
  }

  function showCreateCollection(){
    navigationRevisionRef.current+=1;searchRequestRef.current+=1;sourceRequestRef.current+=1;selectedIdRef.current='';
    setSelectedId('');setDetail(null);setDetailItemId('');setEditing(null);setSourceReview(null);setSourceLoading(false);setCreating(true);setNotice('');setError('');
    window.history.pushState(null,'',`${window.location.pathname}?new=1`);
  }

  function showCollection(id:string){
    navigationRevisionRef.current+=1;searchRequestRef.current+=1;sourceRequestRef.current+=1;selectedIdRef.current=id;
    setCreating(false);setSelectedId(id);setDetailItemId('');setEditing(null);setSourceReview(null);setSourceLoading(false);setNotice('');setError('');
    window.history.pushState(null,'',`${window.location.pathname}?collection=${encodeURIComponent(id)}`);
  }

  function renderItemGrid(){
    if(!detail)return null;
    const titleField=detail.schema.find(field=>field.id===detail.view.titleField)||detail.schema[0];
    const tableFields=(detail.view.visibleFields?.length
      ?detail.view.visibleFields.map(id=>detail.schema.find(field=>field.id===id)).filter((field):field is NonNullable<typeof field>=>!!field)
      :detail.schema).filter(field=>field.id!==titleField?.id).slice(0,3);
    const selectableVisibleItems=visibleItems.filter(item=>!item.archived);
    const allVisibleSelected=selectableVisibleItems.length>0&&selectableVisibleItems.every(item=>selectedItems.includes(item.id));
    const someVisibleSelected=selectableVisibleItems.some(item=>selectedItems.includes(item.id));

    return <section aria-labelledby="collection-items-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="collection-items-heading" className="text-xl font-semibold">{preview?'Published items':'Items'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{visibleItems.length} {preview?'visible to visitors':'in this collection'}</p>
        </div>
      </div>
      <ListToolbar
        className="mt-4 rounded-lg border bg-card"
        searchLabel="Search collection items"
        searchPlaceholder="Search items"
        searchValue={search}
        onSearchChange={setSearch}
        searching={searching}
        filters={[{
          label:'Item status',
          value:itemFilter,
          onValueChange:setItemFilter,
          options:preview
            ? [{value:'all',label:'All items'},{value:'outdated',label:'Outdated'}]
            : [{value:'all',label:'All items'},{value:'published',label:'Published'},{value:'draft',label:'Drafts'},{value:'outdated',label:'Outdated'}],
        }]}
        sort={{label:'Sort items',value:itemSort,onValueChange:setItemSort,options:[{value:'view',label:'Collection order'},{value:'recent',label:'Recently updated'},{value:'name',label:'Name A–Z'}]}}
        resultLabel={`${visibleItems.length} item${visibleItems.length===1?'':'s'}`}
        active={!!search||itemFilter!=='all'||itemSort!=='view'}
        onReset={()=>{setSearch('');setSearchResults(null);setItemFilter('all');setItemSort('view');}}
      />

      {visibleItems.length===0?<div className="mt-5 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
        <FileText className="size-6 text-muted-foreground"/>
        <h3 className="mt-4 font-semibold">{search||itemFilter!=='all'?'No matching items':preview?'Nothing is published yet':'No items yet'}</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{search||itemFilter!=='all'?'Try a different search or filter.':preview?'Return to editing, select items, then publish them.':'Add text, a website link, a PDF, or an image above. Organized items will appear here for review.'}</p>
      </div>:preview?<div className={'mt-5 grid gap-4 '+(detail.view.layout==='detail'?'grid-cols-1':'sm:grid-cols-2 lg:grid-cols-3')}>{visibleItems.map(item=>{
        const subtitleField=detail.schema.find(field=>field.id===detail.view.subtitleField)||detail.schema[1];
        const fields=(detail.view.visibleFields?.length?detail.view.visibleFields.map(id=>detail.schema.find(field=>field.id===id)).filter((field):field is NonNullable<typeof field>=>!!field):detail.schema).filter(field=>field.id!==titleField?.id&&field.id!==subtitleField?.id).slice(0,4);
        return <button type="button" key={item.id} onClick={event=>{detailSheetOpenerRef.current=event.currentTarget;setDetailItemId(item.id);}} className="flex min-h-56 flex-col rounded-2xl border bg-card p-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h3 className="truncate text-lg font-semibold">{displayValue(titleField&&item.values[titleField.id])}</h3>{subtitleField&&<p className="mt-1 truncate text-sm text-muted-foreground">{displayValue(item.values[subtitleField.id],subtitleField.unit)}</p>}</div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">{fields.map(field=><div key={field.id} className="min-w-0"><dt className="truncate text-xs text-muted-foreground">{field.label}</dt><dd className="mt-1 break-words text-sm">{displayValue(item.values[field.id],field.unit)}</dd></div>)}</dl>
        </button>;
      })}</div>:<div className="mt-5 overflow-hidden rounded-xl border bg-card">
        <Table className="min-w-[760px]">
          <TableHeader className="bg-muted/35">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-11 pl-4">
                <input
                  ref={element=>{if(element)element.indeterminate=someVisibleSelected&&!allVisibleSelected;}}
                  type="checkbox"
                  aria-label="Select all visible items for publishing"
                  checked={allVisibleSelected}
                  disabled={selectableVisibleItems.length===0}
                  onChange={event=>setSelectedItems(current=>{
                    const visibleIds=new Set(selectableVisibleItems.map(item=>item.id));
                    return event.target.checked
                      ?Array.from(new Set([...current,...visibleIds]))
                      :current.filter(id=>!visibleIds.has(id));
                  })}
                  className="size-4"
                />
              </TableHead>
              <TableHead className="min-w-52">{titleField?.label||'Item'}</TableHead>
              {tableFields.map(field=><TableHead key={field.id} className="min-w-36">{field.label}</TableHead>)}
              <TableHead className="min-w-36">Status</TableHead>
              <TableHead className="min-w-36">Updated</TableHead>
              <TableHead className="w-24 text-right"><span className="sr-only">Open item</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{visibleItems.map(item=>{
            const publishedRevision=publishedRevisions.get(item.id);
            const isPublished=publishedRevision===item.revision;
            const hasPublishedRevision=publishedRevision!==undefined;
            const needsReview=pendingItemIds.has(item.id);
            const itemName=displayValue(titleField&&item.values[titleField.id]);
            return <TableRow
              key={item.id}
              data-state={selectedItems.includes(item.id)?'selected':undefined}
              tabIndex={0}
              aria-label={`Open ${itemName}`}
              className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={event=>{detailSheetOpenerRef.current=event.currentTarget;setDetailItemId(item.id);}}
              onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();detailSheetOpenerRef.current=event.currentTarget;setDetailItemId(item.id);}}}
            >
              <TableCell className="pl-4" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
                <input type="checkbox" disabled={item.archived} aria-label={`Select ${itemName} for publishing`} checked={selectedItems.includes(item.id)} onChange={event=>setSelectedItems(current=>event.target.checked?Array.from(new Set([...current,item.id])):current.filter(id=>id!==item.id))} className="size-4"/>
              </TableCell>
              <TableCell className="max-w-72"><span className="block truncate font-medium">{itemName}</span></TableCell>
              {tableFields.map(field=><TableCell key={field.id} className="max-w-56 text-muted-foreground"><span className="block truncate">{displayValue(item.values[field.id],field.unit)}</span></TableCell>)}
              <TableCell><div className="flex items-center gap-1.5"><Badge variant={item.archived?'destructive':needsReview?'outline':isPublished?'secondary':'outline'}>{item.archived?'Archived':needsReview?'Needs review':isPublished?'Published':hasPublishedRevision?'Draft update':'Draft'}</Badge>{item.status!=='unknown'&&<Badge variant="outline">{item.status}</Badge>}{isOutdated(item.validThrough)&&<Badge variant="destructive">Outdated</Badge>}</div></TableCell>
              <TableCell className="text-muted-foreground">{timeLabel(item.updatedAt)}</TableCell>
              <TableCell className="text-right" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}><Button variant="ghost" size="sm" onClick={event=>{detailSheetOpenerRef.current=event.currentTarget;setDetailItemId(item.id);}}>Details</Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
    </section>;
  }

  return <div className="collections-page min-h-[calc(100dvh-4.25rem)] bg-background">
    {!creating&&!selectedId&&<main className="standard-page standard-page--wide">
      <PageHeader title="Collections" description="Keep the information your concierge can use with visitors." actions={<Button onClick={showCreateCollection}><Plus className="size-4"/>Add collection</Button>}/>

      {error&&<div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0"/><p className="flex-1">{error}</p><button aria-label="Dismiss error" onClick={()=>setError("")}><X className="size-4"/></button></div>}

      {loading?<div role="status" className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading collections…</div>:collections.length===0?<section className="mt-10 flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-muted"><Layers3 className="size-5 text-muted-foreground"/></span>
        <h2 className="mt-5 text-xl font-semibold">No collections yet</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Create one from copied text, a website link, a PDF, or an image.</p>
        <Button className="mt-6" onClick={showCreateCollection}><Plus className="size-4"/>Add your first collection</Button>
      </section>:<section className="mt-8" aria-label="All collections">
        <ListToolbar
          className="mb-5 rounded-xl border bg-card"
          searchLabel="Search collections"
          searchPlaceholder="Search collections"
          searchValue={collectionSearch}
          onSearchChange={setCollectionSearch}
          filters={[{label:'Collection status',value:collectionFilter,onValueChange:setCollectionFilter,options:[{value:'all',label:'All collections'},{value:'published',label:'Published'},{value:'draft',label:'Drafts'},{value:'review',label:'Needs review'}]}]}
          sort={{label:'Sort collections',value:collectionSort,onValueChange:setCollectionSort,options:[{value:'recent',label:'Recently updated'},{value:'name',label:'Name A–Z'},{value:'items',label:'Most items'}]}}
          resultLabel={`${visibleCollections.length} of ${collections.length} collections`}
          active={!!collectionSearch||collectionFilter!=='all'||collectionSort!=='recent'}
          onReset={()=>{setCollectionSearch('');setCollectionFilter('all');setCollectionSort('recent');}}
        />
        {visibleCollections.length===0?<div className="mb-4 rounded-xl border border-dashed p-8 text-center"><h2 className="text-sm font-medium">No matching collections</h2><p className="mt-2 text-sm text-muted-foreground">Try another search or filter.</p></div>:null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCollections.map(collection=><button key={collection.id} onClick={()=>showCollection(collection.id)} className="group flex min-h-40 flex-col rounded-2xl border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm">
            <div className="flex items-start justify-between gap-4"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Layers3 className="size-4"/></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1"/></div>
            <h3 className="mt-5 truncate text-lg font-semibold">{collection.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{collection.itemCount||0} item{collection.itemCount===1?"":"s"} · {collection.publishedCount||0} published</p>
          </button>)}
          <button onClick={showCreateCollection} className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"><Plus className="size-5"/><span className="mt-3 text-sm font-medium">Add collection</span></button>
        </div>
      </section>}
    </main>}

    {creating&&<main className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8 sm:py-12">
      <Button variant="ghost" className="-ml-3" onClick={showCollectionList} disabled={busy==='create'}><ArrowLeft className="size-4"/>All collections</Button>
      <div className="mt-12 sm:mt-20">
        <h1 className="text-3xl font-semibold tracking-tight">Start with what you have.</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Add your information. AI will name the collection, choose a category, and organize the items.</p>
      </div>
      <form onSubmit={createCollection} className="mt-7 overflow-hidden rounded-2xl border bg-card shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10" aria-busy={busy==='create'}>
        <Textarea autoFocus aria-label="Collection information" value={newContent} onChange={event=>changeNewContent(event.target.value)} disabled={!!newFile||!!busy||newLocked} maxLength={100000} className="min-h-56 resize-y rounded-none border-0 bg-transparent px-5 py-5 text-base leading-7 shadow-none focus-visible:ring-0" placeholder={newFile?`Your ${attachmentLabel(newFile).toLowerCase()} is ready to organize.`:`Paste your services, properties, classes, products, or one website URL…

Include whatever details you have — descriptions, prices, dates, or availability.`}/>
        {newFile&&<div className="mx-4 mb-4 flex items-center gap-3 rounded-xl bg-muted/50 p-3"><FileText className="size-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{newFile.name}</p><p className="mt-1 text-xs text-muted-foreground">{sizeLabel(newFile.size)}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Remove attachment" disabled={!!busy||newLocked} onClick={()=>{setNewFile(null);setError('');creationAttemptRef.current=null;if(newFileRef.current)newFileRef.current.value='';}}><X className="size-4"/></Button></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3">
          <input ref={newFileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" className="hidden" aria-label="Choose a PDF or image" onChange={chooseNewFile}/>
          <Button type="button" variant="ghost" size="sm" disabled={!!busy||newLocked} onClick={()=>newFileRef.current?.click()}><Paperclip className="size-4"/>Attach file</Button>
          <Button type="submit" disabled={(!newContent.trim()&&!newFile)||!!busy}>{busy==='create'?<Loader2 className="size-4 animate-spin"/>:<ArrowRight className="size-4"/>}{busy==='create'?'Organizing…':newLocked?'Try again':'Organize'}</Button>
        </div>
      </form>
      {newProgress&&<p role="status" className="mt-4 text-sm text-muted-foreground">{newProgress}</p>}
      {error&&<div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="text-destructive">{error}</p><p className="mt-2 text-muted-foreground">Your input is still here. {newLocked?'Try again to continue the same collection.':'You can adjust it or try again.'}</p>{newLocked&&<div className="mt-3"><Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={()=>{creationAttemptRef.current=null;setNewLocked(false);setError('');void loadCollections();}}>Use different information</Button><p className="mt-2 text-xs text-muted-foreground">Any saved draft remains in Collections.</p></div>}</div>}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{newFile&&newContent.trim()?`Only the attached ${attachmentLabel(newFile).toLowerCase()} will be organized. Remove it to use your text.`:wholeHttpUrl(newContent)?'Website link detected. Youbot will read it after you continue.':'PDFs up to 10 MB; PNG, JPEG, or WebP images up to 6 MB. Everything stays private until you publish.'}</p>
    </main>}

    {!creating&&selectedId&&<div className="workspace-columns"><aside aria-label="Collections" className="collections-rail workspace-rail hidden min-[1440px]:flex">
      <div className="flex h-14 items-center justify-between border-b px-4"><h2 className="text-sm font-semibold">Collections</h2><Button variant="ghost" size="icon" aria-label="Add collection" onClick={showCreateCollection}><Plus className="size-4"/></Button></div>
      <ListToolbar searchLabel="Search collections" searchPlaceholder="Search collections" searchValue={collectionSearch} onSearchChange={setCollectionSearch} filters={[{label:'Collection status',value:collectionFilter,onValueChange:setCollectionFilter,options:[{value:'all',label:'All collections'},{value:'published',label:'Published'},{value:'draft',label:'Drafts'},{value:'review',label:'Needs review'}]}]} sort={{label:'Sort collections',value:collectionSort,onValueChange:setCollectionSort,options:[{value:'recent',label:'Recently updated'},{value:'name',label:'Name A–Z'},{value:'items',label:'Most items'}]}} resultLabel={`${visibleCollections.length} of ${collections.length}`} active={!!collectionSearch||collectionFilter!=='all'||collectionSort!=='recent'} onReset={()=>{setCollectionSearch('');setCollectionFilter('all');setCollectionSort('recent');}}/>
      <nav className="flex flex-col p-2">{visibleCollections.length===0?<p className="p-3 text-sm text-muted-foreground">No matching collections.</p>:visibleCollections.map(collection=><button key={collection.id} aria-current={collection.id===selectedId?'page':undefined} onClick={()=>showCollection(collection.id)} className={`rounded-lg px-3 py-3 text-left transition-colors ${collection.id===selectedId?'bg-card font-medium':'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span className="block truncate text-sm">{collection.name}</span><span className="mt-1 block text-xs text-muted-foreground">{collection.itemCount||0} items · {collection.publishedCount||0} published</span></button>)}</nav>
    </aside><main className="collection-editor workspace-canvas w-full px-5 py-5 sm:px-7 sm:py-6">
      <Button variant="ghost" className="-ml-3" onClick={showCollectionList}><ArrowLeft className="size-4"/>All collections</Button>
      {error&&<div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0"/><div className="flex-1"><p>{error}</p>{error.toLowerCase().includes("revision")&&<Button className="mt-3" variant="outline" onClick={()=>void loadDetail(selectedId)}>Reload current version</Button>}</div><button aria-label="Dismiss error" onClick={()=>setError("")}><X className="size-4"/></button></div>}
      {notice&&<p role="status" className="mt-5 rounded-xl border bg-primary/5 px-4 py-3 text-sm">{notice}</p>}

      {detailLoading||!detail?<div role="status" className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading collection…</div>:<>
        <header className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <div className="min-w-0"><h1 className="break-words">{detail.collection.name}</h1>{detail.items.length>0&&<p className="mt-1.5 text-xs text-muted-foreground">{detail.items.length} item{detail.items.length===1?'':'s'} · {detail.publishedItems.length ? `${detail.publishedItems.length} published` : 'Private until you publish'}</p>}</div>
          <div className="flex flex-wrap items-center gap-2">
            {(detail.items.length>0||preview)&&<Button variant="ghost" size="sm" onClick={()=>{const next=!preview;searchRequestRef.current+=1;setSearching(false);setPreview(next);setDetailItemId('');setSearchResults(null);setAnswerPreview(null);setAnswerError(null);void loadDetail(detail.collection.id,next);}}><Eye className="size-4"/>{preview?'Back to editing':'Visitor preview'}</Button>}
            {!preview&&detail.items.length>0&&<Button size="sm" onClick={()=>{setComposerOpen(true);requestAnimationFrame(()=>composerRef.current?.focus());}}><Plus className="size-4"/>Add items</Button>}
          </div>
        </header>

        {!preview&&interruptedJob&&<section role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold">Your information is saved, but needs attention</h2>
          <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{authoringJobProgress(interruptedJob)}</p>
          {interruptedJob.recoverable&&<Button className="mt-3" size="sm" onClick={()=>void retryAuthoringJob(interruptedJob)} disabled={!!busy}>{busy===`job:${interruptedJob.id}`?<Loader2 className="size-4 animate-spin"/>:<ArrowRight className="size-4"/>}Retry saved information</Button>}
        </section>}

        {preview?<div className="mt-8 space-y-7">
          <div role="status" className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"><Eye className="size-4"/><span><strong>Visitor preview.</strong> Only published information appears here. Nothing will be sent.</span></div>
          <section className="rounded-2xl border bg-card p-5 sm:p-6" aria-label="Preview a visitor answer"><h2 className="text-lg font-semibold">Ask a visitor question</h2><p className="mt-1 text-sm text-muted-foreground">See how Youbot answers from this collection.</p><form onSubmit={runAnswerPreview} className="mt-4 flex flex-col gap-2 sm:flex-row"><Input value={previewQuery} onChange={event=>{setPreviewQuery(event.target.value);setAnswerPreview(null);setAnswerError(null);}} maxLength={1000} placeholder="Which classes are available this weekend?" aria-label="Visitor question to preview"/><Button type="submit" disabled={!previewQuery.trim()||answerLoading}>{answerLoading?<Loader2 className="size-4 animate-spin"/>:"Preview answer"}</Button></form>{answerError&&<div role="alert" className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="font-medium">{answerError.code==='ANSWER_UNAVAILABLE'?'Answer preview is temporarily unavailable':'Youbot could not safely prepare this answer'}</p><p className="mt-1 text-muted-foreground">{answerError.message}</p>{answerError.retryable&&<Button type="button" className="mt-3" size="sm" variant="outline" onClick={()=>void requestAnswerPreview()}>Try again</Button>}</div>}{answerPreview&&<div className="mt-5 rounded-xl bg-muted/40 p-4" aria-live="polite"><p className="whitespace-pre-wrap text-sm leading-6">{answerPreview.answer}</p>{answerPreview.supportingItems.length>0&&<p className="mt-3 text-xs text-muted-foreground">{answerPreview.supportingItems.length} published item{answerPreview.supportingItems.length===1?"":"s"} supported this answer.</p>}{answerPreview.limitations.length>0&&<ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{answerPreview.limitations.map(limit=><li key={limit}>{limit}</li>)}</ul>}</div>}</section>
          {renderItemGrid()}
        </div>:<div className="mt-8 space-y-10">
          {proposal&&<section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-primary">Ready to review</p><h2 className="mt-1 text-xl font-semibold">{proposal.operations.length} proposed change{proposal.operations.length===1?"":"s"}</h2></div><Badge variant={proposal.unresolvedIssues.length?"destructive":"secondary"}>{proposal.unresolvedIssues.length?proposal.unresolvedIssues.length+" unresolved":"Ready"}</Badge></div><div className="mt-4 space-y-2">{proposal.operations.map((operation,index)=><div key={operation.kind+"-"+index} className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm"><ArrowRight className="size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="font-medium">{proposalSummary(operation)}</p>{operation.values&&Object.keys(operation.values).length>0&&<dl className="mt-3 space-y-2">{Object.entries(operation.values).map(([fieldId,value])=><div key={fieldId} className="text-xs"><dt className="text-muted-foreground">{detail.schema.find(field=>field.id===fieldId)?.label||proposal.operations.find(change=>change.kind==='set_schema_field'&&change.field?.id===fieldId)?.field?.label||fieldId.replaceAll('_',' ')}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm">{displayValue(value)}</dd></div>)}</dl>}</div></div>)}</div>{proposal.unresolvedIssues.length>0&&<ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{proposal.unresolvedIssues.map(issue=><li key={issue}>{issue}</li>)}</ul>}<div className="mt-5 flex gap-2"><Button disabled={proposal.unresolvedIssues.length>0||busy==="apply"} onClick={()=>void applyProposal()}>{busy==="apply"?<Loader2 className="size-4 animate-spin"/>:<Check className="size-4"/>}Apply changes</Button><Button variant="ghost" onClick={()=>setProposal(null)}>Review later</Button></div></section>}


        {((detail.items.length===0&&!proposal)||composerOpen||busy==='message'||busy==='source'||busy==='attachment'||attachmentFailure||(!proposal&&sourceResult))&&<section className={detail.items.length===0&&!proposal?'mx-auto w-full max-w-2xl py-10 sm:py-16':'workspace-assistant-panel p-5 sm:p-6'} data-open={detail.items.length>0?'true':undefined} aria-labelledby="add-items-heading">
          <div className="mb-5 flex items-start justify-between gap-3"><div><h2 id="add-items-heading" className="text-2xl font-semibold tracking-tight">{detail.items.length===0?'What would you like to add?':'Add to your collection'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail.items.length===0?'Paste information, add one website link, or attach a PDF or image. Youbot will organize it for you to review.':'Add more information, or describe a change to an existing item.'}</p></div>{detail.items.length>0&&composerOpen&&!busy&&<Button variant="ghost" size="icon" aria-label="Close add items" onClick={()=>{setComposerOpen(false);setSourceResult(null);setAttachmentFailure('');}}><X className="size-4"/></Button>}</div>
          <form onSubmit={event=>{if(attachmentFile){event.preventDefault();void submitAttachment();}else void submitAuthoring(event);}} className="overflow-hidden rounded-2xl border bg-card shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
            <Textarea ref={composerRef} aria-label="Items or changes" value={draft} onChange={event=>{setDraft(event.target.value);authoringAttemptRef.current=null;}} disabled={!!attachmentFile||!!busy} maxLength={100000} className="min-h-36 resize-y rounded-none border-0 bg-transparent px-5 py-4 text-base shadow-none focus-visible:ring-0" placeholder={attachmentFile?`Your ${attachmentLabel(attachmentFile).toLowerCase()} is ready to organize.`:detail.items.length===0?'Paste item details or one website URL…':'Add information, one website URL, or describe a change…'}/>
            {attachmentFile&&<div className="mx-4 mb-3 flex items-center gap-3 rounded-xl bg-muted/50 p-3"><FileText className="size-5 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{attachmentFile.name}</p><p className="mt-1 text-xs text-muted-foreground">{sizeLabel(attachmentFile.size)}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Remove attachment" disabled={!!busy} onClick={()=>{setAttachmentFile(null);setSourceResult(null);setAttachmentFailure('');setAttachmentStage('idle');setAttachmentRequestId('');if(attachmentInputRef.current)attachmentInputRef.current.value='';}}><X className="size-4"/></Button></div>}
            <div className="flex items-center justify-between gap-2 px-3 pb-3"><input ref={attachmentInputRef} id="collection-attachment" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" aria-label="Choose a PDF or image" onChange={chooseAttachment} disabled={!!busy} className="hidden"/><Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={()=>attachmentInputRef.current?.click()}><Paperclip className="size-4"/>Attach file</Button><Button type="submit" size="sm" disabled={(!attachmentFile&&!draft.trim())||!!busy}>{busy==='message'||busy==='source'||busy==='attachment'?<Loader2 className="size-4 animate-spin"/>:<ArrowRight className="size-4"/>}{attachmentStage==='failed'&&attachmentFile?'Try again':'Organize'}</Button></div>
          </form>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{attachmentFile?`Remove the ${attachmentLabel(attachmentFile).toLowerCase()} to add written information separately. Your text is kept.`:wholeHttpUrl(draft)?'Website link detected. Youbot will read it as one source.':'PDFs up to 10 MB; PNG, JPEG, or WebP images up to 6 MB. New information stays private until you publish.'}</p>
            {!attachmentFile&&!wholeHttpUrl(draft)&&<details className="mt-4 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Add a source name</summary><Input aria-label="Source label" value={sourceLabel} onChange={event=>{setSourceLabel(event.target.value);authoringAttemptRef.current=null;}} maxLength={300} className="mt-2 max-w-sm" placeholder="For example, September catalogue"/></details>}
              {busy==="attachment"&&<div className="mt-3" role="status" aria-live="polite"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{width:String(Math.max(4,attachmentProgress))+"%"}}/></div><p className="mt-2 text-xs text-muted-foreground">{attachmentStage==="reading"?"Reading the file…":attachmentStage==="uploading"?"Uploading privately…":"Organizing the extracted information…"}</p></div>}
              {attachmentFailure&&<p role="alert" className="mt-3 text-xs leading-5 text-destructive">{attachmentFailure}</p>}
              {sourceResult&&<div role="status" className="mt-3 rounded-lg bg-primary/5 p-3 text-xs"><p className="font-medium">{sourceResult.job.status==='needs-review'?'Ready to review':'Source saved · organization pending'}</p><p className="mt-1 leading-5 text-muted-foreground">{'coverage' in sourceResult?`${sourceResult.coverage.extractedPages} of ${sourceResult.coverage.totalPages} pages extracted · ${sourceResult.organization.updatedCount} proposed changes`:`${sourceResult.source.kind==='url'?'Website':'Image'} saved · ${sourceResult.acceptedCount} source entr${sourceResult.acceptedCount===1?'y':'ies'} accepted`}</p><div className="mt-2 flex flex-wrap gap-2">{sourceResult.job.sourceRevisionId&&<Button variant="outline" size="sm" onClick={event=>void inspectSource(sourceResult.job.sourceRevisionId!,undefined,event.currentTarget)}>Review source</Button>}{sourceResult.job.recoverable&&sourceResult.job.status!=="needs-review"&&sourceResult.job.status!=="organizing"&&<Button size="sm" onClick={()=>void retryAuthoringJob(sourceResult.job)} disabled={!!busy}>Retry organization</Button>}</div></div>}
            {localMessages.length>0&&<details className="mt-5 rounded-xl bg-muted/30 p-4"><summary className="cursor-pointer text-sm font-medium">Recent additions ({localMessages.length})</summary><div className="mt-3 space-y-2">{localMessages.slice(-4).map(message=><div key={message.id} className="rounded-lg bg-background p-3 text-sm"><p className="leading-6">{message.state==='error'&&message.speaker==='concierge'?'Your information was saved, but organizing it did not finish.':message.content}</p><p className="mt-1 text-xs text-muted-foreground">{message.state==="error"?(message.speaker==='owner'?"Not saved":"Organization failed"):message.state==="sending"?"Sending…":timeLabel(message.createdAt)}</p></div>)}</div></details>}
        </section>}

        {detail.items.length>0&&<>
          {renderItemGrid()}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="text-xs text-muted-foreground">{selectedItems.length} selected · Only published items are shared with visitors.</p><Button onClick={()=>void publishSelected()} disabled={!!proposal||selectedItems.length===0||!!busy}>{busy==='publish'?<Loader2 className="size-4 animate-spin"/>:<CheckCircle2 className="size-4"/>}Publish selected</Button></div>
        </>}

          {authoringJobs.length>0&&<details className="rounded-2xl border p-5"><summary className="cursor-pointer text-sm font-medium">Processing history ({authoringJobs.length})</summary><div className="mt-4 space-y-2">{authoringJobs.slice(0,5).map(job=>{const retrying=busy==="job:"+job.id;return <article key={job.id} className="rounded-xl bg-muted/30 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">{authoringJobKindLabel(job.kind)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{authoringJobProgress(job)}</p></div><Badge variant={job.status==="failed"||job.status==="conflict"?"destructive":job.status==="needs-review"?"secondary":"outline"}>{authoringJobStatusLabel(job.status)}</Badge></div><div className="mt-3 flex flex-wrap gap-2">{job.sourceRevisionId&&<Button type="button" variant="ghost" size="sm" onClick={event=>void inspectSource(job.sourceRevisionId!,undefined,event.currentTarget)} disabled={sourceLoading}>Review source</Button>}{job.recoverable&&job.status!=="needs-review"&&job.status!=="organizing"&&<Button type="button" size="sm" onClick={()=>void retryAuthoringJob(job)} disabled={!!busy}>{retrying?<Loader2 className="size-4 animate-spin"/>:"Retry"}</Button>}</div></article>;})}</div></details>}
        </div>}
      </>}
    </main></div>}

    <Sheet open={!!detailItem} onOpenChange={open=>{if(!open)setDetailItemId('');}}>
      {detail&&detailItem&&<SheetContent
        side="right"
        onCloseAutoFocus={event=>{
          event.preventDefault();
          const opener=detailSheetOpenerRef.current;
          detailSheetOpenerRef.current=null;
          if(opener?.isConnected)opener.focus();
        }}
        className="w-full max-w-none gap-0 overflow-y-auto sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-5 pr-12 sm:px-6">
          <SheetDescription>{preview?'Published item':'Collection item'}</SheetDescription>
          <SheetTitle className="break-words text-xl">{displayValue(detailTitleField&&detailItem.values[detailTitleField.id])}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {preview?<Badge variant="secondary">Published</Badge>:<>
              {(()=>{
                const publishedRevision=publishedRevisions.get(detailItem.id);
                const isPublished=publishedRevision===detailItem.revision;
                const hasPublishedRevision=publishedRevision!==undefined;
                const needsReview=pendingItemIds.has(detailItem.id);
                return <Badge variant={detailItem.archived?'destructive':needsReview?'outline':isPublished?'secondary':'outline'}>{detailItem.archived?'Archived':needsReview?'Needs review':isPublished?'Published':hasPublishedRevision?'Draft update':'Draft'}</Badge>;
              })()}
              {detailItem.status!=='unknown'&&<Badge variant="outline">{detailItem.status}</Badge>}
            </>}
            {isOutdated(detailItem.validThrough)&&<Badge variant="destructive">Outdated</Badge>}
          </div>
        </SheetHeader>

        <div className="flex-1 px-5 py-6 sm:px-6">
          <dl className="space-y-5">{detail.schema.map(field=><div key={field.id} className="border-b pb-5 last:border-b-0">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">{displayValue(detailItem.values[field.id],field.unit)}</dd>
          </div>)}</dl>

          <section className="mt-7 border-t pt-5" aria-labelledby="item-record-heading">
            <h3 id="item-record-heading" className="text-sm font-semibold">Record details</h3>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">Updated</dt><dd className="mt-1">{timeLabel(detailItem.updatedAt)||'Unknown'}</dd></div>
              {detailItem.validThrough&&<div><dt className="text-xs text-muted-foreground">Valid through</dt><dd className="mt-1">{detailItem.validThrough}</dd></div>}
            </dl>
          </section>

          {!preview&&<section className="mt-7 border-t pt-5" aria-labelledby="item-sources-heading">
            <div className="flex items-center justify-between gap-3"><h3 id="item-sources-heading" className="text-sm font-semibold">Sources</h3><span className="text-xs text-muted-foreground">{detailItem.evidence?.length||0}</span></div>
            {detailItem.evidence?.length?<div className="mt-3 space-y-2">{detailItem.evidence.map((evidence,index)=><Button key={evidence.sourceRevisionId+'-'+(evidence.inputId||index)} type="button" variant="outline" className="w-full justify-between" disabled={sourceLoading} onClick={event=>void inspectSource(evidence.sourceRevisionId,evidence.inputId,event.currentTarget)}><span className="truncate">{evidence.inputId||`Source ${index+1}`}</span><span className="text-xs text-muted-foreground">Review</span></Button>)}</div>:<p className="mt-2 text-sm text-muted-foreground">No source links are attached to this item.</p>}
          </section>}
        </div>

        {!preview&&<div className="sticky bottom-0 border-t bg-background p-4 sm:px-6"><Button className="w-full" onClick={event=>{startEdit(detailItem,detailSheetOpenerRef.current||event.currentTarget);setDetailItemId('');}}><Pencil className="size-4"/>Edit item</Button></div>}
      </SheetContent>}
    </Sheet>

    <Dialog
      open={sourceLoading||!!sourceReview}
      onOpenChange={open=>{if(!open&&!sourceLoading)setSourceReview(null);}}
    >
      <DialogContent
        showCloseButton={!sourceLoading}
        onCloseAutoFocus={event=>{
          event.preventDefault();
          const opener=sourceDialogOpenerRef.current;
          sourceDialogOpenerRef.current=null;
          if(opener?.isConnected)opener.focus();
        }}
        className="bottom-0 left-0 top-auto max-h-[90dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl p-5 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6"
      >
        <DialogHeader className="gap-0">
          <DialogDescription className="text-xs font-semibold uppercase tracking-[.12em]">Private owner review</DialogDescription>
          <DialogTitle className="mt-1 text-xl">{sourceReview?.file?.name||sourceReview?.source?.label||sourceReview?.label||'Source provenance'}</DialogTitle>
        </DialogHeader>{sourceLoading?<div role="status" className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading source passages…</div>:sourceReview&&<><div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline">{sourceReview.coverage?.status||'unknown'} coverage</Badge>{sourceReview.file&&<Badge variant="secondary">{sizeLabel(sourceReview.file.sizeBytes)}</Badge>}{sourceReview.coverage?.totalPages!==undefined&&<Badge variant="outline">{sourceReview.coverage.extractedPages||0} / {sourceReview.coverage.totalPages} pages extracted</Badge>}</div>{sourceReview.coverage?.unresolvedPages?.length?<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">Pages {sourceReview.coverage.unresolvedPages.join(', ')} could not be extracted. Treat this source as partial.</p>:null}{sourceReview.source?.coverageNote&&<p className="mt-3 text-xs leading-5 text-muted-foreground">{sourceReview.source.coverageNote}</p>}<div className="mt-5 space-y-3">{sourceReview.segments.length===0?<p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No page passages are available for this source.</p>:sourceReview.segments.map(segment=><article key={segment.inputId} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><p className="font-semibold">{segment.page!==undefined?`Page ${segment.page}`:'Supplied passage'}{segment.section?` · ${segment.section}`:''}</p>{segment.charCount!==undefined&&<span className="text-muted-foreground">{segment.charCount.toLocaleString()} characters</span>}</div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{segment.text}</p>{segment.truncated&&<p className="mt-2 text-xs text-amber-700 dark:text-amber-300">This passage is shortened for review.</p>}</article>)}</div>{sourceReview.nextCursor!==undefined&&sourceReview.nextCursor!==null&&<p className="mt-4 text-xs text-muted-foreground">More passages are available in this source.</p>}<p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">This inspector shows bounded text and page labels returned by Youbot. Original storage paths and private URLs are never shown here.</p></>}
      </DialogContent>
    </Dialog>

    <Dialog
      open={!!editing&&!!detail}
      onOpenChange={open=>{if(!open&&busy!=='edit')setEditing(null);}}
    >
      {detail&&<DialogContent
        showCloseButton={busy!=='edit'}
        onCloseAutoFocus={event=>{
          event.preventDefault();
          const opener=editorDialogOpenerRef.current;
          editorDialogOpenerRef.current=null;
          if(opener?.isConnected)opener.focus();
        }}
        className="bottom-0 left-0 top-auto max-h-[90dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-2xl p-5 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6"
      >
        <DialogHeader className="gap-0">
          <DialogDescription className="text-xs font-semibold">Direct correction</DialogDescription>
          <DialogTitle className="mt-1 text-xl">Edit item</DialogTitle>
        </DialogHeader><form onSubmit={saveDirectEdit} className="mt-5 space-y-4">{detail.schema.map((field,index)=><label key={field.id} className="block space-y-1.5"><span className="text-sm font-medium">{field.label}</span>{field.type==='boolean'?<select autoFocus={index===0} value={editValues[field.id]||'false'} onChange={event=>setEditValues(current=>({...current,[field.id]:event.target.value}))} className="h-11 w-full rounded-lg border bg-card px-3 text-sm"><option value="true">Yes</option><option value="false">No</option></select>:field.enumValues?.length?<select autoFocus={index===0} value={editValues[field.id]||''} onChange={event=>setEditValues(current=>({...current,[field.id]:event.target.value}))} className="h-11 w-full rounded-lg border bg-card px-3 text-sm"><option value="">Unknown</option>{field.enumValues.map(value=><option key={value} value={value}>{value}</option>)}</select>:<Input autoFocus={index===0} value={editValues[field.id]||''} onChange={event=>setEditValues(current=>({...current,[field.id]:event.target.value}))} type={field.type==='number'?'number':field.type==='date'?'date':'text'} placeholder={field.type==='money'?'AED 90000':field.multiple?'Separate values with commas':undefined}/>}</label>)}<p className="text-xs leading-5 text-muted-foreground">This creates a reviewable proposal. Published information remains unchanged until you apply and publish it.</p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={()=>setEditing(null)}>Cancel</Button><Button type="submit" disabled={busy==='edit'}>{busy==='edit'?<Loader2 className="size-4 animate-spin"/>:<ArrowRight className="size-4"/>}Review edit</Button></div></form>
      </DialogContent>}
    </Dialog>
  </div>;
}
