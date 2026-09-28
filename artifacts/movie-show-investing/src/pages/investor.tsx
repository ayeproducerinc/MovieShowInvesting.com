import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentInvestorIntentQueryKey, getGetFlowProgressQueryKey, useGetCurrentInvestorIntent, useGetExplore, useGetFlowProgress, useMatchInvestor, useSaveFlowProgress, useSaveInvestorIntent } from '@workspace/api-client-react';
import type { ExploreProject, InvestorIntentInput } from '@workspace/api-client-react';
import { InvestorProjectCard } from '@/components/investor-project-card';
import '../investor.css';

type Answers = InvestorIntentInput & { terms_read:boolean; lineup: {project_id:number; amount:number}[] };
const blank: Answers = { amount:100, name:'', email:'', city:'', state:'', zip:'', accredited:false, experience:[], motivations:[], favorite_genres:[], stages:[], minima:{distribution:null,production:null,idea:null}, allocations:[], unallocated:false, call_opt_in:false, terms_read:false, lineup:[] };
const headings = ['Your amount','The ground rules','Your interests','The lineup','About you'];
const descriptions = [
  'Start with the total you might consider. This is a conversation, not a payment.',
  'A clear picture of what expressing interest means before you choose a project.',
  'Tell us what draws you to independent stories. We will use these preferences to find possible matches.',
  'A starting point, not a recommendation. Adjust the lineup or leave your interest unallocated.',
  'A few details so we can keep the conversation going.'
];
const genres = ['Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Other'];
const stages = [['distribution','Finished film / distribution'],['production','Short or pilot / production'],['idea','Script or idea']] as const;
const dollars = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const cap = (amount:number) => amount < 150 ? 4 : 5;
function split(amount:number, selected:ExploreProject[]) {
  const each = Math.floor(amount / selected.length);
  return selected.map((project,index)=>({project_id:project.id,amount:each + (index===0 ? amount - each * selected.length : 0)}));
}
function toggle(items:string[], value:string) { return items.includes(value) ? items.filter(x=>x!==value) : [...items,value]; }
function Field({label,id,value,onChange,type='text',required=false}: {label:string;id:string;value:string;onChange:(value:string)=>void;type?:string;required?:boolean}) {
  return <div className="inv-field"><label htmlFor={id}>{label}{!required && <span className="inv-small"> · optional</span>}</label><input className="inv-input" id={id} data-testid={`input-${id}`} type={type} required={required} value={value} onChange={e=>onChange(e.target.value)}/></div>;
}
function Option({label,checked,onChange,type='checkbox',description}: {label:string;checked:boolean;onChange:()=>void;type?:'checkbox'|'radio';description?:string}) {
  return <label className="inv-option"><input type={type} checked={checked} onChange={onChange}/><span>{label}{description && <small>{description}</small>}</span></label>;
}
function ErrorState({retry}: {retry:()=>void}) {
  return <div className="page-wrap inv-state"><p className="inv-kicker">Connection interrupted</p><h1>We couldn’t open your page.</h1><p>Your answers need a reliable connection before you continue. Please try again.</p><button type="button" className="inv-button" data-testid="button-retry-investor" onClick={retry}><RotateCcw size={16}/> Try again</button></div>;
}

export function InvestorDone() {
  const current = useGetCurrentInvestorIntent();
  return <section className="inv"><div className="page-wrap">
    {current.isLoading ? <div className="inv-state" aria-label="Loading saved interest"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div> :
    current.isError ? <ErrorState retry={()=>void current.refetch()}/> :
    current.data?.intent ? <div className="inv-state" style={{maxWidth:850}}>
      <p className="inv-kicker">Interest saved / The next chapter</p><h1>Thank you, {current.data.intent.name.split(' ')[0]}.</h1>
      <p data-testid="text-intent-saved">Your non-binding interest of {dollars(current.data.intent.amount)} has been saved. No money has been collected, and you have not made an investment. A signed confirmation step is not available yet.</p>
      <p>Returns aren’t guaranteed. You may get back less, or nothing. We’ll use the details you shared to keep you informed about what happens next.</p>
      <div className="inv-actions"><Link href="/explore" className="inv-button" data-testid="link-done-explore">Explore projects <ArrowRight size={16}/></Link><Link href="/messages" className="inv-button secondary" data-testid="link-done-messages">Messages</Link></div>
    </div> : <div className="inv-state"><p className="inv-kicker">Nothing saved yet</p><h1>Your story starts here.</h1><p>There is no saved investor interest associated with this visit.</p><Link className="inv-button" href="/invest" data-testid="link-done-invest">Start the worksheet <ArrowRight size={16}/></Link></div>}
  </div></section>;
}

