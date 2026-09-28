import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentInvestorIntentQueryKey, getGetFlowProgressQueryKey, useGetCurrentInvestorIntent, useGetExplore, useGetFlowProgress, useMatchInvestor, useSaveFlowProgress, useSaveInvestorIntent } from '@workspace/api-client-react';
import type { ExploreProject, InvestorIntentInput } from '@workspace/api-client-react';
import { InvestorProjectCard } from '@/components/investor-project-card';
import { LocationPicker } from '@/components/location-picker';
import { cap, selectAutoBuildProjects, split } from '@/lib/investor-lineup';
import { useAuth } from '@workspace/replit-auth-web';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import '../investor.css';
import '../lineup.css';

type Answers = InvestorIntentInput & { terms_read:boolean; location_manual:boolean; lineup: {project_id:number; amount:number}[] };
const blank: Answers = { amount:100, name:'', email:'', phone:'', city:'', state:'', country:'', zip:'', location_manual:false, accredited:false, experience:[], motivations:[], favorite_genres:[], stages:[], minima:{distribution:null,production:null,idea:null}, allocations:[], unallocated:false, call_opt_in:false, terms_read:false, lineup:[] };
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
type MinimumStage = typeof stages[number][0];
const fixedMinimumOptions = [[125,'$125'],[150,'$150'],[175,'$175'],[200,'$200'],[250,'$250+']] as const;
const dollars = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
function spreadRating(amount:number, lineup:Answers['lineup']) {
  if (!lineup.length || amount <= 0) return null;
  const largestShare = Math.max(...lineup.map(row=>Number(row.amount)||0)) / amount;
  if (lineup.length === 1 || largestShare > 0.6) return 'Narrow';
  if (lineup.length >= 4 && largestShare <= 0.35) return 'Wide';
  return 'Moderate';
}
function toggle(items:string[], value:string) { return items.includes(value) ? items.filter(x=>x!==value) : [...items,value]; }
function Field({label,id,value,onChange,type='text',required=false,autoComplete}: {label:string;id:string;value:string;onChange:(value:string)=>void;type?:string;required?:boolean;autoComplete?:string}) {
  return <div className="inv-field"><label htmlFor={id}>{label}{!required && <span className="inv-small"> · optional</span>}</label><input className="inv-input" id={id} data-testid={`input-${id}`} type={type} required={required} autoComplete={autoComplete} value={value} onChange={e=>onChange(e.target.value)}/></div>;
}
function Option({label,checked,onChange,type='checkbox',description}: {label:string;checked:boolean;onChange:()=>void;type?:'checkbox'|'radio';description?:string}) {
  return <label className="inv-option"><input type={type} checked={checked} onChange={onChange}/><span>{label}{description && <small>{description}</small>}</span></label>;
}
function ErrorState({retry}: {retry:()=>void}) {
  return <div className="page-wrap inv-state"><p className="inv-kicker">Connection interrupted</p><h1>We couldn’t open your page.</h1><p>Your answers need a reliable connection before you continue. Please try again.</p><button type="button" className="inv-button" data-testid="button-retry-investor" onClick={retry}><RotateCcw size={16}/> Try again</button></div>;
}

function GuestDraftConflictState() {
  return <div className="page-wrap inv-state" role="alert" data-testid="error-investor-guest-draft">
    <p className="inv-kicker">Another worksheet is safe</p>
    <h1>Your guest draft is still here.</h1>
    <p>An unfinished guest worksheet in this browser has been kept unchanged. Sign out of your account to resume that draft here. Your account worksheet has not been changed.</p>
  </div>;
}

