import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetFilmmakerResultQueryKey, getGetFlowProgressQueryKey, useGetFilmmakerResult, useGetFlowProgress, useGetPriceGroup, useSaveFlowProgress, useSubmitFilmmaker } from '@workspace/api-client-react';
import type { FilmmakerSubmissionInput } from '@workspace/api-client-react';
import { useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { useAuth } from '@workspace/replit-auth-web';
import { showGuestConfirmation } from '@/lib/filmmaker-confirmation';
import { LocationPicker } from '../components/location-picker';
import { calculateDeal, examples, money, phase, restoreWorksheet, standardOffer, validListedOffer, type Format, type Stage } from './filmmaker-calculator';

type Answers = {
  stage: Stage | null; no_project_yet: boolean;
  title: string; format: Format; genre: FilmmakerSubmissionInput['genre'] | ''; genre_other: string; logline: string; trailer_url: string; pilot_url: string;
  budget: number; budget_mode: 'example' | 'custom'; deal_answer: 'yes' | 'maybe' | 'no' | null;
  offer_per100: number | null; offer_choice: string; offer_other_text: string; wants_lower: boolean;
  payback_terms: 'works' | 'need_some' | 'other' | null; payback_terms_other: string;
  funding_sources: string[]; funding_other: string; reached_goal: boolean | null; funding_experience: string;
  name: string; email: string; phone: string; city: string; state: string; country: string; location_manual: boolean; favorite_genres: string[]; chat_opt_in: boolean;
};
const initial: Answers = {
  stage:null, no_project_yet:false, title:'', format:'movie', genre:'', genre_other:'', logline:'', trailer_url:'', pilot_url:'',
  budget:0, budget_mode:'example', deal_answer:null, offer_per100:null, offer_choice:'', offer_other_text:'', wants_lower:false,
  payback_terms:null, payback_terms_other:'', funding_sources:[], funding_other:'', reached_goal:null, funding_experience:'',
  name:'', email:'', phone:'', city:'', state:'', country:'', location_manual:false, favorite_genres:[], chat_opt_in:false,
};
const genres = ['Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Other'] as const;
const funding = ['Own money','Friends & family','Kickstarter / Indiegogo / Seed&Spark','Grants','Investors','Studios','Haven’t yet','Other'];
const headings = ['Where’s your project at?','Your project','Your deal','Your offer to investors','How did you finance your last project?','Almost done'];
const descriptions = [
  'Every project starts in a different place. Tell us where yours stands today.',
  'A few details help us understand the film or show you have in mind. This is not a public listing.',
  'Take a look at an illustrative budget and tell us whether this structure feels workable.',
  'There is room to tell us what you would want. Nothing here creates an offer or obligation.',
  'What has the path to financing looked like for you so far?',
  'Leave a way to reach you. We’ll use this to follow up about this early-stage exploration.',
];

function Choice({ selected, onClick, children, id, name, multiple = false, detail }: { selected:boolean; onClick:()=>void; children:ReactNode; id:string; name:string; multiple?:boolean; detail?:string }) {
  return <label data-testid={`button-${id}`} className={`fm-choice ${selected ? 'selected' : ''} ${multiple ? 'is-multiple' : ''}`}>
    <span>{children}{detail && <small>{detail}</small>}</span>
    <input className="fm-choice-input" data-testid={`input-${id}`} type={multiple ? 'checkbox' : 'radio'} name={name} checked={selected} onChange={onClick} />
    <span aria-hidden="true" className="fm-choice-mark" />
  </label>;
}
function Field({ label, id, value, onChange, required=false, type='text', placeholder='', multiline=false }: { label:string; id:string; value:string; onChange:(v:string)=>void; required?:boolean; type?:string; placeholder?:string; multiline?:boolean }) {
  return <div className="fm-field"><label htmlFor={id} className="fm-label">{label}{!required && <span className="fm-small"> · optional</span>}</label>
    {multiline ? <textarea id={id} data-testid={`input-${id}`} className="fm-input" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} /> :
      <input id={id} data-testid={`input-${id}`} className="fm-input" value={value} onChange={e=>onChange(e.target.value)} type={type} placeholder={placeholder} required={required} />}
  </div>;
}
function validUrl(value:string) { if (!value.trim()) return true; try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
function payload(a:Answers):FilmmakerSubmissionInput {
  const contact = { no_project_yet:a.no_project_yet, name:a.name.trim(), email:a.email.trim(), phone:a.phone.trim() || undefined, city:a.city.trim(), state:a.state.trim() || undefined, country:a.country || undefined, favorite_genres:a.favorite_genres, chat_opt_in:a.chat_opt_in };
  if (a.no_project_yet) return contact;
  return {
    ...contact, stage:a.stage ?? undefined,
    title:a.title.trim(), format:a.format, genre:a.genre || undefined, genre_other:a.genre === 'Other' ? a.genre_other.trim() : undefined,
    logline:a.logline.trim(), trailer_url:a.trailer_url.trim() || undefined, pilot_url:a.stage === 'production' ? a.pilot_url.trim() || undefined : undefined,
    budget:a.budget, budget_from_example:a.budget_mode === 'example', deal_answer:a.deal_answer ?? undefined,
    offer_per100:a.wants_lower ? 125 : a.offer_per100 ?? undefined, offer_other_text:a.offer_choice === 'other' ? a.offer_other_text.trim() : undefined,
    wants_lower:a.wants_lower, payback_terms:a.payback_terms ?? undefined, payback_terms_other:a.payback_terms === 'other' ? a.payback_terms_other.trim() : undefined,
    funding_sources:a.funding_sources, funding_other:a.funding_sources.includes('Other') ? a.funding_other.trim() : undefined,
    reached_goal:a.reached_goal ?? undefined, funding_experience:a.funding_experience.trim(),
  };
}

export default function Filmmaker() {
  const replitAuth = useAuth();
  const firebaseUser = useFirebaseUser();
  const identityId = replitAuth.user?.id ?? firebaseUser?.uid ?? 'visitor';
  return <FilmmakerWorksheet key={identityId} identityId={identityId} authLoading={replitAuth.isLoading} />;
}

function FilmmakerWorksheet({ identityId, authLoading }: { identityId: string; authLoading: boolean }) {
  const [, navigate] = useLocation();
  const authReady = useFirebaseSessionReady();
  const user = useFirebaseUser();
  const completedResult = useGetFilmmakerResult({ query:{ queryKey:[...getGetFilmmakerResultQueryKey(),identityId], enabled:authReady && !authLoading, retry:(count,error)=>error.status !== 404 && count < 2 } });
  useEffect(() => { if (completedResult.data?.completed) navigate('/start/filmmaker/done'); }, [completedResult.data?.completed, navigate]);
  const progress = useGetFlowProgress('filmmaker', { query:{ queryKey:[...getGetFlowProgressQueryKey('filmmaker'),identityId], enabled:authReady && !authLoading, retry:(count,error)=>error.status !== 404 && count < 2 } });
  useEffect(() => {
    if (identityId !== 'visitor' && authReady && !authLoading && completedResult.error?.status === 404 && progress.error?.status === 404) navigate('/me/projects');
  }, [identityId, authReady, authLoading, completedResult.error, progress.error, navigate]);
  const group = useGetPriceGroup();
  const draftHeaders: Record<string, string> = progress.data?.draft_id ? { 'X-MSI-Draft-Id': String(progress.data.draft_id) } : {};
  const save = useSaveFlowProgress({ request: { headers: draftHeaders } });
  const submit = useSubmitFilmmaker({ request: { headers: draftHeaders } });
  const [a, setA] = useState<Answers>(initial);
  const [screen, setScreen] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [validation, setValidation] = useState('');
  const [saving, setSaving] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const screenRef = useRef(1);
  const answersRef = useRef(a);
  const lastSaved = useRef('');
  const initialized = useRef(false);
  const editTimer = useRef<number | null>(null);
  answersRef.current = a;
  screenRef.current = screen;

  useEffect(() => {
    if (!progress.data || initialized.current) return;
    initialized.current = true;
    const { stage_other:legacyStageOther, ...savedAnswers } = progress.data.answers;
    void legacyStageOther;
    const { answers:restored, screen:restoredScreen } = restoreWorksheet(initial, savedAnswers, progress.data.last_screen);
    const legacyStage = (restored as unknown as Record<string, unknown>).stage === 'other';
    const recovered = legacyStage ? { ...restored, stage:null } : restored;
    const recoveredScreen = legacyStage ? 1 : restoredScreen;
    setA(recovered);
    setScreen(recoveredScreen);
    if (progress.data.completed) {
      navigate('/start/filmmaker/done');
    } else {
      lastSaved.current = legacyStage ? '' : JSON.stringify({ screen:recoveredScreen, answers:recovered });
      setHydrated(true);
    }
  }, [progress.data, navigate]);
  useEffect(() => {
    // An untouched visitor has no progress row. The API deliberately returns 404.
    if (identityId === 'visitor' && progress.isError && progress.error?.status === 404 && !initialized.current) {
      initialized.current = true;
      setHydrated(true);
    }
  }, [identityId, progress.isError, progress.error]);

  function change<K extends keyof Answers>(key:K, value:Answers[K]) {
    setA(current => ({ ...current, [key]:value }));
    setValidation('');
  }
  function persist(nextScreen:number, answers:Answers) {
    const serialized = JSON.stringify({ screen:nextScreen, answers });
    setSaving(true);
    const operation = queue.current.catch(() => undefined).then(() =>
      save.mutateAsync({ data:{ flow:'filmmaker', last_screen:nextScreen, answers } })
    );
    queue.current = operation;
    operation.then(() => {
      lastSaved.current = serialized;
      setSaveError('');
    }).catch((error: unknown) => {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      setSaveError(status === 409 || status === 403 || status === 404
        ? 'This draft is no longer selected for this visit. Copy any unsaved answers, then open My projects to resume the draft or start another project.'
        : 'Your changes could not be saved. Please try again.');
    }).finally(() => {
      if (queue.current === operation) setSaving(false);
    });
    return operation;
  }
  useEffect(() => {
    if (!hydrated || authLoading) return;
    const snapshot = JSON.stringify({ screen, answers:a });
    if (snapshot === lastSaved.current) return;
    editTimer.current = window.setTimeout(() => { editTimer.current = null; void persist(screen, a).catch(() => undefined); }, 800);
    return () => { if (editTimer.current !== null) window.clearTimeout(editTimer.current); editTimer.current = null; };
    // Deliberately schedule only when answers/screen change; mutation objects are unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, screen, hydrated, authLoading]);
  const stage = a.stage ?? 'idea';
  const budgetOptions = examples(stage, a.format);
  const budget = Number.isSafeInteger(a.budget) && a.budget > 0 ? a.budget : 0;
  const standard = standardOffer(stage);
  const receipt = group.data ? calculateDeal(budget, stage, group.data.group, screen === 4 ? (a.wants_lower ? 125 : a.offer_per100 ?? standard) : standard) : null;
  const budgetValid = Number.isSafeInteger(a.budget) && a.budget > 0;
  const otherOfferError = a.offer_choice === 'other' && !a.wants_lower && a.offer_other_text.trim() !== '' && (!Number.isSafeInteger(Number(a.offer_other_text)) || Number(a.offer_other_text) < 125);
  const afterPayback = receipt && (phase(stage) === 'idea' ? 'you keep it all' : `You keep ${money(receipt.filmmakerAfter)} of every $100`);

  function validateStep(step:number):string {
    if (step === 1 && !a.stage) return 'Choose a project stage to continue.';
    if (step === 2 && !a.no_project_yet) {
      if (!a.title.trim() || !a.genre || !a.logline.trim() || (a.genre === 'Other' && !a.genre_other.trim())) return 'Add a title, genre and logline to continue.';
      if (!validUrl(a.trailer_url) || !validUrl(a.pilot_url)) return 'Use a full http:// or https:// link for your video URLs.';
    }
    if (step === 3 && (!budgetValid || !a.deal_answer)) return 'Choose a positive whole-dollar budget and tell us how the example deal feels.';
    if (step === 4 && (!a.offer_choice || !validListedOffer(a.offer_per100) || (a.offer_choice === 'other' && !a.wants_lower && (!a.offer_other_text.trim() || otherOfferError)) || !a.payback_terms || (a.payback_terms === 'other' && !a.payback_terms_other.trim()))) return 'Choose an offer of at least $125 per $100 and answer the payback question.';
    if (step === 5 && (a.funding_sources.length === 0 || (a.funding_sources.includes('Other') && !a.funding_other.trim()) || a.reached_goal === null || !a.funding_experience.trim())) return 'Tell us how you funded work, whether you reached your goal, and what happened.';
    if (step === 6 && (!a.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || !a.city.trim() || !a.country || a.favorite_genres.length === 0)) return 'Add your name, a valid email, city and country, and at least one favorite genre. Choose a city from the suggestions or enter your location manually.';
    return '';
  }
  async function advance(next:number, updated=a) {
    const error = validateStep(screen);
    if (error) { setValidation(error); return; }
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    try {
      await persist(next, updated);
      setScreen(next);
      window.scrollTo({ top:0, behavior:'smooth' });
    } catch { /* save error remains visible; stay on current screen */ }
  }
  async function back() {
    const next = a.no_project_yet && screen === 6 ? 2 : Math.max(1, screen - 1);
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    try { await persist(next, a); setScreen(next); window.scrollTo({ top:0, behavior:'smooth' }); } catch { /* stay here */ }
  }
  async function finish() {
    if (submit.isPending) return;
    const error = validateStep(6);
    if (error) { setValidation(error); return; }
    setValidation('');
    setSaveError('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    try {
      await persist(6, a);
      await submit.mutateAsync({ data:payload(a) });
      if (identityId === 'visitor') showGuestConfirmation();
      navigate('/start/filmmaker/done');
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      setSaveError(status === 409 || status === 403 || status === 404
        ? 'This draft is no longer selected for this visit. Copy any unsaved answers, then open My projects to resume the draft or start another project.'
        : 'We could not submit your information. Nothing has been confirmed. Please try again.');
    }
  }
  function selectStage(value:Stage) {
    const next = { ...a, stage:value, budget:examples(value,a.format)[0], budget_mode:'example' as const, offer_per100:null, offer_choice:'', wants_lower:false };
    setA(next);
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    void persist(2, next).then(() => { setScreen(2); window.scrollTo({ top:0, behavior:'smooth' }); }).catch(() => undefined);
  }
  function chooseNoProject(checked:boolean) {
    const next = { ...a, no_project_yet:checked };
    setA(next);
    setValidation('');
    if (checked) {
      if (editTimer.current !== null) window.clearTimeout(editTimer.current);
      void persist(6, next).then(() => { setScreen(6); window.scrollTo({ top:0, behavior:'smooth' }); }).catch(() => undefined);
    }
  }
  function toggleArray(key:'funding_sources'|'favorite_genres', item:string) {
    setA(current => ({ ...current, [key]:current[key].includes(item) ? current[key].filter(x=>x!==item) : [...current[key],item] }));
    setValidation('');
  }
  const displayReceipt = (offerScreen:boolean) => receipt && <div className="fm-receipt" data-testid="receipt-deal">
    <h3>At a glance</h3><dl>
      <div><dt>You raise · illustrative project budget</dt><dd data-testid="text-budget">{money(budget)}</dd></div>
      <div><dt>Investor payback target · {money(offerScreen ? a.wants_lower ? 125 : a.offer_per100 ?? standard : standard)} per $100 of budget</dt><dd data-testid="text-investor-target">{money(receipt.investorTarget)}</dd></div>
      <div><dt>Platform fee · {money(receipt.feeRate)} per $100 of budget</dt><dd data-testid="text-platform-fee">{money(receipt.platformFee)}</dd></div>
      <div className="fm-total"><dt>Combined payback threshold</dt><dd data-testid="text-combined-payback">{money(receipt.combinedPayback)}</dd></div>
      <div><dt>After both targets are satisfied</dt><dd data-testid="text-filmmaker-share">{afterPayback}</dd></div>
    </dl>
    <p className="fm-small" style={{marginTop:12}}>Illustrative terms for conversation only. The investor target and platform fee are separate amounts. This is not a return forecast or an offer to invest.</p>
  </div>;
  const budgetTabs = <div>
    <p className="fm-label">Choose a budget to explore</p>
    <div className="fm-tabs" role="group" aria-label="Budget type">
      <button type="button" data-testid="button-example-budget" className={a.budget_mode === 'example' ? 'active' : ''} aria-pressed={a.budget_mode === 'example'} onClick={()=>setA(current=>({...current,budget_mode:'example',budget:examples(stage,current.format).includes(current.budget) ? current.budget : examples(stage,current.format)[0]}))}>Example budget</button>
      <button type="button" data-testid="button-your-budget" className={a.budget_mode === 'custom' ? 'active' : ''} aria-pressed={a.budget_mode === 'custom'} onClick={()=>setA(current=>({...current,budget_mode:'custom',budget:current.budget || examples(stage,current.format)[0]}))}>Your budget</button>
    </div>
    {a.budget_mode === 'example' ? <div className="fm-amounts">{budgetOptions.map(value=><Choice key={value} id={`budget-${value}`} name="example-budget" selected={a.budget===value} onClick={()=>change('budget',value)}>{money(value)}</Choice>)}</div> :
      <div className="fm-field"><label htmlFor="custom-budget" className="fm-label">Your estimated budget · USD</label><input id="custom-budget" data-testid="input-custom-budget" className="fm-input" inputMode="numeric" value={a.budget ? a.budget.toLocaleString('en-US') : ''} onChange={e=>{ const raw=e.target.value.replace(/,/g,''); if (/^\d*$/.test(raw)) change('budget',raw ? Number(raw) : 0); }} aria-invalid={!budgetValid} />{!budgetValid && <p className="fm-error" role="alert">Enter a positive whole-dollar amount.</p>}</div>}
  </div>;

  if (authLoading || completedResult.isLoading || progress.isLoading || group.isLoading || completedResult.data?.completed || !hydrated && !progress.isError) return <section className="fm"><div className="page-wrap" style={{padding:'70px 0 140px'}} aria-label="Loading saved answers"><p className="fm-kicker">Opening your worksheet</p><div className="fm-skeleton" style={{maxWidth:440,height:75}}/><div className="fm-skeleton" style={{maxWidth:310}}/><div className="fm-skeleton" style={{maxWidth:600,height:190}}/></div></section>;
  if (completedResult.isError && completedResult.error?.status !== 404 || progress.isError && progress.error?.status !== 404 || group.isError || !group.data) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Connection interrupted</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>We can’t open your worksheet yet.</h1><p className="fm-small">Your previous answers and pricing group need to load before you continue. Please try again.</p><button type="button" data-testid="button-retry-loading" className="fm-primary" style={{marginTop:30}} onClick={()=>{ void completedResult.refetch(); void progress.refetch(); void group.refetch(); }}><RotateCcw size={17}/> Try again</button></div></section>;
  if (identityId !== 'visitor' && progress.error?.status === 404) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Choose a project</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>Your draft isn’t selected.</h1><p className="fm-small">Open My projects to resume a saved draft or start another project. No project was changed.</p><Link href="/me/projects" data-testid="link-select-filmmaker-draft" className="fm-primary" style={{marginTop:30}}>My projects <ArrowRight size={17}/></Link></div></section>;
  return <section className="fm"><div className="page-wrap">
    <div className="fm-top"><Link href="/" data-testid="link-flow-home" className="fm-kicker">Movie Show Investing / Filmmakers</Link><span className="fm-kicker" data-testid="text-progress">Step {screen} of 6</span></div>
    <div className="fm-progress" aria-label={`Step ${screen} of 6`}>{headings.map((heading,i)=><span key={heading} className={i<screen ? 'active' : ''} title={`Step ${i+1}: ${heading}`}/>)}</div>
    <div className="fm-layout">
      <div className="fm-intro" key={`intro-${screen}`}><p className="fm-kicker">The filmmaker worksheet / 0{screen}</p><h1 data-testid="text-flow-heading">{headings[screen-1]}</h1><p>{a.no_project_yet && screen===6 ? 'No project details needed. Just leave a way to reach you if you’d like to be part of what comes next.' : descriptions[screen-1]}</p><div className="fm-note">This is an early conversation, not an application for funding. No money is collected and nothing here commits you to a deal.</div></div>
      <div className="fm-panel" key={`panel-${screen}`}>
        {screen === 1 && <><div className="fm-choice-list">
          <Choice id="stage-distribution" name="project-stage" selected={a.stage==='distribution'} onClick={()=>selectStage('distribution')} detail="A finished film looking toward release.">Distribution phase</Choice>
          <Choice id="stage-production" name="project-stage" selected={a.stage==='production'} onClick={()=>selectStage('production')} detail="A short or pilot you want to make next.">Short or pilot I want to develop</Choice>
          <Choice id="stage-idea" name="project-stage" selected={a.stage==='idea'} onClick={()=>selectStage('idea')} detail="The story is taking shape.">Script or idea</Choice>
        </div></>}
        {screen === 2 && <><label className="fm-check fm-section"><input type="checkbox" data-testid="checkbox-no-project" checked={a.no_project_yet} disabled={saving} onChange={e=>chooseNoProject(e.target.checked)}/><span><strong>I don’t have a project yet. I want to participate in the future.</strong><small style={{display:'block',color:'#666',marginTop:5}}>Skip the project and deal questions. We’ll only ask how to reach you.</small></span></label>
          {!a.no_project_yet && <>
            <Field id="project-title" label="Working title" value={a.title} onChange={v=>change('title',v)} required placeholder="Even a working title is fine"/>
             <div className="fm-field"><p className="fm-label">Format</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{(['movie','show'] as const).map(value=><Choice id={`format-${value}`} name="project-format" key={value} selected={a.format===value} onClick={()=>setA(current=>({...current,format:value,budget:current.budget_mode==='example' ? examples(stage,value)[0] : current.budget}))}>{value==='movie'?'Movie':'Show'}</Choice>)}</div></div>
             <div className="fm-field"><p className="fm-label">Genre</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{genres.map(g=><Choice id={`genre-${g}`} name="project-genre" key={g} selected={a.genre===g} onClick={()=>change('genre',g)}>{g}</Choice>)}</div></div>
            {a.genre==='Other' && <Field id="genre-other" label="Describe your genre" value={a.genre_other} onChange={v=>change('genre_other',v)} required/>}
            <Field id="logline" label="Logline" value={a.logline} onChange={v=>change('logline',v)} required multiline placeholder="The story, in a sentence or two"/>
            <Field id="trailer-url" label="Trailer URL" value={a.trailer_url} onChange={v=>change('trailer_url',v)} type="url" placeholder="https://"/>
            {a.stage==='production' && <Field id="pilot-url" label="Short or pilot URL" value={a.pilot_url} onChange={v=>change('pilot_url',v)} type="url" placeholder="https://"/>}
          </>}
        </>}
        {screen === 3 && <>{budgetTabs}{displayReceipt(false)}<div className="fm-section"><p className="fm-label">Would you consider a deal like this?</p><div className="fm-choice-list">
           {([['yes','Yes, I’d take it'],['maybe','Maybe if I could negotiate'],['no','No, not at these terms']] as const).map(([value,label])=><Choice id={`deal-${value}`} name="deal-answer" key={value} selected={a.deal_answer===value} onClick={()=>setA(current=>({...current,deal_answer:value,offer_choice:value==='yes'?'standard':'',offer_per100:value==='yes'?standard:null,wants_lower:false}))}>{label}</Choice>)}
        </div></div></>}
        {screen === 4 && <>{budgetTabs}<div className="fm-section"><p className="fm-kicker">Standard for {phase(stage)==='idea'?'Idea':phase(stage)==='production'?'Production':'Distribution'}</p><h2 className="serif" style={{fontSize:38,margin:'10px 0 9px'}}>{money(standard)} per $100</h2><p className="fm-small">For each $100 of project budget, this is the illustrative investor payback target before the platform fee.</p></div>
          <div className="fm-section"><p className="fm-label">What would you offer instead?</p><div className="fm-choice-list">
             <Choice id="offer-standard" name="investor-offer" selected={a.offer_choice==='standard' && !a.wants_lower} onClick={()=>setA(current=>({...current,offer_choice:'standard',offer_per100:standard,wants_lower:false}))}>Standard · {money(standard)} per $100</Choice>
             {[125,150,175,200].map(value=><Choice id={`offer-${value}`} name="investor-offer" key={value} selected={a.offer_choice===String(value) && !a.wants_lower} onClick={()=>setA(current=>({...current,offer_choice:String(value),offer_per100:value,wants_lower:false}))}>{money(value)} per $100</Choice>)}
             <Choice id="offer-other" name="investor-offer" selected={a.offer_choice==='other' && !a.wants_lower} onClick={()=>setA(current=>({...current,offer_choice:'other',offer_per100:current.offer_other_text ? Number(current.offer_other_text) : null,wants_lower:false}))}>Other amount</Choice>
          </div>
          {a.offer_choice==='other' && !a.wants_lower && <div className="fm-field" style={{marginTop:18}}><label htmlFor="offer-other-amount" className="fm-label">Amount per $100</label><input id="offer-other-amount" data-testid="input-offer-other-amount" className="fm-input" inputMode="numeric" value={a.offer_other_text} onChange={e=>{ if (/^\d*$/.test(e.target.value)) setA(current=>({...current,offer_other_text:e.target.value,offer_per100:e.target.value?Number(e.target.value):null})); }} aria-invalid={otherOfferError}/>{otherOfferError && <p className="fm-error" role="alert">The minimum listed offer is $125 per $100. If you want less, select the option below.</p>}</div>}
          <label className="fm-check"><input type="checkbox" data-testid="checkbox-wants-lower" checked={a.wants_lower} onChange={e=>setA(current=>({...current,wants_lower:e.target.checked,offer_choice:e.target.checked?'125':'',offer_per100:e.target.checked?125:null}))}/><span>I’d want to offer less than $125 per $100. Please note my preference.<small style={{display:'block',color:'#686b69'}}>For this worksheet, the listed and saved offer stays at $125.</small></span></label></div>
          {displayReceipt(true)}
          {receipt && <div className="fm-phases" aria-label="Illustrative two-phase receipt allocation">
            <div className="fm-phase">
              <p className="fm-kicker">Phase 1 / Payback pool</p>
              <h3>Until {money(receipt.combinedPayback)} is paid back</h3>
              <p>All available receipts after processing fees go into a pool allocated proportionally between the outstanding investor payback target ({money(receipt.investorTarget)}) and the separate platform fee ({money(receipt.platformFee)}). Neither has payment priority. The combined amount does not all go to investors.</p>
              <p className="fm-phase-example" data-testid="text-illustrative-months">At a hypothetical $10,000/month of available receipts, that is roughly {Math.round(receipt.combinedPayback / 10000)} months.</p>
            </div>
            <div className="fm-phase">
              <p className="fm-kicker">Phase 2 / After payback</p>
              <h3 data-testid="text-phase-two-share">{afterPayback}</h3>
              <p>Once both targets are satisfied, this is your illustrative share of each $100 of subsequent available receipts.{phase(stage) === 'distribution' ? ' For example, that would be $6,700 of each $10,000.' : ''}</p>
            </div>
            <p className="fm-small fm-phase-disclaimer">These are examples, not forecasts or guarantees. Actual receipts may differ, and the payback threshold may never be reached.</p>
          </div>}
          <div className="fm-section"><p className="fm-label">How do those payback terms feel?</p><div className="fm-choice-list">
             <Choice id="payback-works" name="payback-terms" selected={a.payback_terms==='works'} onClick={()=>change('payback_terms','works')}>Works for me</Choice>
             <Choice id="payback-need-some" name="payback-terms" selected={a.payback_terms==='need_some'} onClick={()=>change('payback_terms','need_some')}>I need some from day one</Choice>
             <Choice id="payback-other" name="payback-terms" selected={a.payback_terms==='other'} onClick={()=>change('payback_terms','other')}>Other</Choice>
          </div>{a.payback_terms==='other' && <div style={{marginTop:18}}><Field id="payback-other" label="Tell us what you’d need" value={a.payback_terms_other} onChange={v=>change('payback_terms_other',v)} required multiline/></div>}</div>
        </>}
         {screen === 5 && <><p className="fm-label">Where have you looked for funding? Select all that apply.</p><div className="fm-choice-list">{funding.map(source=><Choice id={`funding-${source.replace(/\W+/g,'-').toLowerCase()}`} name="funding-source" multiple key={source} selected={a.funding_sources.includes(source)} onClick={()=>toggleArray('funding_sources',source)}>{source}</Choice>)}</div>
          {a.funding_sources.includes('Other') && <div className="fm-section"><Field id="funding-other" label="Other funding source" value={a.funding_other} onChange={v=>change('funding_other',v)} required/></div>}
           <div className="fm-section"><p className="fm-label">Did you reach your goal?</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><Choice id="goal-yes" name="funding-goal" selected={a.reached_goal===true} onClick={()=>change('reached_goal',true)}>Yes</Choice><Choice id="goal-no" name="funding-goal" selected={a.reached_goal===false} onClick={()=>change('reached_goal',false)}>No</Choice></div></div>
          <div className="fm-section"><Field id="funding-experience" label="What was your experience?" value={a.funding_experience} onChange={v=>change('funding_experience',v)} required multiline placeholder="What worked, what didn’t, or what you wish had been different"/></div>
        </>}
        {screen === 6 && <>{a.no_project_yet && <div className="fm-note">You’re joining the conversation without a project. We won’t ask for a budget or deal terms.</div>}
          <Field id="name" label="Your name" value={a.name} onChange={v=>change('name',v)} required/>
          <Field id="email" label="Email address" value={a.email} onChange={v=>change('email',v)} type="email" required/>
          <Field id="phone" label="Phone number" value={a.phone} onChange={v=>change('phone',v)} type="tel"/>
          <LocationPicker value={{ city:a.city, state:a.state, country:a.country, location_manual:a.location_manual }}
            onChange={location=>{ setA(current=>({...current,...location})); setValidation(''); }} />
           <div className="fm-section"><p className="fm-label">Favorite genres · select any</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{genres.map(g=><Choice id={`favorite-${g}`} name="favorite-genre" multiple key={g} selected={a.favorite_genres.includes(g)} onClick={()=>toggleArray('favorite_genres',g)}>{g}</Choice>)}</div></div>
          <label className="fm-check fm-section"><input type="checkbox" data-testid="checkbox-chat-opt-in" checked={a.chat_opt_in} onChange={e=>change('chat_opt_in',e.target.checked)}/><span>I’m open to a quick 15-minute chat about my experience.</span></label>
          <p className="fm-small">By submitting, you’re sharing information with Movie Show Investing for its launch MVP. This does not create a project listing or an investment opportunity. See our <Link href="/privacy" className="underline" data-testid="link-flow-privacy">privacy policy</Link>.</p>
        </>}
        {validation && <p className="fm-error" data-testid="error-validation" role="alert">{validation}</p>}
        {saveError && <div className="fm-error" data-testid="error-save" role="alert">{saveError} {saveError.startsWith('This draft') ? <Link href="/me/projects" data-testid="link-reselect-draft">My projects</Link> : <button type="button" data-testid="button-retry-save" className="underline" onClick={()=>void persist(screenRef.current,answersRef.current).catch(()=>undefined)}>Retry save</button>}</div>}
        <div className="fm-steps">
          {screen>1 ? <button type="button" data-testid="button-back" className="fm-back" disabled={saving || submit.isPending} onClick={()=>void back()}><ArrowLeft size={17}/> Back</button> : <span className="fm-small">Your answers save as you go.</span>}
          {screen===1 && !a.stage ? <span className="fm-small">Choose a stage to continue</span> :
            <button type="button" data-testid={screen===6?'button-submit-filmmaker':'button-continue'} className="fm-primary" disabled={saving || submit.isPending || screen===4 && (otherOfferError || !a.offer_choice || !validListedOffer(a.offer_per100))} onClick={()=>screen===6 ? void finish() : void advance(a.no_project_yet && screen===2 ? 6 : screen+1)}>
              {submit.isPending ? 'Submitting…' : saving ? 'Saving…' : screen===6 ? 'Send my answers' : 'Continue'} {!submit.isPending && <ArrowRight size={17}/>}
            </button>}
        </div>
        <p className="fm-status" role="status" data-testid="status-save" style={{marginTop:15}}>{saveError ? 'Changes not saved' : saving ? 'Saving your answers…' : lastSaved.current === JSON.stringify({screen,answers:a}) ? 'All changes saved' : 'Changes save automatically'}</p>
      </div>
    </div>
  </div></section>;
}
