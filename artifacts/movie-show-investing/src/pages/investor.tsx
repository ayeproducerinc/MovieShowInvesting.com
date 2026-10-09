import { useEffect, useRef, useState } from 'react';
import { InvestorNotificationPermissionControl } from '@/components/investor-notification-permission';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentInvestorIntentQueryKey, getGetExploreQueryKey, getGetPublicProjectQueryKey, getGetFlowProgressQueryKey, useConfirmInvestorIntent, useConfirmAge, useGetCurrentInvestorIntent, useGetExplore, useGetPublicProject, useGetFlowProgress, useGetPriceGroup, useMatchInvestor, useSaveFlowProgress, useSaveInvestorIntent } from '@workspace/api-client-react';
import type { ExploreProject, InvestorIntentInput } from '@workspace/api-client-react';
import { InvestorProjectCard } from '@/components/investor-project-card';
import { AgeAcknowledgment, useAgeStatus } from '@/components/age-acknowledgment';
import { ProposalSummary } from '@/components/proposal-summary';
import { InvestorResultCard } from '@/components/investor-result-card';
import { trackInvestorEvent } from '@/lib/analytics';
import { LocationPicker } from '@/components/location-picker';
import { canUseSingleProjectDraft, cap, MAX_PROJECTS, PROJECT_MINIMUM, selectAutoBuildProjects, singleProjectLineup, split } from '@/lib/investor-lineup';
import { investorReviewKey, minimaForSelectedStages } from '@/lib/investor-review';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import '../investor.css';
import '../lineup.css';

type Answers = InvestorIntentInput & { terms_read:boolean; location_manual:boolean; lineup: {project_id:number; amount:number}[]; entry_context?:string; flow_version?:number };
const blank: Answers = { flow_version:2, amount:100, name:'', email:'', phone:'', city:'', state:'', country:'', zip:'', location_manual:false, accredited:false, experience:[], motivations:[], favorite_genres:[], stages:[], minima:{distribution:null,production:null,idea:null}, allocations:[], unallocated:false, call_opt_in:false, terms_read:false, lineup:[] };
const headings = ['Amount, ground rules & age','Your interests','Repayment preferences','The lineup','Details & review'];
/** Legacy drafts: old 1,2 -> 1 (amount + ground rules); old 3 (interests+minima) -> 2; 4,5 unchanged. */
const mapStep = (ans:Record<string,unknown>, step:number) => { const n=Math.max(1,Math.min(5,Math.trunc(step)||1)); return ans.flow_version===2 ? n : n<=2 ? 1 : n===3 ? 2 : n; };
const descriptions = [
  'Start with the total you might consider, read the ground rules, and confirm your age. This is a conversation, not a payment.',
  'Tell us what draws you to independent stories. We’ll use these preferences to find possible matches, not recommendations.',
  'See the proposed repayment target for each stage you selected, then choose the minimum you would consider.',
  'A starting point, not a recommendation. Adjust the lineup or leave your interest unallocated.',
  'Review your amount and projects, add your details, then sign and submit once. Your interest is non-binding and no money is collected.'
];
/** One-project pledge from a project page: "Your pledge", then the shared review-and-sign screen. */
const singleHeadings = ['Your pledge','Review and sign'];
const singleDescriptions = [
  'Choose your amount for this one project, read the ground rules, and confirm your age. This is a conversation, not a payment.',
  'Check the project and amount, add your details, then sign and submit once. Your interest is non-binding and no money is collected.',
];
const PLEDGE_ENCOURAGEMENT = 'Every breakout film started with someone who believed in it first. Your pledge tells this filmmaker their story is worth telling, and helps show others it has an audience.';
const goalDollars = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const genres = ['Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Romance','Action','Animation','Other'];
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
  return <div className="inv-field"><label htmlFor={id}>{label}<span className="inv-small"> · {required ? 'required' : 'optional'}</span></label><input className="inv-input" id={id} data-testid={`input-${id}`} type={type} required={required} autoComplete={autoComplete} value={value} onChange={e=>onChange(e.target.value)}/></div>;
}
function Option({label,checked,onChange,type='checkbox',description}: {label:string;checked:boolean;onChange:()=>void;type?:'checkbox'|'radio';description?:string}) {
  return <label className="inv-option"><input type={type} checked={checked} onChange={onChange}/><span>{label}{description && <small>{description}</small>}</span></label>;
}
function ErrorState({retry}: {retry:()=>void}) {
  return <div className="page-wrap inv-state"><p className="inv-kicker">Connection interrupted</p><h1>We couldn’t open your page.</h1><p>Your answers need a reliable connection before you continue. Please try again.</p><button type="button" className="inv-button" data-testid="button-retry-investor" onClick={retry}><RotateCcw size={16}/> Try again</button></div>;
}

function submissionFailure(cause: unknown): {message:string; checkLineup:boolean; canStartFresh:boolean} {
  const apiError = cause && typeof cause === 'object' ? cause as {status?:unknown;data?:unknown} : null;
  const data = apiError?.data;
  const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : null;
  const code = data && typeof data === 'object' && 'code' in data ? data.code : null;
  if (apiError?.status === 409) {
    if (code === 'guest_interest_conflict') {
      return {
        message:'An older guest form uses this email, but it is not linked to this account. This attempt was not saved. You can start fresh below without changing the older form.',
        checkLineup:false,
        canStartFresh:true,
      };
    }
    return {message:`${detail ?? 'This account conflicts with existing investor interest.'} This attempt was not saved. Check My lineup before trying again.`,checkLineup:true,canStartFresh:false};
  }
  if (apiError?.status === 403) return {message:`${detail ?? 'This account cannot save this interest.'} This attempt was not saved.`,checkLineup:false,canStartFresh:false};
  if (apiError?.status === 400 && detail) return {message:`${detail} This attempt was not saved.`,checkLineup:false,canStartFresh:false};
  return {message:'We could not confirm whether your interest was saved. Check My lineup before trying again.',checkLineup:true,canStartFresh:false};
}

function GuestDraftConflictState() {
  return <div className="page-wrap inv-state" role="alert" data-testid="error-investor-guest-draft">
    <p className="inv-kicker">Another worksheet is safe</p>
    <h1>Your guest draft is still here.</h1>
    <p>An unfinished guest worksheet in this browser has been kept unchanged. Sign out of your account to resume that draft here. Your account worksheet has not been changed.</p>
  </div>;
}

