import { cn } from '@/lib/utils';
import mark from '../../branding/mark.json';

/** Approved two-stroke Youbot mark; inherits the surrounding theme color. */
export function BrandMark({className}:{className?:string}) {
 return <svg aria-hidden="true" viewBox={mark.viewBox} fill="currentColor" className={cn('size-9 shrink-0',className)}><path d={mark.path}/></svg>;
}
