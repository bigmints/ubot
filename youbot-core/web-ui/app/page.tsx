"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, Check, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand';
import { StandardPage } from '@/components/workspace-frame';
import { useHomePageOverride } from '@/lib/extensions';
import { conciergeApi, channelName, statusName, time, type Thread } from '@/lib/concierge';
interface Dashboard { configured:boolean; counts:{visitors:number;needs:number;unread:number;handled:number}; recent:Thread[]; attention:Thread[] }
export default function HomePage() { const Override=useHomePageOverride(); return Override?<Override/>:<Home/>; }
function Home() {
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState('');
 const attentionCount=data?.counts.needs??0;
 const hasAttention=attentionCount>0;
 async function load(){try{setData(await conciergeApi<Dashboard>('/dashboard'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[]);
 const row=(thread:Thread)=><Link href={'/conversations?thread='+encodeURIComponent(thread.id)} key={thread.id} className="visitor-ledger-row"><span className="visitor-initial">{thread.name.charAt(0).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-xs font-bold">{thread.name}{thread.unread&&<span className="size-1.5 rounded-full bg-primary" aria-label="Unread"/>}<span className="font-normal text-muted-foreground">{channelName(thread.channel)}</span></span><span className="mt-1 block truncate text-xs text-muted-foreground">{thread.lastError||(thread.approvals?`${thread.approvals} decisions awaiting approval`:thread.overdue?`${thread.overdue} overdue follow-ups`:thread.preview)}</span></span><span className="hidden text-right text-[10px] text-muted-foreground sm:block">{statusName(thread)}<span className="mt-1 block">{time(thread.updatedAt)}</span></span><ArrowUpRight className="size-4 shrink-0"/></Link>;
 return <StandardPage className="signature-overview" title="Overview" description="A clear view of the people reaching out, and what comes next." actions={<Button variant="outline" asChild><Link href="/concierge"><SlidersHorizontal className="size-3.5"/>Manage concierge</Link></Button>}>
  {error&&<div role="alert" className="mb-6 flex flex-wrap items-center gap-3 border p-4"><p>{error}</p><Button variant="outline" onClick={()=>void load()}>Try again</Button></div>}
  {!data&&!error?<p role="status">Loading visitor activity…</p>:data&&<>
   <section className="visitor-summary" aria-label="Visitor activity">
    <div className="visitor-volume"><div className="flex items-start justify-between gap-3"><span className="signature-eyebrow">Visitor activity</span><span className="period-label">Last 7 days</span></div><Link href="/conversations" className="visitor-total"><strong>{data.counts.visitors.toLocaleString()}</strong><span>Visitors<ArrowUpRight className="size-5"/></span></Link><div className="activity-breakdown"><Link href="/conversations?filter=unread"><span>{data.counts.unread}</span><span>Unread conversations</span><ArrowUpRight className="size-3.5"/></Link><Link href="/conversations?filter=handled"><span>{data.counts.handled}</span><span>Resolved conversations</span><ArrowUpRight className="size-3.5"/></Link></div></div>
    <Link href={hasAttention?"/conversations?filter=needs":"/conversations"} className={`attention-feature ${hasAttention?'attention-feature--active':'attention-feature--clear'}`}><div className="flex items-center justify-between"><span className="signature-eyebrow">{hasAttention?'Requires attention':'All clear'}</span><ArrowUpRight className="size-5"/></div>{hasAttention?<strong>{attentionCount.toLocaleString()}</strong>:<span className="attention-clear-mark"><Check className="size-6" strokeWidth={1.5}/></span>}<h2>{hasAttention?'Your next decisions.':'Nothing needs attention.'}</h2><p>{hasAttention?'Review approvals, overdue follow-ups and delivery issues.':'No conversations currently need your review.'}</p><span className="attention-link">{hasAttention?'Review attention items':'Open conversations'} <ArrowRight className="size-4"/></span></Link>
   </section>
   {!data.configured&&<section className="concierge-setup-strip"><BrandMark className="size-10 shrink-0"/><div className="min-w-0 flex-1"><h2>Give your concierge an identity.</h2><p>Define who it represents, what it knows and how it responds.</p></div><Button asChild><Link href="/concierge">Create your profile<ArrowUpRight className="size-4"/></Link></Button></section>}
   <div className="overview-ledgers">
    <section className="conversation-ledger"><div className="ledger-heading"><div><span className="signature-eyebrow">The latest exchanges</span><h2>Recent conversations</h2></div><Link href="/conversations" aria-label="Open conversations" className="round-link"><ArrowUpRight className="size-5"/></Link></div>{data.recent.length?data.recent.map(row):<div className="ledger-empty"><MessageSquare className="size-6" strokeWidth={1}/><h3>Your next conversation starts here.</h3><p>Connect a messaging channel. When a visitor reaches out, the full exchange will appear in your inbox.</p><Link href="/connections">Connect a channel <ArrowUpRight className="size-4"/></Link></div>}</section>
    <section className="decision-ledger"><div className="ledger-heading"><div><span className="signature-eyebrow">For your review</span><h2>Attention items</h2></div><span className="ledger-count">{data.counts.needs}</span></div>{data.attention.length?data.attention.map(row):<div className="attention-empty"><span className="clear-check"><Check className="size-5" strokeWidth={1.5}/></span><h3>No pending decisions</h3><p>Items that need your approval or a follow-up will be collected here.</p></div>}<Link href="/conversations?filter=needs" className="ledger-footer">View all attention items<ArrowUpRight className="size-4"/></Link></section>
   </div>
  </>}
 </StandardPage>;
}