export function InvestorDone() {
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const queryClient = useQueryClient();
  const signedIn = Boolean(firebaseUser);
  const ready = firebaseReady;
  const identityId = firebaseUser?.uid ?? 'visitor';
  const current = useGetCurrentInvestorIntent({ query: { queryKey: [...getGetCurrentInvestorIntentQueryKey(), identityId], enabled: ready, refetchOnMount: 'always' } });
  const latestHistoryEntry = current.data?.history.reduce<(typeof current.data.history)[number] | null>((latest, entry) =>
    !latest || Date.parse(entry.confirmed_at) > Date.parse(latest.confirmed_at) ||
      (entry.confirmed_at === latest.confirmed_at && (entry.entry_id ?? 0) > (latest.entry_id ?? 0)) ? entry : latest, null);
  // History is the source of truth for signed repeat entries. A saved current
  // worksheet is never promoted into a confirmed result.
  const latestConfirmedEntry = latestHistoryEntry ?? (current.data?.intent?.status === 'confirmed' && current.data.intent.confirmed_at
    ? { entry_id: current.data.intent.entry_id, amount: current.data.intent.amount, name: current.data.intent.name, confirmed_at: current.data.intent.confirmed_at, unallocated: current.data.intent.unallocated, allocations: current.data.intent.allocations }
    : null);
  if (!ready) return <section className="inv"><div className="page-wrap inv-state" role="status" aria-label="Checking sign-in"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div></section>;
  return <section className="inv"><div className="page-wrap">
    {current.isPending || current.isFetching ? <div className="inv-state" role="status" aria-label="Loading saved interest"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div> :
    current.isError ? <ErrorState retry={()=>void current.refetch()}/> :
    current.data?.intent ? <div className="inv-state" style={{maxWidth:850}}>
      <p className="inv-kicker">{current.data.intent.status === 'confirmed' ? 'Interest confirmed / Private record' : 'Interest saved / The next chapter'}</p><h1>{current.data.intent.status === 'confirmed' ? 'Your interest is confirmed.' : `Thank you, ${current.data.intent.name.split(' ')[0]}.`}</h1>
      <p data-testid="text-intent-saved">Your non-binding interest of {dollars(current.data.intent.status === 'confirmed' ? latestConfirmedEntry?.amount ?? current.data.intent.amount : current.data.intent.amount)} is {current.data.intent.status === 'confirmed' ? 'confirmed' : 'saved, but not confirmed'}. Returns aren’t guaranteed. You may get back less, or nothing.</p>
      <p>No money has been collected, and you have not made an investment.</p>
      {latestConfirmedEntry && <InvestorResultCard entry={latestConfirmedEntry}/>}
      {current.data.history.length > 0 && <div className="lineup-done-allocations" data-testid="done-interest-history"><p className="inv-kicker">Your signed entries</p><p>{current.data.history.length} separate confirmed {current.data.history.length === 1 ? 'entry' : 'entries'} · {dollars(current.data.history.reduce((total, entry) => total + entry.amount, 0))} cumulative non-binding interest. Saved, unsigned interest is not included.</p><ul>{[...current.data.history].reverse().map((entry, index)=><li key={entry.entry_id ?? 'original'}><span>Entry {current.data.history.length-index} · {entry.unallocated ? 'Unallocated' : entry.allocations.map(row=>row.project_title ?? `Project #${row.project_id}`).join(', ') || 'Project no longer listed'} · {new Date(entry.confirmed_at).toLocaleDateString('en-US')}</span><strong>{dollars(entry.amount)}</strong></li>)}</ul></div>}
      <p>Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.</p>
      <div className="inv-actions">{current.data.intent.status === 'saved' && (signedIn ? <Link href="/invest?revise=1" className="inv-button" data-testid="link-done-confirm">Finish my worksheet <ArrowRight size={16}/></Link> : <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-done-sign-in" label="Sign in to finish" />)}<Link href="/lineup" className={`inv-button ${current.data.intent.status === 'saved' ? 'secondary' : ''}`} data-testid="link-done-lineup">View my {current.data.intent.status === 'confirmed' ? 'confirmed' : 'saved'} lineup <ArrowRight size={16}/></Link><Link href="/explore" className="inv-button secondary" data-testid="link-done-explore">Explore projects</Link></div>
      {!signedIn && current.data.intent.status === 'saved' && <p className="inv-small">If this is guest interest, sign in and explicitly claim it from this original browser on your lineup if it is not linked to your account.</p>}
    </div> : latestConfirmedEntry ? <div className="inv-state" style={{maxWidth:850}}><p className="inv-kicker">Interest confirmed / Private record</p><h1>Your interest is confirmed.</h1><InvestorResultCard entry={latestConfirmedEntry}/><div className="inv-actions"><Link href="/lineup" className="inv-button">View my confirmed lineup <ArrowRight size={16}/></Link><Link href="/explore" className="inv-button secondary">Explore projects</Link></div></div> : <div className="inv-state"><p className="inv-kicker">Nothing linked yet</p><h1>Your story starts here.</h1><p>There is no saved investor interest associated with this {signedIn ? 'account' : 'visit'}. {signedIn ? 'If you saved as a guest in this browser, choose to claim it from your lineup.' : ''}</p><div className="inv-actions">{signedIn && <Link className="inv-button" href="/lineup" data-testid="link-done-claim">Check for guest interest <ArrowRight size={16}/></Link>}<Link className="inv-button secondary" href="/invest" data-testid="link-done-invest">Start the worksheet <ArrowRight size={16}/></Link></div></div>}
  </div></section>;
}

function InvestorSignInGate({ firebaseReady, queryClient, projectSlug }: { firebaseReady:boolean; queryClient:ReturnType<typeof useQueryClient>; projectSlug:string|null }) {
  return <section className="inv"><div className="page-wrap inv-state" style={{maxWidth:850}} data-testid="investor-sign-in-gate">
    <p className="inv-kicker">Account required / Before step 1</p>
    <h1>Start with a verified account.</h1>
    <p>Sign in with Google before beginning the investor worksheet. Your answers and saved non-binding interest will belong to that account from the start{projectSlug ? `, while keeping the selected project context (${projectSlug})` : ''}.</p>
    <div className="inv-note"><p>This verifies access to an account email; it does not verify legal identity or complete KYC.</p><p>It does not sign or confirm the separate exact-interest acknowledgment, collect money, or make an investment.</p></div>
    <div className="inv-actions"><GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inv-button" testId="button-investor-start-sign-in" label="Sign in to begin" /><Link href="/explore" className="inv-button secondary">Explore projects without signing in</Link></div>
    <p className="inv-small">After sign-in, you’ll return to this same worksheet entry. Any project choice or repeat-entry context in the address is preserved.</p>
  </div></section>;
}

export default function Investor() {
  const firebaseUser = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const queryClient = useQueryClient();
  const identityId = firebaseUser?.uid ?? 'visitor';
  const expectedOwner = firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
  const search = window.location.search;
  if (!firebaseReady) return <section className="inv"><div className="page-wrap inv-state" role="status" aria-label="Checking sign-in"><div className="inv-skeleton" style={{height:95}}/><div className="inv-skeleton"/></div></section>;
  if (!firebaseUser) {
    return <InvestorSignInGate firebaseReady={firebaseReady} queryClient={queryClient} projectSlug={new URLSearchParams(search).get('project')} />;
  }
  return <InvestorWorksheet key={`${expectedOwner}:${search}`} identityId={identityId} expectedOwner={expectedOwner} signedInEmail={firebaseUser?.email ?? null} />;
}

function InvestorWorksheet({ identityId, expectedOwner, signedInEmail }: { identityId: string; expectedOwner: string; signedInEmail:string|null }) {
  const params = new URLSearchParams(window.location.search);
  const targetSlug = params.get('project');
  const newEntry = params.get('new') === '1';
  const revise = params.get('revise') === '1';
  const oneProject = Boolean(targetSlug) && params.get('one') === '1' && !revise;
  const [,navigate] = useLocation();
  const queryClient = useQueryClient();
  const visitor = useGetPriceGroup();
  const progress = useGetFlowProgress('investor',{query:{queryKey:[...getGetFlowProgressQueryKey('investor'),identityId],enabled:visitor.isSuccess,retry:(count,error)=>error.status!==404 && count<2}});
  const current = useGetCurrentInvestorIntent({query:{queryKey:[...getGetCurrentInvestorIntentQueryKey(),identityId],enabled:visitor.isSuccess,retry:(count,error)=>error.status!==404 && count<2}});
  const explore = useGetExplore(undefined, {query:{
    queryKey:[...getGetExploreQueryKey(),expectedOwner],
    refetchOnMount:'always',
    refetchOnWindowFocus:true,
  }});
  // Open pledging: a project-page link may target a submitted project that is
  // not approved yet, so it is not in Explore. Load it from its public page.
  const inExplore = !!targetSlug && !!explore.data?.projects.some(p=>p.slug===targetSlug);
  const loadPageTarget = oneProject && explore.isSuccess && !inExplore;
  const publicTarget = useGetPublicProject(targetSlug ?? '', {query:{queryKey:[...getGetPublicProjectQueryKey(targetSlug ?? ''),expectedOwner],enabled:loadPageTarget,retry:false}});
  const pageTarget: ExploreProject | null = loadPageTarget && publicTarget.data ? {
    id:publicTarget.data.id, slug:publicTarget.data.slug, title:publicTarget.data.title, logline:publicTarget.data.logline ?? null,
    format:publicTarget.data.format ?? null, genre:publicTarget.data.genre ?? null, stage:publicTarget.data.stage ?? null,
    poster_url:null, pitch_deck_url:null, pitch_deck_name:null,
    // An unapproved project's offer is not public, so no payback goal is shown.
    offer_per_100:null, confirmed_pledge_total:0, is_owner:publicTarget.data.is_owner,
  } : null;
  const waitingForPageTarget = loadPageTarget && publicTarget.isPending;
  const projectList = explore.data ? [...explore.data.projects, ...(pageTarget ? [pageTarget] : [])] : undefined;
  const match = useMatchInvestor();
  const save = useSaveFlowProgress();
  const submit = useSaveInvestorIntent();
  const confirmInterest = useConfirmInvestorIntent();
  const [signature, setSignature] = useState('');
  const [interestAccepted, setInterestAccepted] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const pendingSaved = useRef<{ investor_id:number; entry_id:number|null; reviewKey:string; draftKey:string } | null>(null);
  const ageStatus = useAgeStatus();
  const confirmAge = useConfirmAge();
  const [ageChecked,setAgeChecked] = useState(false);
  const [a,setA] = useState<Answers>(blank);
  useEffect(() => {
    setInterestAccepted(false);
    setSignature('');
  }, [JSON.stringify(a)]);
  const [screen,setScreen] = useState(1);
  const [single,setSingle] = useState(false);
  const [ready,setReady] = useState(false);
  const [selectionNeeded,setSelectionNeeded] = useState(false);
  const [matches,setMatches] = useState<ExploreProject[]>([]);
  const [matchState,setMatchState] = useState<'idle'|'loading'|'matches'|'no-matches'|'unavailable'>('idle');
  const [showAllAvailable,setShowAllAvailable] = useState(false);
  const [otherMinimumSelected,setOtherMinimumSelected] = useState<Partial<Record<MinimumStage,boolean>>>({});
  const [customMinimumDrafts,setCustomMinimumDrafts] = useState<Partial<Record<MinimumStage,string>>>({});
  const [error,setError] = useState('');
  const [checkLineup,setCheckLineup] = useState(false);
  const [canStartFresh,setCanStartFresh] = useState(false);
  const [saving,setSaving] = useState(false);
  const initialised = useRef(false);
  const restoredMatchStarted = useRef(false);
  const timer = useRef<number|null>(null);
  const lastSaved = useRef('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveFn = useRef(save.mutateAsync);
  saveFn.current = save.mutateAsync;
  const active = useRef(true);
  useEffect(()=>()=>{active.current=false;if(timer.current!==null)window.clearTimeout(timer.current);},[]);
  useEffect(()=>{
    if (initialised.current) return;
    if (!explore.isSuccess || !current.isSuccess || !progress.data && !progress.isError) return;
    const target = projectList?.find(p=>p.slug===targetSlug && !p.is_owner);
    if (targetSlug && !target) return;
    if (newEntry && current.data.intent?.status==='confirmed') {
      if (identityId==='visitor') return;
      initialised.current=true;
      const previous=current.data.intent;
      const context=`new:${targetSlug}:${previous.confirmed_at}`;
      const draft=progress.data?.answers as Answers | undefined;
      if (draft?.entry_context===context) {
        const step=mapStep(draft as unknown as Record<string,unknown>,progress.data!.last_screen);
        const one=oneProject && !!target && canUseSingleProjectDraft(draft.lineup ?? [],target.id,!!draft.unallocated);
        setSingle(one);setA({...blank,...draft});setScreen(one && step<5 ? 1 : step);
      } else {
        const start:Answers={...blank,amount:100,name:previous.name,email:previous.email,phone:previous.phone ?? '',city:previous.city ?? '',state:previous.state ?? '',country:previous.country ?? '',zip:previous.zip ?? '',location_manual:true,accredited:previous.accredited,experience:previous.experience,motivations:previous.motivations,favorite_genres:previous.favorite_genres,stages:previous.stages,minima:previous.minima,call_opt_in:previous.call_opt_in,lineup:target?[{project_id:target.id,amount:100}]:[],entry_context:context};
        setSingle(oneProject && !!target); setA(start); setScreen(1);
      }
      setReady(true);
      return;
    }
    if ((revise || newEntry) && current.data.intent?.status==='saved') {
      initialised.current=true;
      const existing=current.data.intent;
      const restored={...blank,amount:existing.amount,name:existing.name,email:existing.email,phone:existing.phone ?? '',city:existing.city ?? '',state:existing.state ?? '',country:existing.country ?? '',zip:existing.zip ?? '',location_manual:true,accredited:existing.accredited,experience:existing.experience,motivations:existing.motivations,favorite_genres:existing.favorite_genres,stages:existing.stages,minima:existing.minima,call_opt_in:existing.call_opt_in,unallocated:existing.unallocated,lineup:existing.allocations.map(row=>({project_id:row.project_id,amount:row.amount}))} as Answers;
      setA(restored); setScreen(4); setSelectionNeeded(!!target && !restored.lineup.some(row=>row.project_id===target.id)); setReady(true);
      return;
    }
    if (progress.data) {
      initialised.current = true;
      const restored = {...blank,...progress.data.answers, minima:{...blank.minima,...(progress.data.answers.minima as object || {})}} as Answers;
      if (!('location_manual' in progress.data.answers) && restored.city && !restored.country) restored.location_manual = true;
      const step = mapStep(progress.data.answers as Record<string,unknown>,progress.data.last_screen);
      // A single-project link reuses a draft only when it holds nothing but this project.
      const one = oneProject && !!target && canUseSingleProjectDraft(restored.lineup,target.id,restored.unallocated);
      if (one) restored.lineup=singleProjectLineup(target.id,restored.amount);
      else if (target && !restored.lineup.some(row=>row.project_id===target.id)) setSelectionNeeded(true);
      const shown = one && step<5 ? 1 : step;
      setSingle(one); setA(restored); setScreen(shown); lastSaved.current=JSON.stringify({screen:shown,a:restored}); setReady(true);
    } else if (progress.error?.status===404) {
      initialised.current=true;
      if(target) setA({...blank,lineup:[{project_id:target.id,amount:100}]});
      setSingle(oneProject && !!target);
      setReady(true);
    }
  },[progress.data,progress.error,explore.isSuccess,current.isSuccess,publicTarget.data]);
  useEffect(()=>{
    if(!ready || identityId==='visitor' || !signedInEmail) return;
    setA(current=>current.email.trim()?current:{...current,email:signedInEmail});
  },[ready,identityId,signedInEmail]);
  useEffect(()=>{
    if (!ready || selectionNeeded || screen!==4 || !explore.isSuccess || matchState!=='idle' || restoredMatchStarted.current) return;
    restoredMatchStarted.current=true;
    void findCandidates(a,false).catch(()=>setError('We could not restore your project matches. Browse available projects manually, or retry matching.'));
  },[ready,selectionNeeded,screen,explore.isSuccess,matchState]);
  useEffect(()=>{if (current.data?.intent && !newEntry && !revise && !progress.isLoading && progress.error?.status!==409) navigate('/invest/done');},[current.data?.intent,progress.isLoading,progress.error,navigate]);
  useEffect(()=>{
    if (!ready || selectionNeeded) return;
    const json=JSON.stringify({screen,a});
    if (json===lastSaved.current) return;
    timer.current=window.setTimeout(()=>{
      setSaving(true);
      const operation=queue.current.catch(()=>undefined).then(()=>{
        if(!active.current) throw new Error('Investor worksheet is no longer active');
        return saveFn.current({data:{flow:'investor',last_screen:screen,answers:{...a},expected_investor_owner:expectedOwner}});
      });
      queue.current=operation;
      operation.then(()=>{lastSaved.current=json;setError('');}).catch(()=>setError('We could not save your progress. Please check your connection before continuing.')).finally(()=>{if(queue.current===operation)setSaving(false);});
    },850);
    return ()=>{if(timer.current!==null)window.clearTimeout(timer.current);};
  },[a,screen,ready,selectionNeeded]);
  const change = <K extends keyof Answers>(key:K,value:Answers[K])=>{setA(prev=>({...prev,[key]:value}));setError('');setCanStartFresh(false);};
  /** One-project path: the whole amount always goes to the selected project. */
  const setSingleAmount = (amount:number)=>{setA(prev=>({...prev,amount,unallocated:false,lineup:prev.lineup.length ? singleProjectLineup(prev.lineup[0].project_id,amount) : prev.lineup}));setError('');setCanStartFresh(false);};
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
    const operation=queue.current.catch(()=>undefined).then(()=>{
      if(!active.current) throw new Error('Investor worksheet is no longer active');
      return saveFn.current({data:{flow:'investor',last_screen:step,answers:{...value},expected_investor_owner:expectedOwner}});
    });
    queue.current=operation;
    try {await operation;lastSaved.current=JSON.stringify({screen:step,a:value});setError('');}
    catch {setError('We could not save your answers. Check your connection and try again.');throw new Error('Save failed');}
    finally {if(queue.current===operation)setSaving(false);}
  }
  const available = projectList?.filter(project=>!project.is_owner) || [];
  const ownedProjects = projectList?.filter(project=>project.is_owner) || [];
  const selected = available.filter(p=>a.lineup.some(row=>row.project_id===p.id));
  const allocated = a.lineup.reduce((sum,row)=>sum+Number(row.amount||0),0);
  const rating = !a.unallocated ? spreadRating(a.amount,a.lineup) : null;
  async function findCandidates(value:Answers, autoBuild:boolean):Promise<Answers> {
    setError('');
    setMatches([]);
    setMatchState('loading');
    setShowAllAvailable(false);
    try {
      const result=await match.mutateAsync({data:{amount:value.amount,favorite_genres:value.favorite_genres,stages:value.stages,minima:minimaForSelectedStages(value.minima,value.stages)}});
      const realIds=new Set(available.map(p=>p.id));
      const candidates=result.projects.filter(p=>realIds.has(p.id));
      setMatches(candidates);
      setMatchState(candidates.length?'matches':'no-matches');
      const selectedCandidates=selectAutoBuildProjects(candidates,value.amount);
      if(autoBuild && !value.unallocated && !value.lineup.length && selectedCandidates.length && Math.floor(value.amount/selectedCandidates.length)>=PROJECT_MINIMUM) {
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
    if(step===5 && !a.terms_read) return 'Acknowledge the ground rules below before submitting your non-binding interest.';
    if(step===1 && (!Number.isSafeInteger(a.amount) || a.amount<100)) return 'Enter a whole-dollar amount of at least $100.';
    if(step===1 && !a.terms_read) return 'Please acknowledge the ground rules before continuing.';
    if(step===1 && !(ageStatus.confirmed || ageChecked)) return 'Confirm that you are 18 years of age or older to continue.';
    if(step===2 && (!a.favorite_genres.length || !a.stages.length)) return 'Choose at least one genre and one project stage.';
    if(step===3 && stages.some(([stage])=>a.stages.includes(stage) && otherMinimumSelected[stage] && !isValidCustomMinimum(customMinimumValue(stage)))) return 'Enter a whole-dollar custom minimum of at least $125 for each selected stage where Other is selected.';
    if(step===3 && Object.values(minimaForSelectedStages(a.minima,a.stages)).some(value=>value!==null && (!Number.isSafeInteger(value) || value<125))) return 'Minimum preferences must be whole-dollar amounts of at least $125.';
    if(step===4 && !a.unallocated) {
      if(!a.lineup.length) return 'Choose projects, or select Just pledge to leave your interest unallocated.';
      if(a.lineup.length>cap(a.amount)) return cap(a.amount)===MAX_PROJECTS ? `A pledge can include up to ${MAX_PROJECTS} projects.` : `A ${dollars(a.amount)} pledge can cover up to ${cap(a.amount)} project${cap(a.amount)===1?'':'s'} at ${dollars(PROJECT_MINIMUM)} each.`;
      if(a.lineup.some(x=>!available.some(p=>p.id===x.project_id))) return 'A project in your lineup is no longer available. Please update your selection.';
      if(a.lineup.some(x=>!Number.isSafeInteger(Number(x.amount)) || Number(x.amount)<PROJECT_MINIMUM)) return `Each project needs at least ${dollars(PROJECT_MINIMUM)}.`;
      if(allocated!==a.amount) return `Your allocations must add up to ${dollars(a.amount)}. Currently allocated: ${dollars(allocated)}.`;
    }
    if(step===5 && (!a.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || !a.city.trim() || !/^[A-Z]{2}$/.test(a.country))) return 'Add your name, a valid email, city and country. Choose a city from the suggestions or enter your location manually.';
    return '';
  }
  async function ensureAge():Promise<boolean> {
    if(ageStatus.confirmed) return true;
    if(!ageChecked){setError('Confirm that you are 18 years of age or older to continue.');return false;}
    try {
      await confirmAge.mutateAsync({data:{age_confirmed:true}});
      await queryClient.invalidateQueries({queryKey:ageStatus.queryKey});
      return true;
    } catch {setError('We could not save your 18+ confirmation. Your answers are saved; please try again.');return false;}
  }
  async function jump(target:number) {setError('');try{await persist(target,a);setScreen(target);window.scrollTo({top:0,behavior:'smooth'});}catch {/* error shown by persist */}}
  async function next() {
    const issue=validate(screen);
    if(issue){setError(issue);return;}
    setError('');
    if(screen===1 && !await ensureAge()) return;
    let updated=a;
    if(screen===3) {
      try {
        updated=await findCandidates(a,true);
      } catch {setError('We could not find matches right now. Please try again.');return;}
    }
    const to = single && screen===1 ? 5 : screen+1;
    try {await persist(to,updated);setA(updated);setScreen(to);window.scrollTo({top:0,behavior:'smooth'});}catch {/* error shown by persist */}
  }
  async function back() {setError('');setCanStartFresh(false);const to = single && screen===5 ? 1 : screen-1;try{await persist(to,a);setScreen(to);window.scrollTo({top:0,behavior:'smooth'});}catch {/* error shown by persist */}}
  async function finish(startFresh=false) {
    if (finishingRef.current) return;
    // The one-project path has no interest or repayment-preference screens.
    const issue=validate(5) || validate(4) || (single ? '' : validate(3) || validate(2));
    if(issue){setError(issue);return;}
    if (!interestAccepted || signature !== a.name.trim()) {
      setError('Review your amount and projects, type your full name exactly as shown, and check the confirmation before submitting.');
      return;
    }
    const reviewed = {
      name:a.name.trim(), amount:a.amount, unallocated:a.unallocated,
      allocations:a.unallocated ? [] : a.lineup.map(row=>({...row})),
    };
    const reviewKey = investorReviewKey(reviewed);
    const draftKey = JSON.stringify(a);
    finishingRef.current = true;
    setFinishing(true);
    setCheckLineup(false);
    setCanStartFresh(false);
    try {
      if(!await ensureAge()) return;
      await persist(5,a);
      const {terms_read: _terms, lineup: _lineup, location_manual: _manual, flow_version: _fv, ...input}=a;
      void _terms; void _lineup; void _manual; void _fv;
      if(!active.current) return;
      if (!pendingSaved.current || pendingSaved.current.reviewKey !== reviewKey || pendingSaved.current.draftKey !== draftKey) {
        const saved = await submit.mutateAsync({data:{
          ...input, minima:minimaForSelectedStages(a.minima,a.stages),
          ground_rules_accepted: a.terms_read === true ? true : undefined,
          expected_investor_owner:expectedOwner,new_entry:!startFresh && (newEntry || current.data?.intent?.entry_id != null && current.data.intent.status==='saved'),
          start_fresh:startFresh,name:reviewed.name,email:a.email.trim(),phone:a.phone?.trim() || undefined,city:a.city.trim(),state:a.state?.trim() || undefined,zip:a.zip?.trim() || undefined,
          allocations:reviewed.allocations,unallocated:reviewed.unallocated,
        }});
        pendingSaved.current = { ...saved, reviewKey, draftKey };
      }
      if(!active.current) return;
      const saved = pendingSaved.current;
      const fresh = await current.refetch();
      const latest = fresh.data?.intent;
      if (fresh.isError || !latest || latest.investor_id !== saved.investor_id
        || latest.entry_id !== saved.entry_id || investorReviewKey(latest) !== reviewKey) {
        setCheckLineup(true);
        pendingSaved.current = null;
        setInterestAccepted(false);
        setSignature('');
        setError('Your saved interest could not be matched to this review. Nothing was signed. Your answers are saved; review the latest details before submitting again.');
        return;
      }
      if(!active.current) return;
      await confirmInterest.mutateAsync({data:{
        investor_id:saved.investor_id, signature_name:signature, accepted:true, entry_id:saved.entry_id,
        amount:reviewed.amount, allocations:reviewed.allocations,
      }});
      trackInvestorEvent('inv_confirmed');
      await Promise.all([
        queryClient.invalidateQueries({queryKey:getGetCurrentInvestorIntentQueryKey()}),
        queryClient.invalidateQueries({queryKey:getGetExploreQueryKey()}),
        ...latest.allocations.filter(row=>row.project_slug).map(row=>queryClient.invalidateQueries({queryKey:getGetPublicProjectQueryKey(row.project_slug!)})),
      ]);
      trackInvestorEvent('inv_complete', { path: newEntry ? 'new_entry' : revise ? 'revise' : 'initial', total:a.amount, accredited:a.accredited });
      if(active.current) navigate('/invest/done');
    } catch (cause) {
      // If confirmation committed but its response was lost, reconcile only this
      // exact entry, never an earlier signed indication with similar values.
      const saved = pendingSaved.current;
      if (saved?.reviewKey === reviewKey && saved.draftKey === draftKey) {
        const fresh = await current.refetch();
        const exact = [fresh.data?.intent, ...(fresh.data?.history ?? [])].find(row=>fresh.data?.intent?.investor_id === saved.investor_id && row
          && row.entry_id === saved.entry_id && investorReviewKey(row) === reviewKey
          && ('status' in row ? row.status === 'confirmed' : Boolean(row.confirmed_at)));
        if(!fresh.isError && exact) {
          await Promise.all([
            queryClient.invalidateQueries({queryKey:getGetCurrentInvestorIntentQueryKey()}),
            queryClient.invalidateQueries({queryKey:getGetExploreQueryKey()}),
            ...exact.allocations.filter(row=>row.project_slug).map(row=>queryClient.invalidateQueries({queryKey:getGetPublicProjectQueryKey(row.project_slug!)})),
          ]);
          if(active.current) navigate('/invest/done');
          return;
        }
      }
      const failure=submissionFailure(cause);
      setError(saved?.draftKey === draftKey ? 'Your interest is saved, but we could not verify confirmation. Retry Submit to check and finish this same record; no money has been collected.' : failure.message);
      setCheckLineup(failure.checkLineup);
      setCanStartFresh(failure.canStartFresh);
    } finally {
      finishingRef.current = false;
      if(active.current) setFinishing(false);
    }
  }
  function add(project:ExploreProject) {
    if(project.is_owner || a.lineup.some(x=>x.project_id===project.id) || a.lineup.length>=cap(a.amount)) return;
    const ids=[...a.lineup.map(x=>x.project_id),project.id];
    const projects=ids.map(id=>available.find(p=>p.id===id)).filter((x):x is ExploreProject=>Boolean(x));
    change('lineup',split(a.amount,projects));
    trackInvestorEvent('lineup_add', { project_id: project.id });
  }
  if (targetSlug && explore.isSuccess && !waitingForPageTarget && !available.some(p=>p.slug===targetSlug)) return <section className="inv"><div className="page-wrap inv-state" role="alert"><h1>{ownedProjects.some(p=>p.slug===targetSlug) ? 'This is your project.' : 'This project is not available for new interest.'}</h1><p>{ownedProjects.some(p=>p.slug===targetSlug) ? 'You can manage it, but you can’t pledge interest in your own project.' : 'No saved or signed interest was changed.'}</p><Link href={ownedProjects.some(p=>p.slug===targetSlug) ? '/me/projects' : '/explore'} className="inv-button">{ownedProjects.some(p=>p.slug===targetSlug) ? 'Manage project' : 'Explore available projects'}</Link></div></section>;
  if(progress.isError && progress.error?.status===409) return <section className="inv"><GuestDraftConflictState/></section>;
  if(visitor.isError || progress.isError && progress.error?.status!==404 || current.isError && current.error?.status!==404 || explore.isError) return <section className="inv"><ErrorState retry={()=>{void visitor.refetch();void progress.refetch();void current.refetch();void explore.refetch();}}/></section>;
  if(visitor.isPending || progress.isLoading || current.isLoading || explore.isLoading || waitingForPageTarget || !ready && !progress.isError && !visitor.isError) return <section className="inv"><div className="page-wrap inv-state" aria-label="Loading investor worksheet"><p className="inv-kicker">Opening your worksheet</p><div className="inv-skeleton" style={{height:85}}/><div className="inv-skeleton" style={{height:150}}/></div></section>;
  if (newEntry && (identityId==='visitor' || !current.data?.history.length) || revise && current.data?.intent?.status!=='saved') return <section className="inv"><div className="page-wrap inv-state"><h1>This worksheet cannot be started here.</h1><p>Review your saved interest first. A separate entry requires previously confirmed account interest.</p><Link href="/lineup" className="inv-button">View my lineup</Link></div></section>;
  if (selectionNeeded) {
    const target=available.find(p=>p.slug===targetSlug)!;
    return <section className="inv"><div className="page-wrap inv-state"><h1>Choose how to continue.</h1><p>Your existing {revise?'saved interest':'worksheet'} has different project choices. Nothing has been replaced. To include {target.title}, explicitly replace the draft lineup or keep your existing choices and add it manually at the allocation step.</p><div className="inv-actions"><button type="button" className="inv-button" data-testid="button-replace-draft-lineup" onClick={()=>{setA(prev=>({...prev,unallocated:false,lineup:[{project_id:target.id,amount:prev.amount}]}));setScreen(4);setSelectionNeeded(false);}}>Replace draft lineup with {target.title}</button><button type="button" className="inv-button secondary" onClick={()=>{setScreen(4);setSelectionNeeded(false);}}>Keep existing choices</button></div></div></section>;
  }
  const stepHeadings = single ? singleHeadings : headings;
  const position = single ? (screen===5 ? 2 : 1) : screen;
  return <section className="inv"><div className="page-wrap">
    <div className="inv-top"><Link href="/explore" className="inv-kicker" data-testid="link-invest-explore">Movie Show Investing / Explore</Link><span className="inv-kicker" data-testid="text-invest-step">Step {position} / {stepHeadings.length}</span></div>
    <div className="inv-progress" aria-label={`Step ${position} of ${stepHeadings.length}`}>{stepHeadings.map((h,i)=><span key={h} className={i<position?'active':''} title={h}/>)}</div>
    <div className="inv-layout"><div className="inv-intro" key={screen}><p className="inv-kicker">{single ? 'Pledge' : 'Investor worksheet'} / 0{position}</p><h1>{stepHeadings[position-1]}<em>.</em></h1><p>{(single ? singleDescriptions : descriptions)[position-1]}</p><div className="inv-note"><p>Pledge your interest in future investment opportunities. If a project opens for investment, it will be offered only in compliance with securities laws, and you'll get full offering documents before you decide.</p><p>Your interest is non-binding. No money is collected and nothing here is an offer to sell securities.</p></div></div>
      <div className="inv-panel" inert={finishing} aria-busy={finishing}>
        {screen===1 && single && (()=>{const project=available.find(p=>p.id===a.lineup[0]?.project_id);const offer=project?.offer_per_100 ?? null;const goal=offer!==null && offer>=125 && a.amount>0 ? a.amount*offer/100 : null;return <>
          <p className="inv-kicker" data-testid="text-single-project-kicker">Your pledge to</p>
          <h2 className="serif" data-testid="text-single-project-title" style={{fontSize:'clamp(30px,4vw,46px)',lineHeight:1.05,margin:'6px 0 14px',overflowWrap:'anywhere'}}>{project?.title ?? 'This project'}</h2>
          <p data-testid="text-pledge-encouragement">{PLEDGE_ENCOURAGEMENT}</p>
          <p className="inv-label" style={{marginTop:22}}>How much would you pledge to this project? · USD</p>
          <div className="inv-amount"><span>$</span>{a.amount || '—'}</div>
          <div className="inv-options">{[100,250,500,1000].map(value=><Option key={value} type="radio" checked={a.amount===value} label={dollars(value)} onChange={()=>setSingleAmount(value)}/>)}</div>
          <div className="inv-field"><label htmlFor="invest-amount">Or enter an amount</label><input id="invest-amount" data-testid="input-invest-amount" className="inv-input" type="number" min={PROJECT_MINIMUM} step="1" value={a.amount || ''} onChange={e=>setSingleAmount(Number(e.target.value))}/></div>
          <p className="inv-small">Minimum {dollars(PROJECT_MINIMUM)} for this project.</p>
          {goal!==null && <p data-testid="text-single-payback-goal">Payback goal: {goalDollars(goal)} back on your {dollars(a.amount)}, based on the project’s current offer; this figure is illustrative, not guaranteed. Returns aren’t guaranteed. You may get back less, or nothing.</p>}
          {goal===null && <p className="inv-small">Returns aren’t guaranteed. You may get back less, or nothing.</p>}
          <p className="inv-small">A pledge is a non-binding indication of interest only; it does not reserve a project, require payment, or make an investment.</p>
          <p className="inv-kicker">General understanding · not a signature</p>
          <div className="inv-section"><h2>Interest is not an investment.</h2><p>Your pledge is non-binding. No money is collected, and you are not committing to fund a project.</p></div>
          <div className="inv-section"><h2>Returns aren’t guaranteed.</h2><p>Films and shows can create exciting possibilities, but budgets, timelines, and audiences can change. If an investment becomes available in the future, it could lose some or all of its value. Any future opportunity would come with separate details to review and a separate decision to make.</p></div>
          <div className="inv-section"><p>This general acknowledgment is not a signature. On the next screen you review the exact project and amount and sign once.</p><Option label="I understand this is non-binding interest, not an investment or an offer." checked={a.terms_read} onChange={()=>change('terms_read',!a.terms_read)}/></div>
          <AgeAcknowledgment role="investor" checked={ageStatus.confirmed || ageChecked} disabled={ageStatus.confirmed} savedAt={ageStatus.confirmedAt} onChange={setAgeChecked}/>
        </>;})()}
        {screen===1 && !single && <><p className="inv-label">How much might you be interested in? · USD</p><div className="inv-amount"><span>$</span>{a.amount || '—'}</div><p className="inv-small">A pledge is a non-binding indication of interest only; it does not reserve a project, require payment, or make an investment.</p><p className="inv-small">Returns aren’t guaranteed. You may get back less, or nothing.</p><div className="inv-options">{[100,250,500,1000].map(value=><Option key={value} type="radio" checked={a.amount===value} label={dollars(value)} onChange={()=>change('amount',value)}/>)}</div><div className="inv-field"><label htmlFor="invest-amount">Or enter an amount</label><input id="invest-amount" data-testid="input-invest-amount" className="inv-input" type="number" min="100" step="1" value={a.amount || ''} onChange={e=>change('amount',Number(e.target.value))}/></div><p className="inv-small">Minimum total interest: $100. You can adjust your project choices later.</p>
        <div className="inv-section"><h2>Per $100 invested</h2><p className="inv-small">Repayment preferences later are stated as total repayment per $100 including original capital. Project terms, backend splits and platform fees are shown with each project at the lineup step.</p></div><p className="inv-kicker">General understanding · not a signature</p><div className="inv-section"><h2>Interest is not an investment.</h2><p>This worksheet records what you may want to explore. Your pledge is non-binding. No money is collected, and you are not committing to fund a project.</p></div><div className="inv-section"><h2>Returns aren’t guaranteed.</h2><p>Films and shows can create exciting possibilities, but budgets, timelines, and audiences can change. If an investment becomes available in the future, it could lose some or all of its value.</p><p>For now, a pledge only expresses interest—no money changes hands. Any future opportunity would come with separate details to review and a separate decision to make.</p></div><div className="inv-section"><p>This general acknowledgment is not a signature or confirmation of any saved amount or project allocations. Later, you can review the exact saved record and sign it separately.</p><Option label="I understand this is non-binding interest, not an investment or an offer." checked={a.terms_read} onChange={()=>change('terms_read',!a.terms_read)}/></div><AgeAcknowledgment role="investor" checked={ageStatus.confirmed || ageChecked} disabled={ageStatus.confirmed} savedAt={ageStatus.confirmedAt} onChange={setAgeChecked}/></>}
          {screen===2 && <><p className="inv-label">Genres you return to · choose any</p><div className="inv-grid">{genres.map(g=><Option key={g} label={g} checked={a.favorite_genres.includes(g)} onChange={()=>change('favorite_genres',toggle(a.favorite_genres,g))}/>)}</div><div className="inv-section"><p className="inv-label">Where in the process?</p><div className="inv-options">{stages.map(([value,label])=><Option key={value} label={label} checked={a.stages.includes(value)} onChange={()=>change('stages',toggle(a.stages,value))}/>)}</div></div></>}
          {screen===3 && <div className="inv-section" data-testid="section-repayment-preferences">
            <h2>What does repayment mean?</h2>
            <p>Total repayment includes the money you originally invested—not just the additional return.</p>
            <p className="inv-small">These are the standard suggestions for your selected stages. Individual filmmakers may propose different terms, which you can review with each project.</p>
            <div className="inv-grid">{stages.filter(([stage])=>a.stages.includes(stage)).map(([stage,label])=>{
              const target = stage==='distribution' ? 125 : stage==='production' ? 150 : 175;
              return <fieldset className="inv-minimum-stage" key={stage} data-testid={`repayment-stage-${stage}`}>
                <legend>{label}</legend>
                <p className="inv-kicker">Proposed total repayment target</p>
                <h3 data-testid={`repayment-target-${stage}`}>$100 invested → {dollars(target)} total repayment</h3>
                <p>Your original <strong>$100 back, plus {dollars(target-100)}</strong>—if the project earns enough revenue to reach that target.</p>
                <p className="inv-label">What is the minimum total repayment you would consider for every $100 invested?</p>
                <div className="inv-options">{[
                  ...fixedMinimumOptions.map(([amount])=>({value:String(amount),label:`${dollars(amount)} total ($100 back + ${dollars(amount-100)})`})),
                  {value:'other',label:'Other amount (custom)'},{value:'not-interested',label:'Not interested in this stage'},
                ].map(option=><label className="inv-option" key={option.value}>
                  <input type="radio" name={`minimum-${stage}`} data-testid={`input-minimum-${stage}-${option.value}`} checked={minimumChoice(stage)===option.value} onChange={()=>chooseMinimum(stage,option.value)}/><span>{option.label}</span>
                </label>)}</div>
                {minimumChoice(stage)==='other' && <div className="inv-field"><label htmlFor={`minimum-${stage}-custom`}>Your minimum total repayment per $100 · whole dollars, at least $125</label><input id={`minimum-${stage}-custom`} className="inv-input" data-testid={`input-minimum-${stage}-custom`} type="number" min="125" step="1" placeholder="For example, 180 means $100 back plus $80" value={customMinimumValue(stage)} onChange={e=>updateCustomMinimum(stage,e.target.value)}/></div>}
              </fieldset>;
            })}</div>
            {!a.stages.length && <p role="alert">Choose at least one stage on Page 2 to see its proposed repayment target.</p>}
            <p>Your minimum helps us find matching projects. It does not change a filmmaker’s proposed terms or guarantee a return. A higher minimum can mean fewer matches. “Not interested” excludes that stage from matching.</p>
            <p className="inv-small">Any later revenue sharing is separate from this first repayment target. The project’s actual backend split, duration and fees are shown with its proposal—not added to the target here.</p>
            <div className="inv-note"><p>Repayment depends on project revenue. Returns and repayment dates are not guaranteed, and a future investment could lose some or all of your money. No money is collected during onboarding.</p></div>
          </div>}
          {screen===4 && <><p className="inv-kicker">Your possible lineup</p><h2 className="serif" style={{fontSize:'clamp(38px,4vw,58px)',lineHeight:1,margin:'15px 0'}}>Choose where your interest goes.</h2><p className="inv-small">Up to {cap(a.amount)} project{cap(a.amount)===1?'':'s'}. Each project needs at least {dollars(PROJECT_MINIMUM)}. Your total is {dollars(a.amount)}.</p><p className="inv-small">Returns aren’t guaranteed. You may get back less, or nothing.</p><p className="inv-small">When matches are available and you have not chosen projects, we start with an even split across up to {cap(a.amount)} matches. You can edit each amount, split evenly again, or manually choose other available projects.</p><p className="inv-small">“Matches your preferences” means a project fits your selected genres, stages, and minimum preferences; it is not a recommendation or endorsement. Project listing approval is not investment approval.</p>
          <div className="inv-options"><Option type="radio" checked={!a.unallocated} label="Choose projects" description="Adjust amounts across a lineup of approved projects." onChange={()=>change('unallocated',false)}/><Option type="radio" checked={a.unallocated} label="Just pledge" description="Save your interest without selecting projects yet." onChange={()=>change('unallocated',true)}/></div>
           <div className="inv-spread" data-testid="text-allocation-spread">{a.unallocated ? <><strong>Allocation spread: None</strong><span>Your interest is unallocated.</span></> : rating ? <><strong>Allocation spread: {rating}</strong><span>Based on the number of projects and largest allocation share. This describes allocation only—not safety, performance, or expected return.</span></> : <><strong>Allocation spread: None</strong><span>No project allocations are currently selected.</span></>}</div>
            {!a.unallocated && <><div className="inv-lineup">{a.lineup.map(row=>{const project=available.find(p=>p.id===row.project_id);const owned=ownedProjects.find(p=>p.id===row.project_id);const stageLabel=project ? String(project.stage)==='other' ? 'Other stage (legacy)' : project.stage || 'Stage not listed' : owned ? 'Your project — remove it from this lineup before saving' : 'Please remove this project';return <div className="inv-lineup-row" key={row.project_id}><div><strong>{project?.title || owned?.title || 'Project no longer available'}</strong>{matchState==='matches' && matches.some(m=>m.id===row.project_id) && <span className="inv-match-badge" data-testid={`badge-match-selected-${row.project_id}`}>Matches your preferences</span>}<small>{stageLabel}</small></div><input className="inv-input" type="number" min={PROJECT_MINIMUM} step="1" aria-label={`Allocation for ${project?.title || owned?.title || 'project'}`} data-testid={`input-allocation-${row.project_id}`} value={row.amount || ''} onChange={e=>change('lineup',a.lineup.map(x=>x.project_id===row.project_id?{...x,amount:Number(e.target.value)}:x))}/><button type="button" data-testid={`button-remove-${row.project_id}`} onClick={()=>{const kept=a.lineup.filter(x=>x.project_id!==row.project_id);change('lineup',kept.length?split(a.amount,kept.map(x=>available.find(p=>p.id===x.project_id)).filter((x):x is ExploreProject=>Boolean(x))):[]);}}>Remove</button></div>;})}</div>
            {a.lineup.length>0 && <div className="inv-section" data-testid="section-lineup-terms"><h2>Terms for your selected projects</h2><p className="inv-small">Each project shows the filmmaker’s saved proposal and budget as submitted, with an example for your allocation. Examples are illustrative and revenue-dependent, not a promised return or a payment date.</p>{a.lineup.map(row=>{const project=available.find(p=>p.id===row.project_id);return project ? <div key={row.project_id}><p className="inv-kicker">{project.title}</p><ProposalSummary proposal={project.proposal} legacyRepayment={project.offer_per_100} budget={project.budget} stage={project.stage} allocation={Number(row.amount)||0} testId={`lineup-proposal-${project.id}`}/></div> : null;})}</div>}
            {a.lineup.length>0 && <div className="inv-actions" style={{marginTop:0}}><button type="button" className="inv-button secondary" data-testid="button-even-split" onClick={()=>change('lineup',split(a.amount,selected))}>Split evenly</button><span className="inv-small" data-testid="text-allocation-total">Allocated {dollars(allocated)} of {dollars(a.amount)}</span></div>}
            <div className="inv-section"><h2>More to consider</h2><p>Only projects approved for public listing and currently available appear here. Listing approval is not investment approval. Browse a dossier before adding one.</p>
               {a.lineup.length>=cap(a.amount) && available.some(p=>!a.lineup.some(row=>row.project_id===p.id)) && <p className="inv-match-state" role="status" data-testid="text-lineup-limit">{cap(a.amount)===MAX_PROJECTS ? `A pledge can include up to ${MAX_PROJECTS} projects.` : `A ${dollars(a.amount)} pledge can cover up to ${cap(a.amount)} project${cap(a.amount)===1?'':'s'} at ${dollars(PROJECT_MINIMUM)} each.`} Remove a project to choose another.</p>}
               {matchState==='no-matches' && <p className="inv-match-state" role="status" data-testid="text-no-project-matches">No project was returned as a match for both your chosen genres and stages and a qualifying offer at its stage minimum. Stages with no minimum set do not produce a match. You can still browse and choose any available project manually, or choose Just pledge.</p>}
               {matchState==='unavailable' && <div className="inv-match-state" role="status"><p>Matches could not be restored. These are available projects for manual selection; none are labeled as matches.</p><button type="button" className="inv-button secondary" data-testid="button-retry-matching" onClick={()=>void findCandidates(a,false).catch(()=>setError('We could not find matches right now. Please try again.'))}>Retry matching</button></div>}
               {matchState==='loading' && <p className="inv-match-state" role="status">Checking your preferences against available projects…</p>}
               <div className="inv-projects" style={{paddingBottom:0}}>
               {(showAllAvailable || matchState!=='matches' ? available : matches).filter(p=>!a.lineup.some(x=>x.project_id===p.id)).map(project=><InvestorProjectCard key={project.id} project={project} matched={matches.some(m=>m.id===project.id)} action={{label:'Add to lineup',onClick:()=>add(project),disabled:a.lineup.length>=cap(a.amount)}}/>)}
              </div>{!available.length && <p>No other approved projects are available right now. Your own project cannot be added to a lineup. You can still save unallocated interest with Just pledge.</p>}
             {matchState==='matches' && !showAllAvailable && available.some(p=>!matches.some(m=>m.id===p.id) && !a.lineup.some(x=>x.project_id===p.id)) && <button type="button" className="inv-button secondary" data-testid="button-show-all-projects" onClick={()=>setShowAllAvailable(true)}>Show all available projects</button>}
             {matchState==='matches' && showAllAvailable && <button type="button" className="inv-button secondary" data-testid="button-show-matches-only" onClick={()=>setShowAllAvailable(false)}>Show matching projects only</button>}
             </div>
          </>}
        </>}
        {screen===5 && <><div className="inv-section" data-testid="summary-investor"><p className="inv-kicker">Your choices · edit any time</p>{single ? <p className="inv-small" data-testid="text-single-review-summary">Amount {dollars(a.amount)} · {available.find(p=>p.id===a.lineup[0]?.project_id)?.title ?? 'this project'} only</p> : <p className="inv-small">Amount {dollars(a.amount)} · {a.unallocated ? 'unallocated' : `${a.lineup.length} project${a.lineup.length===1?'':'s'}`} · genres: {a.favorite_genres.join(', ') || '—'} · stages: {a.stages.join(', ') || '—'}</p>}<div className="inv-actions" style={{marginTop:0}}><button type="button" className="inv-button secondary" data-testid="button-edit-amount" disabled={saving} onClick={()=>void jump(1)}>Edit amount</button>{!single && <><button type="button" className="inv-button secondary" data-testid="button-edit-interests" disabled={saving} onClick={()=>void jump(2)}>Edit interests</button><button type="button" className="inv-button secondary" data-testid="button-edit-lineup" disabled={saving} onClick={()=>void jump(4)}>Edit lineup</button></>}</div></div>{!ageStatus.confirmed && <AgeAcknowledgment role="investor" checked={ageChecked} onChange={setAgeChecked}/>}<p className="inv-small">Required contact details: name, email, city, and country. Phone, region/state, and postal code are optional.</p><Field id="invest-name" label="Your name" value={a.name} onChange={v=>change('name',v)} autoComplete="name" required/><Field id="invest-email" label="Email address" value={a.email} onChange={v=>change('email',v)} type="email" autoComplete="email" required/><Field id="invest-phone" label="Phone number" value={a.phone||''} onChange={v=>change('phone',v)} type="tel" autoComplete="tel"/>
           <LocationPicker value={{city:a.city||'',state:a.state||'',country:a.country||'',location_manual:a.location_manual}}
             onChange={location=>{setA(current=>({...current,...location}));setError('');setCanStartFresh(false);}}/>
           <Field id="invest-zip" label="Postal code" value={a.zip||''} onChange={v=>change('zip',v)} autoComplete="postal-code"/>
          <div className="inv-section"><h2>Investor background</h2><p className="inv-label">Are you an accredited investor?</p><div className="inv-options"><Option label="Yes" type="radio" checked={a.accredited} onChange={()=>change('accredited',true)}/><Option label="No or not sure" type="radio" checked={!a.accredited} onChange={()=>change('accredited',false)}/></div></div>
          {!single && <div className="inv-section"><p className="inv-label">What experience do you bring? · choose any</p><div className="inv-options">{['New to investing','Invested in creative projects','Invested in private companies','Work in film or media'].map(value=><Option key={value} label={value} checked={a.experience.includes(value)} onChange={()=>change('experience',toggle(a.experience,value))}/>)}</div></div>}
          {!single && <div className="inv-section"><p className="inv-label">What brings you here? · choose any</p><div className="inv-options">{['Support independent filmmakers','Discover stories early','Connect with creators','Learn about future opportunities'].map(value=><Option key={value} label={value} checked={a.motivations.includes(value)} onChange={()=>change('motivations',toggle(a.motivations,value))}/>)}</div></div>}
           <label className="fm-check inv-section inv-contact-opt-in"><input type="checkbox" data-testid="checkbox-invest-chat-opt-in" checked={a.call_opt_in} onChange={e=>change('call_opt_in',e.target.checked)}/><span>I’m open to a quick 15-minute chat about my interests.</span></label>
            <InvestorNotificationPermissionControl/>
            {!a.terms_read && <label className="fm-check inv-section"><input type="checkbox" checked={a.terms_read} onChange={event => change('terms_read', event.target.checked)} data-testid="checkbox-restored-ground-rules"/><span>I understand this is non-binding interest, not an investment or payment. Any future investment requires its own offering documents and eligibility checks; returns are not guaranteed.</span></label>}
            <section className="inv-section" data-testid="section-final-interest-confirmation">
              <p className="inv-kicker">One confirmation · before submission</p>
              <h2>Review and confirm your interest.</h2>
              <p><strong data-testid="review-interest-total">{dollars(a.amount)}</strong> in non-binding interest.</p>
              {a.unallocated ? <p data-testid="review-interest-unallocated">The full amount is unallocated; you have not selected projects.</p> : <ul>{a.lineup.map(row=><li key={row.project_id} data-testid={`review-allocation-${row.project_id}`}>{available.find(project=>project.id===row.project_id)?.title ?? `Project #${row.project_id}`} — {dollars(row.amount)}</li>)}</ul>}
              <p>This confirmation applies only to the amount and project allocations shown here. You can change your mind; this is not a contract, investment or authorization to charge you.</p>
              <Field id="interest-signature" label={`Signature · type your full name exactly: ${a.name.trim() || 'enter your name above'}`} value={signature} onChange={setSignature} required/>
              <label className="lineup-check"><input type="checkbox" data-testid="checkbox-final-interest-confirmation" checked={interestAccepted} onChange={event=>setInterestAccepted(event.target.checked)}/><span>I confirm this non-binding interest for the amount and project selections shown above. No investment is being made and no money is collected.</span></label>
              <p className="inv-small">Submit saves and confirms this reviewed record together. There is no additional confirmation screen afterward. Editing your answers clears this confirmation so you can review the changed details.</p>
            </section>
            <p className="inv-small">Your interest does not reserve a project, require payment, or make an investment. See our <Link href="/privacy" className="underline" data-testid="link-invest-privacy">privacy policy</Link>.</p>
        </>}
        {error && <div className="inv-error" role="alert" data-testid="error-investor"><p>{error}</p>{checkLineup && <Link href="/lineup" data-testid="link-investor-conflict-lineup">Check my saved interest</Link>}</div>}
        {screen===5 && canStartFresh && identityId!=='visitor' && <div className="inv-section" data-testid="investor-start-fresh-choice"><p><strong>Start a separate form?</strong> This will leave two separate records under the same email. The older guest interest stays unchanged and will not appear in this account. Linking it here later would require a separate review.</p><button type="button" className="inv-button secondary" data-testid="button-investor-start-fresh" disabled={saving || submit.isPending} onClick={()=>void finish(true)}>Start fresh and save this interest <ArrowRight size={16}/></button></div>}
        <div className="inv-foot"><div>{screen>1 && <button type="button" className="inv-button secondary" data-testid="button-invest-back" disabled={saving || match.isPending || finishing} onClick={()=>void back()}><ArrowLeft size={16}/> Back</button>}</div><button type="button" className="inv-button" data-testid={screen===5?'button-save-interest':'button-invest-next'} disabled={saving || match.isPending || finishing || screen===5 && (!interestAccepted || signature!==a.name.trim() || !a.name.trim())} onClick={()=>void (screen===5?finish():next())}>{finishing?'Submitting your confirmed interest…':match.isPending?'Finding projects…':saving?'Saving…':screen===5?'Submit non-binding interest':'Continue'} <ArrowRight size={16}/></button></div>
      </div>
    </div>
  </div></section>;
}