export default function Investor() {
  const [,navigate] = useLocation();
  const queryClient = useQueryClient();
  const progress = useGetFlowProgress('investor',{query:{queryKey:getGetFlowProgressQueryKey('investor'),retry:(count,error)=>error.status!==404 && count<2}});
  const current = useGetCurrentInvestorIntent({query:{queryKey:getGetCurrentInvestorIntentQueryKey(),retry:(count,error)=>error.status!==404 && count<2}});
  const explore = useGetExplore();
  const match = useMatchInvestor();
  const save = useSaveFlowProgress();
  const submit = useSaveInvestorIntent();
  const [a,setA] = useState<Answers>(blank);
  const [screen,setScreen] = useState(1);
  const [ready,setReady] = useState(false);
  const [matches,setMatches] = useState<ExploreProject[]>([]);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const initialised = useRef(false);
  const timer = useRef<number|null>(null);
  const lastSaved = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveFn = useRef(save.mutateAsync);
  saveFn.current = save.mutateAsync;
  useEffect(()=>{
    if (initialised.current) return;
    if (progress.data) {
      initialised.current = true;
      const restored = {...blank,...progress.data.answers, minima:{...blank.minima,...(progress.data.answers.minima as object || {})}} as Answers;
      const step = Math.max(1,Math.min(5,progress.data.last_screen));
      setA(restored); setScreen(step); lastSaved.current=JSON.stringify({screen:step,a:restored}); setReady(true);
    } else if (progress.error?.status===404) { initialised.current=true; setReady(true); }
  },[progress.data,progress.error]);
  useEffect(()=>{if (current.data?.intent) navigate('/invest/done');},[current.data?.intent,navigate]);
  useEffect(()=>{
    if (!ready) return;
    const json=JSON.stringify({screen,a});
    if (json===lastSaved.current) return;
    timer.current=window.setTimeout(()=>{
      setSaving(true);
      const operation=queue.current.catch(()=>undefined).then(()=>saveFn.current({data:{flow:'investor',last_screen:screen,answers:{...a}}}));
      queue.current=operation;
      operation.then(()=>{lastSaved.current=json;setError('');}).catch(()=>setError('We could not save your progress. Please check your connection before continuing.')).finally(()=>{if(queue.current===operation)setSaving(false);});
    },850);
    return ()=>{if(timer.current!==null)window.clearTimeout(timer.current);};
  },[a,screen,ready]);
  const change = <K extends keyof Answers>(key:K,value:Answers[K])=>{setA(prev=>({...prev,[key]:value}));setError('');};
  async function persist(step:number, value:Answers) {
    if(timer.current!==null)window.clearTimeout(timer.current);
    setSaving(true);
    const operation=queue.current.catch(()=>undefined).then(()=>saveFn.current({data:{flow:'investor',last_screen:step,answers:{...value}}}));
    queue.current=operation;
    try {await operation;lastSaved.current=JSON.stringify({screen:step,a:value});setError('');}
    catch {setError('We could not save your answers. Check your connection and try again.');throw new Error('Save failed');}
    finally {if(queue.current===operation)setSaving(false);}
  }
  const available = (explore.data?.projects || []).filter(p=>p.stage !== 'other');
  const selected = available.filter(p=>a.lineup.some(row=>row.project_id===p.id));
  const allocated = a.lineup.reduce((sum,row)=>sum+Number(row.amount||0),0);
  function validate(step:number) {
    if(step===1 && (!Number.isSafeInteger(a.amount) || a.amount<100)) return 'Enter a whole-dollar amount of at least $100.';
    if(step===2 && !a.terms_read) return 'Please acknowledge the ground rules before continuing.';
    if(step===3 && (!a.favorite_genres.length || !a.stages.length)) return 'Choose at least one genre and one project stage.';
    if(step===3 && Object.values(a.minima).some(value=>value!==null && (!Number.isSafeInteger(value) || value<125))) return 'Minimum preferences must be whole-dollar amounts of at least $125, or left blank.';
    if(step===4 && !a.unallocated) {
      if(!a.lineup.length) return 'Choose projects, or select Just pledge to leave your interest unallocated.';
      if(a.lineup.length>cap(a.amount)) return `Choose no more than ${cap(a.amount)} projects at this amount.`;
      if(a.lineup.some(x=>!available.some(p=>p.id===x.project_id))) return 'A project in your lineup is no longer available. Please update your selection.';
      if(a.lineup.some(x=>!Number.isSafeInteger(Number(x.amount)) || Number(x.amount)<25)) return 'Each project must receive at least $25.';
      if(allocated!==a.amount) return `Your allocations must add up to ${dollars(a.amount)}. Currently allocated: ${dollars(allocated)}.`;
    }
    if(step===5 && (!a.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()))) return 'Add your name and a valid email address.';
    return '';
  }
  async function next() {
    const issue=validate(screen);
    if(issue){setError(issue);return;}
    setError('');
    let updated=a;
    if(screen===3) {
      try {
        const result=await match.mutateAsync({data:{amount:a.amount,favorite_genres:a.favorite_genres,stages:a.stages,minima:a.minima}});
        const realIds=new Set(available.map(p=>p.id));
        const candidates=result.projects.filter(p=>p.stage !== 'other' && realIds.has(p.id)).slice(0,cap(a.amount));
        setMatches(candidates);
        if(!a.lineup.length && candidates.length && Math.floor(a.amount/candidates.length)>=25) updated={...a,lineup:split(a.amount,candidates)};
      } catch {setError('We could not find matches right now. Please try again.');return;}
    }
    try {await persist(screen+1,updated);setA(updated);setScreen(screen+1);window.scrollTo({top:0,behavior:'smooth'});}catch {/* error shown by persist */}
  }
  async function back() {setError('');try{await persist(screen-1,a);setScreen(screen-1);window.scrollTo({top:0,behavior:'smooth'});}catch {/* error shown by persist */}}
  async function finish() {
    const issue=validate(5) || validate(4);
    if(issue){setError(issue);return;}
    try {
      await persist(5,a);
      const {terms_read: _terms, lineup: _lineup, ...input}=a;
      void _terms; void _lineup;
      await submit.mutateAsync({data:{...input,name:a.name.trim(),email:a.email.trim(),allocations:a.unallocated?[]:a.lineup,unallocated:a.unallocated}});
      await queryClient.invalidateQueries({queryKey:getGetCurrentInvestorIntentQueryKey()});
      navigate('/invest/done');
    } catch {setError('Your interest could not be saved. Nothing has been submitted; please try again.');}
  }
  function add(project:ExploreProject) {
    if(a.lineup.some(x=>x.project_id===project.id) || a.lineup.length>=cap(a.amount)) return;
    const ids=[...a.lineup.map(x=>x.project_id),project.id];
    const projects=ids.map(id=>available.find(p=>p.id===id)).filter((x):x is ExploreProject=>Boolean(x));
    change('lineup',split(a.amount,projects));
  }
  if(progress.isLoading || current.isLoading || explore.isLoading || !ready && !progress.isError) return <section className="inv"><div className="page-wrap inv-state" aria-label="Loading investor worksheet"><p className="inv-kicker">Opening your worksheet</p><div className="inv-skeleton" style={{height:85}}/><div className="inv-skeleton" style={{height:150}}/></div></section>;
  if(progress.isError && progress.error?.status!==404 || current.isError && current.error?.status!==404 || explore.isError) return <section className="inv"><ErrorState retry={()=>{void progress.refetch();void current.refetch();void explore.refetch();}}/></section>;
  return <section className="inv"><div className="page-wrap">
    <div className="inv-top"><Link href="/explore" className="inv-kicker" data-testid="link-invest-explore">Movie Show Investing / Explore</Link><span className="inv-kicker" data-testid="text-invest-step">Step {screen} / 5</span></div>
    <div className="inv-progress" aria-label={`Step ${screen} of 5`}>{headings.map((h,i)=><span key={h} className={i<screen?'active':''} title={h}/>)}</div>
    <div className="inv-layout"><div className="inv-intro" key={screen}><p className="inv-kicker">Investor worksheet / 0{screen}</p><h1>{headings[screen-1]}<em>.</em></h1><p>{descriptions[screen-1]}</p><div className="inv-note">Your interest is non-binding. No money is collected and nothing here is an offer to sell securities.</div></div>
      <div className="inv-panel">
        {screen===1 && <><p className="inv-label">How much might you be interested in? · USD</p><div className="inv-amount"><span>$</span>{a.amount || '—'}</div><div className="inv-options">{[100,250,500,1000].map(value=><Option key={value} type="radio" checked={a.amount===value} label={dollars(value)} onChange={()=>change('amount',value)}/>)}</div><div className="inv-field"><label htmlFor="invest-amount">Or enter an amount</label><input id="invest-amount" data-testid="input-invest-amount" className="inv-input" type="number" min="100" step="1" value={a.amount || ''} onChange={e=>change('amount',Number(e.target.value))}/></div><p className="inv-small">Minimum total interest: $100. You can adjust your project choices later.</p></>}
        {screen===2 && <><p className="inv-kicker">Read before continuing</p><div className="inv-section"><h2>Interest is not an investment.</h2><p>This worksheet records what you may want to explore. Your pledge is non-binding. No money is collected, and you are not committing to fund a project.</p></div><div className="inv-section"><h2>There is real risk.</h2><p>Returns aren’t guaranteed. You may get back less, or nothing.</p><p>Projects can change, pause, or never reach an audience. Any future opportunity would require separate information and a separate decision.</p></div><div className="inv-section"><Option label="I understand this is non-binding interest, not an investment or an offer." checked={a.terms_read} onChange={()=>change('terms_read',!a.terms_read)}/></div></>}
        {screen===3 && <><p className="inv-label">Genres you return to · choose any</p><div className="inv-grid">{genres.map(g=><Option key={g} label={g} checked={a.favorite_genres.includes(g)} onChange={()=>change('favorite_genres',toggle(a.favorite_genres,g))}/>)}</div><div className="inv-section"><p className="inv-label">Where in the process?</p><div className="inv-options">{stages.map(([value,label])=><Option key={value} label={label} checked={a.stages.includes(value)} onChange={()=>change('stages',toggle(a.stages,value))}/>)}</div><p className="inv-small">Other-stage projects may be browsed in Explore but are not included in automatic matches.</p></div><div className="inv-section"><h2>Your minimum preferences</h2><p>Optional minimum illustrative payback target per $100, by stage. Leave blank for no preference. These are preference filters, not promises of a return.</p><div className="inv-grid">{stages.map(([value,label])=><div className="inv-field" key={value}><label htmlFor={`minimum-${value}`}>{label}</label><input id={`minimum-${value}`} className="inv-input" data-testid={`input-minimum-${value}`} type="number" min="125" step="1" placeholder="No minimum" value={a.minima[value]??''} onChange={e=>change('minima',{...a.minima,[value]:e.target.value===''?null:Number(e.target.value)})}/></div>)}</div></div></>}
        {screen===4 && <><p className="inv-kicker">Your possible lineup</p><h2 className="serif" style={{fontSize:'clamp(38px,4vw,58px)',lineHeight:1,margin:'15px 0'}}>Choose where your interest goes.</h2><p className="inv-small">Up to {cap(a.amount)} projects. Each allocation must be at least $25. Your total is {dollars(a.amount)}.</p>
          <div className="inv-options"><Option type="radio" checked={!a.unallocated} label="Choose projects" description="Adjust amounts across a lineup of approved projects." onChange={()=>change('unallocated',false)}/><Option type="radio" checked={a.unallocated} label="Just pledge" description="Save your interest without selecting projects yet." onChange={()=>change('unallocated',true)}/></div>
          {!a.unallocated && <><div className="inv-lineup">{a.lineup.map(row=>{const project=available.find(p=>p.id===row.project_id);return <div className="inv-lineup-row" key={row.project_id}><div><strong>{project?.title || 'Project no longer available'}</strong><small>{project?.stage || 'Please remove this project'}</small></div><input className="inv-input" type="number" min="25" step="1" aria-label={`Allocation for ${project?.title || 'project'}`} data-testid={`input-allocation-${row.project_id}`} value={row.amount || ''} onChange={e=>change('lineup',a.lineup.map(x=>x.project_id===row.project_id?{...x,amount:Number(e.target.value)}:x))}/><button type="button" data-testid={`button-remove-${row.project_id}`} onClick={()=>{const kept=a.lineup.filter(x=>x.project_id!==row.project_id);change('lineup',kept.length?split(a.amount,kept.map(x=>available.find(p=>p.id===x.project_id)).filter((x):x is ExploreProject=>Boolean(x))):[]);}}>Remove</button></div>;})}</div>
            {a.lineup.length>0 && <div className="inv-actions" style={{marginTop:0}}><button type="button" className="inv-button secondary" data-testid="button-even-split" onClick={()=>change('lineup',split(a.amount,selected))}>Split evenly</button><span className="inv-small" data-testid="text-allocation-total">Allocated {dollars(allocated)} of {dollars(a.amount)}</span></div>}
            <div className="inv-section"><h2>More to consider</h2><p>Only approved, available projects appear here. Browse a dossier before adding one.</p><div className="inv-projects" style={{paddingBottom:0}}>
              {(matches.length ? matches : available).filter(p=>!a.lineup.some(x=>x.project_id===p.id)).map(project=><InvestorProjectCard key={project.id} project={project} action={{label:'Add to lineup',onClick:()=>add(project),disabled:a.lineup.length>=cap(a.amount)}}/>)}
            </div>{!available.length && <p>No approved projects are available right now. You can still save unallocated interest with Just pledge.</p>}
            {matches.length>0 && available.some(p=>!matches.some(m=>m.id===p.id) && !a.lineup.some(x=>x.project_id===p.id)) && <button type="button" className="inv-button secondary" data-testid="button-show-all-projects" onClick={()=>setMatches([])}>Show all available projects</button>}</div>
          </>}
        </>}
        {screen===5 && <><div className="inv-grid"><Field id="invest-name" label="Your name" value={a.name} onChange={v=>change('name',v)} required/><Field id="invest-email" label="Email address" value={a.email} onChange={v=>change('email',v)} type="email" required/><Field id="invest-city" label="City" value={a.city||''} onChange={v=>change('city',v)}/><Field id="invest-state" label="State or region" value={a.state||''} onChange={v=>change('state',v)}/><Field id="invest-zip" label="Postal code" value={a.zip||''} onChange={v=>change('zip',v)}/></div>
          <div className="inv-section"><h2>Investor background</h2><p className="inv-label">Are you an accredited investor?</p><div className="inv-options"><Option label="Yes" type="radio" checked={a.accredited} onChange={()=>change('accredited',true)}/><Option label="No or not sure" type="radio" checked={!a.accredited} onChange={()=>change('accredited',false)}/></div></div>
          <div className="inv-section"><p className="inv-label">What experience do you bring? · choose any</p><div className="inv-options">{['New to investing','Invested in creative projects','Invested in private companies','Work in film or media'].map(value=><Option key={value} label={value} checked={a.experience.includes(value)} onChange={()=>change('experience',toggle(a.experience,value))}/>)}</div></div>
          <div className="inv-section"><p className="inv-label">What brings you here? · choose any</p><div className="inv-options">{['Support independent filmmakers','Discover stories early','Connect with creators','Learn about future opportunities'].map(value=><Option key={value} label={value} checked={a.motivations.includes(value)} onChange={()=>change('motivations',toggle(a.motivations,value))}/>)}</div></div>
          <div className="inv-section"><Option label="I’m open to a conversation about my interests." checked={a.call_opt_in} onChange={()=>change('call_opt_in',!a.call_opt_in)}/></div>
          <p className="inv-small">Saving records non-binding interest only. No payment or signed confirmation takes place.</p>
        </>}
        {error && <p className="inv-error" role="alert" data-testid="error-investor">{error}</p>}
        <div className="inv-foot"><div>{screen>1 && <button type="button" className="inv-button secondary" data-testid="button-invest-back" disabled={saving || match.isPending || submit.isPending} onClick={()=>void back()}><ArrowLeft size={16}/> Back</button>}</div><button type="button" className="inv-button" data-testid={screen===5?'button-save-interest':'button-invest-next'} disabled={saving || match.isPending || submit.isPending} onClick={()=>void (screen===5?finish():next())}>{submit.isPending?'Saving interest…':match.isPending?'Finding projects…':saving?'Saving…':screen===5?'Save non-binding interest':'Continue'} <ArrowRight size={16}/></button></div>
      </div>
    </div>
  </div></section>;
}