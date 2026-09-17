import type { ReactNode } from 'react';
export function PageHeader({actions}:{eyebrow?:string;title:string;description:string;actions?:ReactNode}){
 if(!actions) return null;
 return <header className="signature-heading signature-actionbar" aria-label="Page actions"><div className="signature-actions">{actions}</div></header>;
}
export function FormSection({title,description,children}:{title:string;description?:string;children:ReactNode}){
 return <section className="signature-form-section"><div className="signature-section-title"><h2>{title}</h2>{description&&<p>{description}</p>}</div><div className="space-y-5">{children}</div></section>;
}
export function FormFeedback({error,notice}:{error?:string;notice?:string}){
 return <>{error&&<p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{error}</p>}{notice&&<p role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{notice}</p>}</>;
}