export function InvestorDone() {
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const queryClient = useQueryClient();
  const signedIn = Boolean(replitAuth.user || firebaseUser);
  const ready = !replitAuth.isLoading && firebaseReady;
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  const current = useGetCurrentInvestorIntent({ query: { queryKey: [...getGetCurrentInvestorIntentQueryKey(), identityId], enabled: ready, refetchOnMount: 'always' } });
  if (!ready) return <section className="inv"><div className="page-wrap inv-state" role="status" aria-label="Checking sign-in"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div></section>;
  return <section className="inv"><div className="page-wrap">
    {current.isPending || current.isFetching ? <div className="inv-state" role="status" aria-label="Loading saved interest"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div> :
    current.isError ? <ErrorState retry={()=>void current.refetch()}/> :
    current.data?.intent ? <div className="inv-state" style={{maxWidth:850}}>
      <p className="inv-kicker">{current.data.intent.status === 'confirmed' ? 'Interest confirmed / Private record' : 'Interest saved / The next chapter'}</p><h1>{current.data.intent.status === 'confirmed' ? 'Your interest is confirmed.' : `Thank you, ${current.data.intent.name.split(' ')[0]}.`}</h1>
      <p data-testid="text-intent-saved">Your non-binding interest of {dollars(current.data.intent.amount)} is {current.data.intent.status === 'confirmed' ? 'confirmed' : 'saved, but not confirmed'}. Returns aren’t guaranteed. You may get back less, or nothing.</p>
      <p>No money has been collected, and you have not made an investment.</p>
      {current.data.intent.status === 'confirmed' && <div className="lineup-done-allocations" data-testid="done-confirmed-allocations"><p className="inv-kicker">Confirmed project choices</p>{current.data.intent.unallocated ? <p>{dollars(current.data.intent.amount)} is unallocated to projects.</p> : current.data.intent.allocations.length ? <ul>{current.data.intent.allocations.map(row => <li key={row.project_id} data-testid={`done-allocation-${row.project_id}`}><span>{row.project_title ?? `Project #${row.project_id}`}</span><strong>{dollars(row.amount)}</strong></li>)}</ul> : <p>No project allocations are on record.</p>}</div>}
      <p>Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.</p>
      <div className="inv-actions">{current.data.intent.status === 'saved' && (signedIn ? <Link href="/lineup/confirm" className="inv-button" data-testid="link-done-confirm">Review & confirm <ArrowRight size={16}/></Link> : <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-done-sign-in" label="Sign in to confirm" />)}<Link href="/lineup" className={`inv-button ${current.data.intent.status === 'saved' ? 'secondary' : ''}`} data-testid="link-done-lineup">View my {current.data.intent.status === 'confirmed' ? 'confirmed' : 'saved'} lineup <ArrowRight size={16}/></Link><Link href="/explore" className="inv-button secondary" data-testid="link-done-explore">Explore projects</Link></div>
      {!signedIn && current.data.intent.status === 'saved' && <p className="inv-small">If this is guest interest, sign in and explicitly claim it from this original browser on your lineup if it is not linked to your account.</p>}
    </div> : <div className="inv-state"><p className="inv-kicker">Nothing linked yet</p><h1>Your story starts here.</h1><p>There is no saved investor interest associated with this {signedIn ? 'account' : 'visit'}. {signedIn ? 'If you saved as a guest in this browser, choose to claim it from your lineup.' : ''}</p><div className="inv-actions">{signedIn && <Link className="inv-button" href="/lineup" data-testid="link-done-claim">Check for guest interest <ArrowRight size={16}/></Link>}<Link className="inv-button secondary" href="/invest" data-testid="link-done-invest">Start the worksheet <ArrowRight size={16}/></Link></div></div>}
  </div></section>;
}

export default function Investor() {
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  return <InvestorWorksheet key={identityId} identityId={identityId} authLoading={replitAuth.isLoading} />;
}

function InvestorWorksheet({ identityId, authLoading }: { identityId: string; authLoading: boolean }) {
  const [,navigate] = useLocation();
  const queryClient = useQueryClient();
  const progress = useGetFlowProgress('investor',{query:{queryKey:[...getGetFlowProgressQueryKey('investor'),identityId],enabled:!authLoading,retry:(count,error)=>error.status!==404 && count<2}});
  const current = useGetCurrentInvestorIntent({query:{queryKey:[...getGetCurrentInvestorIntentQueryKey(),identityId],enabled:!authLoading,retry:(count,error)=>error.status!==404 && count<2}});
  const explore = useGetExplore();
  const match = useMatchInvestor();
  const save = useSaveFlowProgress();
  const submit = useSaveInvestorIntent();
  const [a,setA] = useState<Answers>(blank);
  const [screen,setScreen] = useState(1);
  const [ready,setReady] = useState(false);
  const [matches,setMatches] = useState<ExploreProject[]>([]);
  const [matchState,setMatchState] = useState<'idle'|'loading'|'matches'|'no-matches'|'unavailable'>('idle');
  const [showAllAvailable,setShowAllAvailable] = useState(false);
  const [otherMinimumSelected,setOtherMinimumSelected] = useState<Partial<Record<MinimumStage,boolean>>>({});
  const [customMinimumDrafts,setCustomMinimumDrafts] = useState<Partial<Record<MinimumStage,string>>>({});
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const initialised = useRef(false);
  const restoredMatchStarted = useRef(false);
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
      if (!('location_manual' in progress.data.answers) && restored.city && !restored.country) restored.location_manual = true;
      const step = Math.max(1,Math.min(5,progress.data.last_screen));
      setA(restored); setScreen(step); lastSaved.current=JSON.stringify({screen:step,a:restored}); setReady(true);
    } else if (progress.error?.status===404) { initialised.current=true; setReady(true); }
  },[progress.data,progress.error]);
  useEffect(()=>{
    if (!ready || screen!==4 || !explore.isSuccess || matchState!=='idle' || restoredMatchStarted.current) return;
    restoredMatchStarted.current=true;
    void findCandidates(a,false).catch(()=>setError('We could not restore your project matches. Browse available projects manually, or retry matching.'));
  },[ready,screen,explore.isSuccess,matchState]);
  useEffect(()=>{if (current.data?.intent && !progress.isLoading && progress.error?.status!==409) navigate('/invest/done');},[current.data?.intent,progress.isLoading,progress.error,navigate]);
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
  function minimumChoice(stage:MinimumStage) {
    if(otherMinimumSelected[stage]) return 'other';
    const value=a.minima[stage];
    if(value===null) return 'not-interested';
    return fixedMinimumOptions.some(([amount])=>amount===value) ? String(value) : 'other';
  }
  function customMinimumValue(stage:MinimumStage) {
    const value=a.minima[stage];
    return customMinimumDrafts[stage] ?? (value!==null && !fixedMinimumOptions.some(([amount])=>amount===value) ? String(value) : '');
  }
  function isValidCustomMinimum(value:string) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>=125;
  }
  function chooseMinimum(stage:MinimumStage,choice:string) {
    if(choice==='other') {
      setOtherMinimumSelected(prev=>({...prev,[stage]:true}));
      setCustomMinimumDrafts(prev=>({...prev,[stage]:customMinimumValue(stage)}));
      setError('');
      return;
    }
    setOtherMinimumSelected(prev=>({...prev,[stage]:false}));
    setCustomMinimumDrafts(prev=>({...prev,[stage]:''}));
    change('minima',{...a.minima,[stage]:choice==='not-interested'?null:Number(choice)});
  }
  function updateCustomMinimum(stage:MinimumStage,value:string) {
    setCustomMinimumDrafts(prev=>({...prev,[stage]:value}));
    if(isValidCustomMinimum(value)) change('minima',{...a.minima,[stage]:Number(value)});
    else setError('');
  }
  async function persist(step:number, value:Answers) {
    if(timer.current!==null)window.clearTimeout(timer.current);
    setSaving(true);
    const operation=queue.current.catch(()=>undefined).then(()=>saveFn.current({data:{flow:'investor',last_screen:step,answers:{...value}}}));
    queue.current=operation;
    try {await operation;lastSaved.current=JSON.stringify({screen:step,a:value});setError('');}
    catch {setError('We could not save your answers. Check your connection and try again.');throw new Error('Save failed');}
    finally {if(queue.current===operation)setSaving(false);}
  }
  const available = explore.data?.projects || [];
  const selected = available.filter(p=>a.lineup.some(row=>row.project_id===p.id));
  const allocated = a.lineup.reduce((sum,row)=>sum+Number(row.amount||0),0);
  const rating = !a.unallocated ? spreadRating(a.amount,a.lineup) : null;
  async function findCandidates(value:Answers, autoBuild:boolean):Promise<Answers> {
    setError('');
    setMatches([]);
    setMatchState('loading');
    setShowAllAvailable(false);
    try {
      const result=await match.mutateAsync({data:{amount:value.amount,favorite_genres:value.favorite_genres,stages:value.stages,minima:value.minima}});
      const realIds=new Set(available.map(p=>p.id));
      const candidates=result.projects.filter(p=>realIds.has(p.id));
      setMatches(candidates);
      setMatchState(candidates.length?'matches':'no-matches');
      const selectedCandidates=selectAutoBuildProjects(candidates,value.amount);
      if(autoBuild && !value.unallocated && !value.lineup.length && selectedCandidates.length && Math.floor(value.amount/selectedCandidates.length)>=25) {
        return {...value,lineup:split(value.amount,selectedCandidates)};
      }
      return value;
    } catch {
      setMatches([]);
      setMatchState('unavailable');
      throw new Error('Matching failed');
    }
  }
  function validate(step:number) {
    if(step===1 && (!Number.isSafeInteger(a.amount) || a.amount<100)) return 'Enter a whole-dollar amount of at least $100.';
    if(step===2 && !a.terms_read) return 'Please acknowledge the ground rules before continuing.';
    if(step===3 && (!a.favorite_genres.length || !a.stages.length)) return 'Choose at least one genre and one project stage.';
    if(step===3 && stages.some(([stage])=>otherMinimumSelected[stage] && !isValidCustomMinimum(customMinimumValue(stage)))) return 'Enter a whole-dollar custom minimum of at least $125 for each stage where Other is selected.';
    if(step===3 && Object.values(a.minima).some(value=>value!==null && (!Number.isSafeInteger(value) || value<125))) return 'Minimum preferences must be whole-dollar amounts of at least $125.';
    if(step===4 && !a.unallocated) {
      if(!a.lineup.length) return 'Choose projects, or select Just pledge to leave your interest unallocated.';
      if(a.lineup.length>cap(a.amount)) return a.amount<150 ? 'Pledges under $150 can include up to 4 projects.' : 'Pledges of $150 or more can include up to 5 projects.';
      if(a.lineup.some(x=>!available.some(p=>p.id===x.project_id))) return 'A project in your lineup is no longer available. Please update your selection.';
      if(a.lineup.some(x=>!Number.isSafeInteger(Number(x.amount)) || Number(x.amount)<25)) return 'Each project needs at least $25.';
      if(allocated!==a.amount) return `Your allocations must add up to ${dollars(a.amount)}. Currently allocated: ${dollars(allocated)}.`;
    }
    if(step===5 && (!a.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || !a.city.trim() || !/^[A-Z]{2}$/.test(a.country))) return 'Add your name, a valid email, city and country. Choose a city from the suggestions or enter your location manually.';
    return '';
  }
  async function next() {
    const issue=validate(screen);
    if(issue){setError(issue);return;}
    setError('');
    let updated=a;
    if(screen===3) {
      try {
        updated=await findCandidates(a,true);
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
      const {terms_read: _terms, lineup: _lineup, location_manual: _manual, ...input}=a;
      void _terms; void _lineup; void _manual;
      await submit.mutateAsync({data:{...input,name:a.name.trim(),email:a.email.trim(),phone:a.phone?.trim() || undefined,city:a.city.trim(),state:a.state?.trim() || undefined,zip:a.zip?.trim() || undefined,allocations:a.unallocated?[]:a.lineup,unallocated:a.unallocated}});
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
  if(progress.isError && progress.error?.status===409) return <section className="inv"><GuestDraftConflictState/></section>;
  if(authLoading || progress.isLoading || current.isLoading || explore.isLoading || !ready && !progress.isError) return <section className="inv"><div className="page-wrap inv-state" aria-label="Loading investor worksheet"><p className="inv-kicker">Opening your worksheet</p><div className="inv-skeleton" style={{height:85}}/><div className="inv-skeleton" style={{height:150}}/></div></section>;
  if(progress.isError && progress.error?.status!==404 || current.isError && current.error?.status!==404 || explore.isError) return <section className="inv"><ErrorState retry={()=>{void progress.refetch();void current.refetch();void explore.refetch();}}/></section>;
  return <section className="inv"><div className="page-wrap">
    <div className="inv-top"><Link href="/explore" className="inv-kicker" data-testid="link-invest-explore">Movie Show Investing / Explore</Link><span className="inv-kicker" data-testid="text-invest-step">Step {screen} / 5</span></div>
    <div className="inv-progress" aria-label={`Step ${screen} of 5`}>{headings.map((h,i)=><span key={h} className={i<screen?'active':''} title={h}/>)}</div>
    <div className="inv-layout"><div className="inv-intro" key={screen}><p className="inv-kicker">Investor worksheet / 0{screen}</p><h1>{headings[screen-1]}<em>.</em></h1><p>{descriptions[screen-1]}</p><div className="inv-note">Your interest is non-binding. No money is collected and nothing here is an offer to sell securities.</div></div>
      <div className="inv-panel">
        {screen===1 && <><p className="inv-label">How much might you be interested in? · USD</p><div className="inv-amount"><span>$</span>{a.amount || '—'}</div><div className="inv-options">{[100,250,500,1000].map(value=><Option key={value} type="radio" checked={a.amount===value} label={dollars(value)} onChange={()=>change('amount',value)}/>)}</div><div className="inv-field"><label htmlFor="invest-amount">Or enter an amount</label><input id="invest-amount" data-testid="input-invest-amount" className="inv-input" type="number" min="100" step="1" value={a.amount || ''} onChange={e=>change('amount',Number(e.target.value))}/></div><p className="inv-small">Minimum total interest: $100. You can adjust your project choices later.</p></>}
        {screen===2 && <><p className="inv-kicker">Read before continuing</p><div className="inv-section"><h2>Interest is not an investment.</h2><p>This worksheet records what you may want to explore. Your pledge is non-binding. No money is collected, and you are not committing to fund a project.</p></div><div className="inv-section"><h2>There is real risk.</h2><p>Returns aren’t guaranteed. You may get back less, or nothing.</p><p>Projects can change, pause, or never reach an audience. Any future opportunity would require separate information and a separate decision.</p></div><div className="inv-section"><Option label="I understand this is non-binding interest, not an investment or an offer." checked={a.terms_read} onChange={()=>change('terms_read',!a.terms_read)}/></div></>}
          {screen===3 && <><p className="inv-label">Genres you return to · choose any</p><div className="inv-grid">{genres.map(g=><Option key={g} label={g} checked={a.favorite_genres.includes(g)} onChange={()=>change('favorite_genres',toggle(a.favorite_genres,g))}/>)}</div><div className="inv-section"><p className="inv-label">Where in the process?</p><div className="inv-options">{stages.map(([value,label])=><Option key={value} label={label} checked={a.stages.includes(value)} onChange={()=>change('stages',toggle(a.stages,value))}/>)}</div></div><div className="inv-section"><h2>Your minimum preferences</h2><p>Choose one minimum per slate. These are illustrative payback preferences per $100, not promises of a return. Not interested means you do not want matches for that slate.</p><div className="inv-grid">{stages.map(([stage,label])=><fieldset className="inv-minimum-stage" key={stage}><legend>{label}</legend><div className="inv-options">{[...fixedMinimumOptions.map(([amount,text])=>({value:String(amount),label:text})),{value:'other',label:'Other (custom)'},{value:'not-interested',label:'Not interested'}].map(option=><label className="inv-option" key={option.value}><input type="radio" name={`minimum-${stage}`} data-testid={`input-minimum-${stage}-${option.value}`} checked={minimumChoice(stage)===option.value} onChange={()=>chooseMinimum(stage,option.value)}/><span>{option.label}</span></label>)}</div>{minimumChoice(stage)==='other' && <div className="inv-field"><label htmlFor={`minimum-${stage}-custom`}>Custom minimum for {label} · whole dollars, at least $125</label><input id={`minimum-${stage}-custom`} className="inv-input" data-testid={`input-minimum-${stage}-custom`} type="number" min="125" step="1" placeholder="Enter a whole-dollar minimum" value={customMinimumValue(stage)} onChange={e=>updateCustomMinimum(stage,e.target.value)}/></div>}</fieldset>)}</div></div></>}
         {screen===4 && <><p className="inv-kicker">Your possible lineup</p><h2 className="serif" style={{fontSize:'clamp(38px,4vw,58px)',lineHeight:1,margin:'15px 0'}}>Choose where your interest goes.</h2><p className="inv-small">Up to {cap(a.amount)} projects. Each allocation must be at least $25. Your total is {dollars(a.amount)}.</p><p className="inv-small">When matches are available and you have not chosen projects, we start with an even split across up to {cap(a.amount)} matches. You can edit each amount, split evenly again, or manually choose other available projects.</p>
          <div className="inv-options"><Option type="radio" checked={!a.unallocated} label="Choose projects" description="Adjust amounts across a lineup of approved projects." onChange={()=>change('unallocated',false)}/><Option type="radio" checked={a.unallocated} label="Just pledge" description="Save your interest without selecting projects yet." onChange={()=>change('unallocated',true)}/></div>
           <div className="inv-spread" data-testid="text-allocation-spread">{a.unallocated ? <><strong>Allocation spread: None</strong><span>Your interest is unallocated.</span></> : rating ? <><strong>Allocation spread: {rating}</strong><span>Based on the number of projects and largest allocation share. This describes allocation only—not safety, performance, or expected return.</span></> : <><strong>Allocation spread: None</strong><span>No project allocations are currently selected.</span></>}</div>
            {!a.unallocated && <><div className="inv-lineup">{a.lineup.map(row=>{const project=available.find(p=>p.id===row.project_id);const stageLabel=project ? String(project.stage)==='other' ? 'Other stage (legacy)' : project.stage || 'Stage not listed' : 'Please remove this project';return <div className="inv-lineup-row" key={row.project_id}><div><strong>{project?.title || 'Project no longer available'}</strong>{matchState==='matches' && matches.some(m=>m.id===row.project_id) && <span className="inv-match-badge" data-testid={`badge-match-selected-${row.project_id}`}>Matches your preferences</span>}<small>{stageLabel}</small></div><input className="inv-input" type="number" min="25" step="1" aria-label={`Allocation for ${project?.title || 'project'}`} data-testid={`input-allocation-${row.project_id}`} value={row.amount || ''} onChange={e=>change('lineup',a.lineup.map(x=>x.project_id===row.project_id?{...x,amount:Number(e.target.value)}:x))}/><button type="button" data-testid={`button-remove-${row.project_id}`} onClick={()=>{const kept=a.lineup.filter(x=>x.project_id!==row.project_id);change('lineup',kept.length?split(a.amount,kept.map(x=>available.find(p=>p.id===x.project_id)).filter((x):x is ExploreProject=>Boolean(x))):[]);}}>Remove</button></div>;})}</div>
            {a.lineup.length>0 && <div className="inv-actions" style={{marginTop:0}}><button type="button" className="inv-button secondary" data-testid="button-even-split" onClick={()=>change('lineup',split(a.amount,selected))}>Split evenly</button><span className="inv-small" data-testid="text-allocation-total">Allocated {dollars(allocated)} of {dollars(a.amount)}</span></div>}
             <div className="inv-section"><h2>More to consider</h2><p>Only approved, available projects appear here. Browse a dossier before adding one.</p>
               {a.lineup.length>=cap(a.amount) && available.some(p=>!a.lineup.some(row=>row.project_id===p.id)) && <p className="inv-match-state" role="status" data-testid="text-lineup-limit">{a.amount<150 ? 'Pledges under $150 can include up to 4 projects.' : 'Pledges of $150 or more can include up to 5 projects.'} Remove a project to choose another.</p>}
               {matchState==='no-matches' && <p className="inv-match-state" role="status" data-testid="text-no-project-matches">No project was returned as a match for both your chosen genres and stages and a qualifying offer at its stage minimum. Stages with no minimum set do not produce a match. You can still browse and choose any available project manually, or choose Just pledge.</p>}
               {matchState==='unavailable' && <div className="inv-match-state" role="status"><p>Matches could not be restored. These are available projects for manual selection; none are labeled as matches.</p><button type="button" className="inv-button secondary" data-testid="button-retry-matching" onClick={()=>void findCandidates(a,false).catch(()=>setError('We could not find matches right now. Please try again.'))}>Retry matching</button></div>}
               {matchState==='loading' && <p className="inv-match-state" role="status">Checking your preferences against available projects…</p>}
               <div className="inv-projects" style={{paddingBottom:0}}>
               {(showAllAvailable || matchState!=='matches' ? available : matches).filter(p=>!a.lineup.some(x=>x.project_id===p.id)).map(project=><InvestorProjectCard key={project.id} project={project} matched={matches.some(m=>m.id===project.id)} action={{label:'Add to lineup',onClick:()=>add(project),disabled:a.lineup.length>=cap(a.amount)}}/>)}
             </div>{!available.length && <p>No approved projects are available right now. You can still save unallocated interest with Just pledge.</p>}
             {matchState==='matches' && !showAllAvailable && available.some(p=>!matches.some(m=>m.id===p.id) && !a.lineup.some(x=>x.project_id===p.id)) && <button type="button" className="inv-button secondary" data-testid="button-show-all-projects" onClick={()=>setShowAllAvailable(true)}>Show all available projects</button>}
             {matchState==='matches' && showAllAvailable && <button type="button" className="inv-button secondary" data-testid="button-show-matches-only" onClick={()=>setShowAllAvailable(false)}>Show matching projects only</button>}
             </div>
          </>}
        </>}
        {screen===5 && <><Field id="invest-name" label="Your name" value={a.name} onChange={v=>change('name',v)} autoComplete="name" required/><Field id="invest-email" label="Email address" value={a.email} onChange={v=>change('email',v)} type="email" autoComplete="email" required/><Field id="invest-phone" label="Phone number" value={a.phone||''} onChange={v=>change('phone',v)} type="tel" autoComplete="tel"/>
           <LocationPicker value={{city:a.city||'',state:a.state||'',country:a.country||'',location_manual:a.location_manual}}
             onChange={location=>{setA(current=>({...current,...location}));setError('');}}/>
           <Field id="invest-zip" label="Postal code" value={a.zip||''} onChange={v=>change('zip',v)} autoComplete="postal-code"/>
          <div className="inv-section"><h2>Investor background</h2><p className="inv-label">Are you an accredited investor?</p><div className="inv-options"><Option label="Yes" type="radio" checked={a.accredited} onChange={()=>change('accredited',true)}/><Option label="No or not sure" type="radio" checked={!a.accredited} onChange={()=>change('accredited',false)}/></div></div>
          <div className="inv-section"><p className="inv-label">What experience do you bring? · choose any</p><div className="inv-options">{['New to investing','Invested in creative projects','Invested in private companies','Work in film or media'].map(value=><Option key={value} label={value} checked={a.experience.includes(value)} onChange={()=>change('experience',toggle(a.experience,value))}/>)}</div></div>
          <div className="inv-section"><p className="inv-label">What brings you here? · choose any</p><div className="inv-options">{['Support independent filmmakers','Discover stories early','Connect with creators','Learn about future opportunities'].map(value=><Option key={value} label={value} checked={a.motivations.includes(value)} onChange={()=>change('motivations',toggle(a.motivations,value))}/>)}</div></div>
           <label className="fm-check inv-section inv-contact-opt-in"><input type="checkbox" data-testid="checkbox-invest-chat-opt-in" checked={a.call_opt_in} onChange={e=>change('call_opt_in',e.target.checked)}/><span>I’m open to a quick 15-minute chat about my interests.</span></label>
           <p className="inv-small">By saving, you’re sharing information with Movie Show Investing for its launch MVP. This records non-binding interest only; no payment or signed confirmation takes place. See our <Link href="/privacy" className="underline" data-testid="link-invest-privacy">privacy policy</Link>.</p>
        </>}
        {error && <p className="inv-error" role="alert" data-testid="error-investor">{error}</p>}
        <div className="inv-foot"><div>{screen>1 && <button type="button" className="inv-button secondary" data-testid="button-invest-back" disabled={saving || match.isPending || submit.isPending} onClick={()=>void back()}><ArrowLeft size={16}/> Back</button>}</div><button type="button" className="inv-button" data-testid={screen===5?'button-save-interest':'button-invest-next'} disabled={saving || match.isPending || submit.isPending} onClick={()=>void (screen===5?finish():next())}>{submit.isPending?'Saving interest…':match.isPending?'Finding projects…':saving?'Saving…':screen===5?'Save non-binding interest':'Continue'} <ArrowRight size={16}/></button></div>
      </div>
    </div>
  </div></section>;
}