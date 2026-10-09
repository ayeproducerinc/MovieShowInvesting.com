import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { recordPitchForReview, storePitchReviewProof } from '@/lib/pitch-review-intent';
import { saveFlowProgress } from '@workspace/api-client-react';
import { FilmmakerStartOver } from '@/components/filmmaker-start-over';
import { setFilmmakerAction } from '@/lib/filmmaker-intent';
import { getGetFilmmakerResultQueryKey, getGetFilmmakerSubmissionConfigQueryKey, getGetFlowProgressQueryKey, useClaimFilmmakerProject, useConfirmAge, useGetFilmmakerResult, useGetFilmmakerSubmissionConfig, useGetFlowProgress, useGetPriceGroup, useSubmitFilmmaker } from '@workspace/api-client-react';
import type { FilmmakerProposalInput, FilmmakerSubmissionInput } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { DraftPitchMaterials, UnsavedMaterialError, UNSAVED_MATERIAL_MESSAGE, type DraftPitchMaterialsHandle } from '@/components/draft-pitch-materials';
import {
  clearFilmmakerAuthHandoff,
  isFilmmakerDraftLinked,
  registerFilmmakerAuthPreparationProvider,
  readFilmmakerAuthHandoff,
  rememberFilmmakerDraftLinked,
  waitForFilmmakerAuthHandoff,
  type FilmmakerAuthHandoff,
} from '@/lib/filmmaker-auth-handoff';
import { AgeAcknowledgment, useAgeStatus } from '@/components/age-acknowledgment';
import { LocationPicker } from '../components/location-picker';
import { MonthYearField } from '@/components/month-year-field';
import { MAX_BUDGET, BACKEND_EXAMPLE, EARLY_EXAMPLE, FLOW_VERSION, REVENUE_BASIS_NOTE, STANDARD_BACKEND, calculateDeal, examples, filmmakerDestination, money, parseCustomProposal, phase, platformFeePercent, restoreWorksheet, standardOffer, type Format, type Stage } from './filmmaker-calculator';

type Answers = {
  legacy_terms_review_required?: boolean;
  stage: Stage | null; no_project_yet: boolean;
  title: string; format: Format; genre: FilmmakerSubmissionInput['genre'] | ''; genre_other: string; logline: string; trailer_url: string; pilot_url: string;
  budget: number; budget_mode: 'example' | 'custom'; deal_answer: 'yes' | 'maybe' | 'no' | null;
  offer_per100: number | null; offer_choice: string; offer_other_text: string; wants_lower: boolean;
  payback_terms: 'works' | 'need_some' | 'other' | null; payback_terms_other: string;
  funding_sources: string[]; funding_other: string; reached_goal: boolean | null; funding_experience: string;
  flow_version:number; age_confirmed:boolean; decision:'standard'|'negotiation'|null; p_repayment:string; p_investor:string; p_years:string; p_early_on:boolean; p_early:string; p_note:string; original_suggestion:number|null;
  name: string; email: string; phone: string; city: string; state: string; country: string; location_manual: boolean; favorite_genres: string[]; chat_opt_in: boolean;
  team_info: string; team_links_text: string; distribution_plan: string; money_use: string; show_team: boolean | null; show_dist: boolean | null; show_money: boolean | null;
  development_amount: string; filming_start_month: string; filming_start_skipped: boolean; money_needed_by_month: string; money_needed_by_skipped: boolean;
  crowdfunding_ran: boolean | null; crowdfunding_campaign: string; crowdfunding_same_project: boolean | null; crowdfunding_goal: string; crowdfunding_raised: string; crowdfunding_obligations: string;
};
const initial: Answers = {
  stage:null, no_project_yet:false, title:'', format:'movie', genre:'', genre_other:'', logline:'', trailer_url:'', pilot_url:'',
  budget:0, budget_mode:'example', deal_answer:null, offer_per100:null, offer_choice:'', offer_other_text:'', wants_lower:false,
  payback_terms:null, payback_terms_other:'', funding_sources:[], funding_other:'', reached_goal:null, funding_experience:'',
  flow_version:FLOW_VERSION, age_confirmed:false, decision:null, p_repayment:'', p_investor:'50', p_years:'5', p_early_on:false, p_early:String(EARLY_EXAMPLE), p_note:'', original_suggestion:null,
  name:'', email:'', phone:'', city:'', state:'', country:'', location_manual:false, favorite_genres:[], chat_opt_in:false,
  team_info:'', team_links_text:'', distribution_plan:'', money_use:'', show_team:null, show_dist:null, show_money:null,
  development_amount:'', filming_start_month:'', filming_start_skipped:false, money_needed_by_month:'', money_needed_by_skipped:false,
  crowdfunding_ran:null, crowdfunding_campaign:'', crowdfunding_same_project:null, crowdfunding_goal:'', crowdfunding_raised:'', crowdfunding_obligations:'',
};
const genres = ['Horror','Drama','Comedy','Thriller','Documentary','Sci-Fi','Romance','Action','Animation','Other'] as const;
const funding = ['Own money','Friends & family','Kickstarter / Indiegogo / Seed&Spark','Grants','Investors','Studios','Haven’t yet','Other'];
const headings = ['Project stage','Project & pitch','Budget & suggested repayment terms','Funding experience','Your details & submit'];
const isCrowd = (s:string) => s.startsWith('Kickstarter');
const teamLinkList = (v:string) => v.split('\n').map(x=>x.trim()).filter(Boolean);
const nonNeg = (v:string) => !v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0);
const hasFundingHistoryFor = (sources:string[]) => !(sources.length === 1 && sources.includes('Haven’t yet'));
const descriptions = [
  'Every project starts in a different place. Tell us where yours stands today.',
  'A few details help us understand the film or show you have in mind. This is not a public listing.',
  'Tell us your budget, then react to one suggested set of repayment terms. Nothing here creates an offer or obligation.',
  'What has the path to financing looked like for you so far?',
  'Leave a way to reach you, check your answers, and send them.',
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
      <input id={id} data-testid={`input-${id}`} className="fm-input" value={value} onChange={e=>onChange(e.target.value)} type={type} autoComplete={type === 'email' ? 'email' : undefined} placeholder={placeholder} required={required} />}
  </div>;
}
function validUrl(value:string) { if (!value.trim()) return true; try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
function buildProposal(a:Answers):FilmmakerProposalInput|null {
  if (!a.stage || !a.decision) return null;
  if (a.decision === 'standard') return { decision:'standard', repayment_per100:standardOffer(a.stage), investor_backend_percent:STANDARD_BACKEND.investorPercent, backend_years:STANDARD_BACKEND.years, early_filmmaker_percent:0 };
  const parsed = parseCustomProposal({ repayment:a.p_repayment, investorBackend:a.p_investor, years:a.p_years, earlyOn:a.p_early_on, early:a.p_early });
  if (!parsed.ok) return null;
  return { decision:'negotiation', repayment_per100:parsed.repayment, investor_backend_percent:parsed.investorBackend, backend_years:parsed.years, early_filmmaker_percent:parsed.early, note:a.p_note.trim() || undefined };
}
function payload(a:Answers):FilmmakerSubmissionInput {
  const contact = { no_project_yet:a.no_project_yet, age_confirmed:true as const, name:a.name.trim(), email:a.email.trim(), phone:a.phone.trim() || undefined, city:a.city.trim(), state:a.state.trim() || undefined, country:a.country || undefined, favorite_genres:a.favorite_genres, chat_opt_in:a.chat_opt_in };
  if (a.no_project_yet) return contact;
  const proposal = buildProposal(a) ?? undefined;
  const links = teamLinkList(a.team_links_text);
  const crowd = a.funding_sources.some(isCrowd) && a.crowdfunding_ran === true;
  const opt = (v:string) => v.trim() || undefined;
  const num = (v:string) => v.trim() ? Number(v) : undefined;
  const extra = {
    team_info:opt(a.team_info), team_links:links.length ? links : undefined, money_use:opt(a.money_use), distribution_plan:opt(a.distribution_plan),
    crowdfunding_ran:a.funding_sources.some(isCrowd) && a.crowdfunding_ran !== null ? a.crowdfunding_ran : undefined,
    ...(crowd ? { crowdfunding_campaign:opt(a.crowdfunding_campaign), crowdfunding_same_project:a.crowdfunding_same_project ?? undefined, crowdfunding_goal:num(a.crowdfunding_goal), crowdfunding_raised:num(a.crowdfunding_raised), crowdfunding_obligations:opt(a.crowdfunding_obligations) } : {}),
  };
  return {
    ...contact, ...extra, stage:a.stage ?? undefined,
    title:a.title.trim(), format:a.format, genre:a.genre || undefined, genre_other:a.genre === 'Other' ? a.genre_other.trim() : undefined,
    logline:a.logline.trim(), pilot_url:a.stage === 'production' ? a.pilot_url.trim() || undefined : undefined,
    budget:a.budget, budget_from_example:a.budget_mode === 'example',
    // Money date: optional and private. Only answered fields are sent; a skip is sent apart from a blank.
    // Distribution projects are already shot: no development amount or filming start.
    ...(a.stage !== 'distribution' && a.development_amount ? { development_amount:num(a.development_amount) } : {}),
    ...(a.stage !== 'distribution' && a.filming_start_skipped ? { filming_start_skipped:true } : {}),
    ...(a.stage !== 'distribution' && !a.filming_start_skipped && a.filming_start_month ? { filming_start_month:a.filming_start_month } : {}),
    ...(a.money_needed_by_skipped ? { money_needed_by_skipped:true } : {}),
    ...(!a.money_needed_by_skipped && a.money_needed_by_month ? { money_needed_by_month:a.money_needed_by_month } : {}),
    proposal, offer_per100:proposal?.repayment_per100, deal_answer:proposal ? (proposal.decision === 'standard' ? 'yes' : 'maybe') : undefined,
    payback_terms:proposal ? (proposal.early_filmmaker_percent > 0 ? 'need_some' : 'works') : undefined, wants_lower:false,
    funding_sources:a.funding_sources, funding_other:a.funding_sources.includes('Other') ? a.funding_other.trim() : undefined,
    reached_goal:hasFundingHistoryFor(a.funding_sources) ? a.reached_goal ?? undefined : undefined,
    funding_experience:hasFundingHistoryFor(a.funding_sources) ? a.funding_experience.trim() : undefined,
  };
}

function OptionalSpecifics({ a, change }: { a:Answers; change:<K extends keyof Answers>(key:K, value:Answers[K])=>void }) {
  const items = [
    { key:'show_team' as const, id:'team', label:'Do you have team information to share?', filled:Boolean(a.team_info || a.team_links_text) },
    { key:'show_dist' as const, id:'distribution', label:'Do you have a distribution plan?', filled:Boolean(a.distribution_plan) },
    { key:'show_money' as const, id:'money', label:'Do you know how the funding would be used?', filled:Boolean(a.money_use) },
  ];
  return <div className="fm-section" data-testid="section-optional-specifics">{items.map(item => {
    const open = a[item.key] ?? item.filled;
    return <div key={item.id}>
      <label className="fm-check"><input type="checkbox" data-testid={`checkbox-${item.id}`} checked={open} onChange={e=>change(item.key, e.target.checked)}/><span>{item.label}<small style={{display:'block'}} className="fm-small">Optional.{item.filled && !open ? ' Your saved details are kept; check this to see them.' : ' Unchecking hides these fields but does not delete what you saved.'}</small></span></label>
      {open && item.id==='team' && <><Field id="team-info" label="Key team" value={a.team_info} onChange={v=>change('team_info',v)} multiline placeholder="Who is attached, and what they have done"/><Field id="team-links" label="Relevant links, one per line, up to 8" value={a.team_links_text} onChange={v=>change('team_links_text',v)} multiline placeholder="https://"/></>}
      {open && item.id==='distribution' && <Field id="distribution-plan" label="Distribution plan" value={a.distribution_plan} onChange={v=>change('distribution_plan',v)} multiline/>}
      {open && item.id==='money' && <Field id="money-use" label="Planned funding use" value={a.money_use} onChange={v=>change('money_use',v)} multiline placeholder="Separate from funding you already have"/>}
    </div>;
  })}</div>;
}

export default function Filmmaker() {
  const firebaseUser = useFirebaseUser();
  const identityId = firebaseUser?.uid ?? 'visitor';
  const identityKey = firebaseUser ? `firebase:${firebaseUser.uid}` : 'visitor';
  const signedInEmail = firebaseUser?.email ?? null;
  return <FilmmakerWorksheet key={identityKey} identityId={identityId} identityKey={identityKey} signedInEmail={signedInEmail} />;
}

function FilmmakerWorksheet({ identityId, identityKey, signedInEmail }: { identityId: string; identityKey: string; signedInEmail: string | null }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const fromPricing = new URLSearchParams(window.location.search).get('new') === '1';
  const authReady = useFirebaseSessionReady();
  const completedResult = useGetFilmmakerResult({ query:{ queryKey:[...getGetFilmmakerResultQueryKey(),identityId], enabled:authReady, retry:(count,error)=>error.status !== 404 && count < 2 } });
  const completedDestination = () => fromPricing ? '/me/projects?action=start&new=1' : '/start/filmmaker/done';
  const [handoffError, setHandoffError] = useState('');
  const [pendingHandoff, setPendingHandoff] = useState<FilmmakerAuthHandoff | null>(readFilmmakerAuthHandoff);
  useEffect(() => { if (completedResult.data?.completed && !pendingHandoff) navigate(completedDestination()); }, [completedResult.data?.completed, navigate, pendingHandoff]);
  const progress = useGetFlowProgress('filmmaker', { query:{ queryKey:[...getGetFlowProgressQueryKey('filmmaker'),identityId], enabled:authReady, retry:(count,error)=>error.status !== 404 && count < 2 } });
  const progressDraftIdRef = useRef<number | null>(null);
  const worksheetDraftId = progressDraftIdRef.current ?? progress.data?.draft_id;
  const contextChanged = Boolean(progressDraftIdRef.current && progress.data?.draft_id && progressDraftIdRef.current !== progress.data.draft_id);
  const submissionConfig = useGetFilmmakerSubmissionConfig({ query:{ queryKey:getGetFilmmakerSubmissionConfigQueryKey(), retry:false, refetchOnWindowFocus:true } });
  useEffect(() => {
    if (identityId !== 'visitor' && authReady && !pendingHandoff && !handoffError
      && completedResult.error?.status === 404 && progress.error?.status === 404) {
      navigate(fromPricing ? '/me/projects?action=start&new=1' : '/me/projects');
    }
  }, [identityId, authReady, pendingHandoff, handoffError, completedResult.error, progress.error, navigate, fromPricing]);
  const group = useGetPriceGroup();
  const draftHeaders: Record<string, string> = worksheetDraftId ? { 'X-MSI-Draft-Id': String(worksheetDraftId) } : {};
  const submit = useSubmitFilmmaker({ request: { headers: draftHeaders } });
  const claimDraftId = pendingHandoff?.draftId ?? progress.data?.draft_id;
  const ageStatus = useAgeStatus();
  const confirmAgeMutation = useConfirmAge();
  const claim = useClaimFilmmakerProject({
    request: { headers: claimDraftId ? { 'X-MSI-Draft-Id': String(claimDraftId) } : {} },
  });
  const [a, setA] = useState<Answers>(initial);
  const [screen, setScreen] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [existingDraft, setExistingDraft] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [linkedDraftId, setLinkedDraftId] = useState<number | null>(null);
  const [connectingDraft, setConnectingDraft] = useState(false);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [validation, setValidation] = useState('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const screenRef = useRef(1);
  const answersRef = useRef(a);
  const lastSaved = useRef('');
  const initialized = useRef(false);
  const autoClaimStarted = useRef<number | null>(null);
  const editTimer = useRef<number | null>(null);
  const materialsRef = useRef<DraftPitchMaterialsHandle | null>(null);
  // Stable so the child reports only real error changes; an inline callback
  // re-fired on every render and wiped worksheet-level materials messages.
  const onMaterialsErrorChange = useCallback((error: string | null) => setMaterialsError(error ?? ''), []);
  const savingRef = useRef(saving);
  const materialsBusyRef = useRef(materialsBusy);
  const prepareHandoffRef = useRef<(draftId:number)=>Promise<boolean>>(async()=>false);
  answersRef.current = a;
  screenRef.current = screen;
  savingRef.current = saving;
  materialsBusyRef.current = materialsBusy;

  useEffect(() => {
    if (!progress.data || initialized.current) return;
    progressDraftIdRef.current = progress.data.draft_id ?? null;
    initialized.current = true;
    const { stage_other:legacyStageOther, ...savedAnswers } = progress.data.answers;
    void legacyStageOther;
    const { answers:restored0, screen:restoredScreen, legacy } = restoreWorksheet(initial, savedAnswers, progress.data.last_screen);
    let restored = restored0;
    if (legacy && restored.stage && !restored.no_project_yet) {
      // Preserve the historical offer; never reinterpret it as a stage default.
      const std = standardOffer(restored.stage as Stage);
      const offer = restored.wants_lower ? 125 : restored.offer_per100;
      restored = { ...restored, original_suggestion:std, decision:null, p_repayment:offer ? String(offer) : '', p_investor:'', p_years:'', legacy_terms_review_required:true };
    }
    const legacyStage = (restored as unknown as Record<string, unknown>).stage === 'other';
    const recovered = legacyStage ? { ...restored, stage:null } : restored;
    const recoveredScreen = legacyStage ? 1 : legacy && !restored.no_project_yet && restoredScreen > 3 ? 3 : restoredScreen;
    setA(recovered);
    setScreen(recoveredScreen);
    if (progress.data.completed && !pendingHandoff) {
      navigate(completedDestination());
    } else {
      setExistingDraft(fromPricing && !pendingHandoff && (recoveredScreen > 1 || Boolean(recovered.stage || recovered.no_project_yet || recovered.title || recovered.name || recovered.email)));
      lastSaved.current = legacyStage ? '' : JSON.stringify({ screen:recoveredScreen, answers:recovered });
      setHydrated(true);
    }
  }, [progress.data, navigate, pendingHandoff]);
  useEffect(() => {
    const draftId = progress.data?.draft_id;
    if (!draftId || identityId === 'visitor') {
      setLinkedDraftId(null);
      return;
    }
    setLinkedDraftId(isFilmmakerDraftLinked(identityKey, draftId) ? draftId : null);
  }, [identityId, identityKey, progress.data?.draft_id]);
  useEffect(() => {
    // An untouched visitor has no progress row. The API deliberately returns 404.
    if (identityId === 'visitor' && progress.isError && progress.error?.status === 404 && !initialized.current) {
      initialized.current = true;
      setHydrated(true);
    }
  }, [identityId, progress.isError, progress.error]);
  useEffect(() => {
    if (!pendingHandoff || identityId === 'visitor' || !authReady) return;
    let active = true;
    const connectPreparedDraft = async () => {
      if (!pendingHandoff.prepared) {
        const prepared = await waitForFilmmakerAuthHandoff(pendingHandoff.draftId);
        if (!active) return;
        if (prepared) {
          setPendingHandoff(readFilmmakerAuthHandoff());
        } else {
          clearFilmmakerAuthHandoff();
          setPendingHandoff(null);
          setHandoffError('We could not finish saving the exact browser draft before sign-in completed. Your draft remains in this browser; retry the secure account connection before submitting.');
        }
        return;
      }
      if (progress.isLoading || autoClaimStarted.current === pendingHandoff.draftId) return;
      autoClaimStarted.current = pendingHandoff.draftId;
      const refreshed = progress.data?.draft_id === pendingHandoff.draftId && !progress.error
        ? progress
        : await progress.refetch();
      if (!active) return;
      const draftId = refreshed.data?.draft_id;
      if (!draftId) {
        clearFilmmakerAuthHandoff();
        setPendingHandoff(null);
        setHandoffError('We could not verify the exact browser draft you prepared for sign-in. No draft was linked. Open My projects to resume an account draft or return to the browser that still has the saved answers.');
        return;
      }
      if (pendingHandoff.draftId !== draftId) {
        clearFilmmakerAuthHandoff();
        setPendingHandoff(null);
        setHandoffError('The selected draft changed while you were signing in, so we did not link another draft. Open My projects and select the intended worksheet.');
        return;
      }
      setConnectingDraft(true);
      setHandoffError('');
      try {
        await claim.mutateAsync();
        rememberFilmmakerDraftLinked(identityKey, draftId);
        setLinkedDraftId(draftId);
        clearFilmmakerAuthHandoff();
        setPendingHandoff(null);
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        const response = error && typeof error === 'object' && 'data' in error ? error.data : null;
        const detail = response && typeof response === 'object' && 'error' in response && typeof response.error === 'string'
          ? response.error : '';
        setHandoffError(status === 409
          ? `${detail || 'This draft could not be linked to this account.'} Keep this original browser draft; connect it here before switching projects. If this account has another unfinished pitch, finish that pitch in another browser or device first, then return here to connect this guest draft. Your answers remain saved; no draft was overwritten.`
          : status === 403 || status === 404
          ? `${detail || 'This draft could not be linked to this account.'} Your answers remain saved. Open My projects to resolve any existing account-draft conflict; no draft was overwritten.`
          : 'We could not securely link this draft. Your answers remain saved; check your connection and try again.');
        clearFilmmakerAuthHandoff();
        setPendingHandoff(null);
      } finally {
        setConnectingDraft(false);
      }
    };
    void connectPreparedDraft();
    return () => { active = false; };
  }, [pendingHandoff, identityId, identityKey, authReady, progress.data?.draft_id, progress.error, progress.isLoading, claim]);

  function change<K extends keyof Answers>(key:K, value:Answers[K]) {
    setA(current => ({ ...current, [key]:value }));
    setValidation('');
    setSubmitError('');
  }
  function updateBudget(value:number, mode=a.budget_mode) {
    setA(current => ({
      ...current,
      budget:value,
      budget_mode:mode,
      deal_answer:current.budget === value && current.budget_mode === mode ? current.deal_answer : null,
    }));
    setValidation('');
  }
  function persist(nextScreen:number, answers:Answers) {
    if (resettingRef.current) return Promise.resolve();
    const serialized = JSON.stringify({ screen:nextScreen, answers });
    setSaving(true);
    const operation = queue.current.catch(() => undefined).then(async () => {
      await saveFlowProgress({ flow:'filmmaker', last_screen:nextScreen, answers }, {
        headers: progressDraftIdRef.current ? { 'X-MSI-Draft-Id': String(progressDraftIdRef.current) } : {},
      });
      if (!progress.data?.draft_id) {
        const refreshed = await progress.refetch();
        if (!refreshed.data?.draft_id) {
          throw new Error('The saved worksheet has no confirmed draft identifier yet.');
        }
        progressDraftIdRef.current = refreshed.data.draft_id;
      }
    });
    queue.current = operation;
    operation.then(() => {
      lastSaved.current = serialized;
      setSaveError('');
    }).catch((error: unknown) => {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      setSaveError(error instanceof Error && error.message.includes('draft identifier')
        ? 'Your answers were saved, but we could not confirm the draft needed for optional materials. Try saving again before continuing.'
        : status === 409 || status === 403 || status === 404
        ? 'This draft is no longer selected for this visit. Copy any unsaved answers, then open My projects to resume the draft or start another project.'
        : 'Your changes could not be saved. Please try again.');
    }).finally(() => {
      if (queue.current === operation) setSaving(false);
    });
    return operation;
  }
  async function flushMaterials():Promise<boolean> {
    if (materialsBusy) {
      setMaterialsError('Wait for the current file upload to finish before leaving this step.');
      return false;
    }
    try {
      await materialsRef.current?.flush();
      // The unsaved-file notice is resolved once flush passes; keep real upload errors.
      setMaterialsError(current => current === UNSAVED_MATERIAL_MESSAGE ? '' : current);
      return true;
    } catch (error) {
      setMaterialsError(error instanceof UnsavedMaterialError ? error.message
        : 'Your optional pitch details could not be saved yet. Retry the save or remove the unfinished optional change before continuing.');
      return false;
    }
  }
  function onMaterialsBusyChange(busy:boolean) {
    materialsBusyRef.current = busy;
    setMaterialsBusy(busy);
  }
  async function prepareForAccountHandoff(draftId:number):Promise<boolean> {
    setPendingHandoff({ draftId, startedAt:Date.now(), prepared:false });
    setHandoffError('');
    for (let attempt=0; attempt<4; attempt++) {
      const currentScreen = screenRef.current;
      const currentAnswers = answersRef.current;
      if (currentScreen === 2 && !currentAnswers.no_project_yet) {
        if (materialsBusyRef.current || !await flushMaterials()) return false;
      }
      const snapshot = JSON.stringify({ screen:currentScreen, answers:currentAnswers });
      try {
        await persist(currentScreen, currentAnswers);
        const refreshed = await progress.refetch();
        if (refreshed.data?.draft_id !== draftId) return false;
        if (snapshot === JSON.stringify({ screen:screenRef.current, answers:answersRef.current })) {
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }
  prepareHandoffRef.current = prepareForAccountHandoff;
  useEffect(() => {
    if (identityId !== 'visitor') return;
    return registerFilmmakerAuthPreparationProvider({
      getDraftId:()=>progressDraftIdRef.current,
      canPrepare:()=>{
        const draftId = progressDraftIdRef.current;
        return Boolean(draftId && !savingRef.current && !materialsBusyRef.current
          && lastSaved.current === JSON.stringify({ screen:screenRef.current, answers:answersRef.current }));
      },
      canSignInWithoutDraft:()=>Boolean(!progressDraftIdRef.current && progress.error?.status === 404
        && screenRef.current === 1 && lastSaved.current === ''
        && JSON.stringify(answersRef.current) === JSON.stringify(initial)),
      prepare:draftId=>prepareHandoffRef.current(draftId),
    });
  }, [identityId, progress.data?.draft_id, progress.error, progress.isError, saving, materialsBusy, screen, a]);
  async function connectCurrentDraft() {
    let draftId = progress.data?.draft_id;
    if (connectingDraft) return;
    if (!draftId) {
      const refreshed = await progress.refetch();
      draftId = refreshed.data?.draft_id;
      if (draftId) {
        setHandoffError('We confirmed the saved draft identifier. Select Connect draft to my account again to securely link this exact draft.');
        return;
      }
      setHandoffError('We could not confirm the current draft. Your answers remain saved; refresh the worksheet before linking it.');
      return;
    }
    if (screen === 2 && !await flushMaterials()) return;
    setConnectingDraft(true);
    setHandoffError('');
    try {
      await persist(screen, a);
      await claim.mutateAsync();
      rememberFilmmakerDraftLinked(identityKey, draftId);
      setLinkedDraftId(draftId);
      setHandoffError('');
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      const response = error && typeof error === 'object' && 'data' in error ? error.data : null;
      const detail = response && typeof response === 'object' && 'error' in response && typeof response.error === 'string'
        ? response.error : '';
      setHandoffError(status === 409 || status === 403 || status === 404
        ? `${detail || 'This draft could not be linked to this account.'} Your answers remain saved. Open My projects to resolve any existing account-draft conflict; no draft was overwritten.`
        : 'We could not securely link this draft. Your answers remain saved; check your connection and try again.');
    } finally {
      setConnectingDraft(false);
    }
  }
  useEffect(() => {
    if (!hydrated || existingDraft || resetting) return;
    const snapshot = JSON.stringify({ screen, answers:a });
    if (snapshot === lastSaved.current) return;
    editTimer.current = window.setTimeout(() => { editTimer.current = null; void persist(screen, a).catch(() => undefined); }, 800);
    return () => { if (editTimer.current !== null) window.clearTimeout(editTimer.current); editTimer.current = null; };
    // Deliberately schedule only when answers/screen change; mutation objects are unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, screen, hydrated, existingDraft, resetting]);
  const startOverButton = <FilmmakerStartOver
    draftId={worksheetDraftId}
    disabled={saving || materialsBusy || connectingDraft || submit.isPending || Boolean(pendingHandoff)}
    beforeInspect={async () => {
      resettingRef.current = true;
      setResetting(true);
      if (editTimer.current !== null) window.clearTimeout(editTimer.current);
      editTimer.current = null;
      await queue.current.catch(() => undefined);
    }}
    onSettled={() => { resettingRef.current = false; setResetting(false); }}
  />;
  useEffect(() => {
    if (!hydrated || identityId === 'visitor' || !signedInEmail) return;
    setA(current => current.email.trim() ? current : { ...current, email:signedInEmail });
  }, [hydrated, identityId, signedInEmail]);
  const stage = a.stage ?? 'idea';
  const budgetOptions = examples(stage, a.format);
  const budget = Number.isSafeInteger(a.budget) && a.budget > 0 ? a.budget : 0;
  const standard = standardOffer(stage);
  const hasFundingHistory = hasFundingHistoryFor(a.funding_sources);
  const parsedCustom = parseCustomProposal({ repayment:a.p_repayment, investorBackend:a.p_investor, years:a.p_years, earlyOn:a.p_early_on, early:a.p_early });
  const customErrors = parsedCustom.ok ? {} : parsedCustom.errors;
  const negotiating = a.decision === 'negotiation';
  const repNum = negotiating ? (parsedCustom.ok ? parsedCustom.repayment : customErrors.repayment ? null : Number(a.p_repayment)) : standard;
  const termsView = negotiating
    ? (parsedCustom.ok ? { inv:parsedCustom.investorBackend, years:parsedCustom.years, early:parsedCustom.early } : null)
    : { inv:STANDARD_BACKEND.investorPercent, years:STANDARD_BACKEND.years, early:0 };
  const feePct = platformFeePercent(stage);
  const budgetValid = Number.isSafeInteger(a.budget) && a.budget > 0 && a.budget <= MAX_BUDGET;
  const receipt = repNum !== null && budgetValid ? calculateDeal(budget, stage, 'A', repNum) : null;
  const proposalReady = Boolean(a.decision) && (!negotiating || parsedCustom.ok);

  function validateStep(step:number):string {
    if (step === 1 && !a.no_project_yet && !a.stage) return 'Choose a project stage to continue.';
    if (step === 1 && !(a.age_confirmed || ageStatus.confirmed)) return 'Confirm that you are 18 years of age or older to continue.';
    if (step === 2 && !a.no_project_yet) {
      if (!a.title.trim() || !a.genre || !a.logline.trim() || (a.genre === 'Other' && !a.genre_other.trim())) return 'Add a title, genre and logline to continue.';
      if (!validUrl(a.pilot_url)) return 'Use a full http:// or https:// link for your video URL.';
      if (teamLinkList(a.team_links_text).some(l=>!validUrl(l)) || teamLinkList(a.team_links_text).length > 8) return 'Add up to eight full http:// or https:// team links, one per line.';
    }
    if (step === 3 && !budgetValid) return a.budget > MAX_BUDGET ? `Budget can be at most ${money(MAX_BUDGET)}. Enter a smaller whole-dollar amount.` : 'Enter a positive whole-dollar budget to continue.';
    if (step === 3 && !a.decision) return 'Choose Looks good to me or Open to negotiation.';
    if (step === 3 && negotiating && !parsedCustom.ok) return 'Fix the highlighted terms in Propose my terms, or switch back to Looks good to me.';
    if (step === 4 && (a.funding_sources.length === 0 || (a.funding_sources.includes('Other') && !a.funding_other.trim()) || (hasFundingHistory && (a.reached_goal === null || !a.funding_experience.trim())))) return 'Tell us where you have looked for funding and, when relevant, whether you reached your goal and what happened.';
    if (step === 4 && a.funding_sources.some(isCrowd) && a.crowdfunding_ran === true && (!nonNeg(a.crowdfunding_goal) || !nonNeg(a.crowdfunding_raised))) return 'Campaign goal and amount raised must be zero or more.';
    if (step === 4 && a.funding_sources.some(isCrowd) && a.crowdfunding_ran === null) return 'Tell us whether you actually ran a crowdfunding campaign.';
    if (step === 5 && (!a.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) || !a.city.trim() || !a.country)) return 'Add your name, a valid email, city and country. Choose a city from the suggestions or enter your location manually.';
    return '';
  }
  async function advance(next:number, updated=a) {
    const error = validateStep(screen);
    if (error) { setValidation(error); return; }
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    if (screen === 2 && !await flushMaterials()) return;
    try {
      const destination = filmmakerDestination(screen, next, updated.no_project_yet);
      const reviewed = screen === 3 ? { ...updated, legacy_terms_review_required:false } : updated;
      await persist(destination, reviewed);
      if (screen === 3) setA(reviewed);
      setScreen(destination);
      window.scrollTo({ top:0, behavior:'smooth' });
    } catch { /* save error remains visible; stay on current screen */ }
  }
  async function back() {
    const next = a.no_project_yet && screen === 5 ? 2 : Math.max(1, screen - 1);
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    if (screen === 2 && !await flushMaterials()) return;
    try { await persist(next, a); setScreen(next); window.scrollTo({ top:0, behavior:'smooth' }); } catch { /* stay here */ }
  }
  async function editBudget() { await goTo(3); }
  async function goTo(target:number) {
    setValidation('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    try {
      await persist(target, a);
      setScreen(target);
      window.scrollTo({ top:0, behavior:'smooth' });
    } catch { /* stay here */ }
  }
  async function finish() {
    const currentDraftId = progress.data?.draft_id;
    if (!currentDraftId) {
      const refreshed = await progress.refetch();
      setHandoffError(refreshed.data?.draft_id
        ? 'We refreshed the exact draft identifier. Select Send my answers again to submit the linked draft.'
        : 'We could not confirm the saved draft identifier, so nothing was submitted. Retry after refreshing the worksheet.');
      return;
    }
    if (identityId === 'visitor' || connectingDraft || linkedDraftId !== currentDraftId) {
      setHandoffError('Connect this saved draft to your verified account before sending the final submission.');
      return;
    }
    if (submit.isPending) return;
    if (!submissionConfig.data?.available) {
      setValidation('We could not prepare the final submission. Your answers are saved. Try “Check again” below.');
      return;
    }
    if (!a.no_project_yet && a.legacy_terms_review_required) {
      setValidation('Review the updated repayment, platform spread, and backend terms before sending. Your saved project, funding, and contact answers are unchanged.');
      setScreen(3);
      return;
    }
    for (const step of a.no_project_yet ? [1] : [1, 2, 3, 4]) {
      const stepError = validateStep(step);
      if (stepError) {
        setValidation(stepError);
        setScreen(step);
        return;
      }
    }
    const error = validateStep(5);
    if (error) { setValidation(error); return; }
    if (identityId !== 'visitor' && signedInEmail && a.email.trim().toLowerCase() !== signedInEmail.trim().toLowerCase()) {
      setValidation('Your project email must match your signed-in account email. Use the button beside the email field, or sign in with the account for this address.');
      return;
    }
    setValidation('');
    setSubmitError('');
    if (editTimer.current !== null) window.clearTimeout(editTimer.current);
    if (!await flushMaterials()) return;
    try {
      await persist(5, a);
    } catch {
      return; // The save handler shows its own error and keeps the worksheet.
    }
    if (!ageStatus.confirmed) {
      if (!a.age_confirmed) { setSubmitError('Confirm that you are 18 years of age or older before sending. Your answers are saved.'); return; }
      try {
        await confirmAgeMutation.mutateAsync({ data:{ age_confirmed:true } });
        await queryClient.invalidateQueries({ queryKey:ageStatus.queryKey });
      } catch {
        setSubmitError('We could not save your 18+ confirmation to your account. Your answers are saved; please try again.');
        return;
      }
    }
    try {
      const submitted = await submit.mutateAsync({ data:{ ...payload(a), website } });
      recordPitchForReview(submitted.project_id);
      storePitchReviewProof(submitted.project_id, submitted.checkout_proof);
      navigate('/start/filmmaker/done');
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      const responseBody = error && typeof error === 'object' && 'data' in error ? error.data : null;
      const responseMessage = responseBody && typeof responseBody === 'object' && 'error' in responseBody
        && typeof responseBody.error === 'string' ? responseBody.error : '';
      setSubmitError(status === 409 || status === 403 || status === 404
        ? responseMessage || 'This draft is no longer selected for this visit. Copy any unsaved answers, then open My projects to resume the draft or start another project.'
        : status === 429
          ? 'Too many submission attempts from this browser or network. Please try again later. Your worksheet is still saved.'
        : status === 503
          ? 'We could not complete secure submission. Your worksheet is saved; try again later.'
        : status === 400
          ? responseMessage && responseMessage !== 'Invalid filmmaker submission.'
            ? responseMessage
            : 'The submission was not accepted. Review your project details and contact information, then select Send my answers again.'
          : 'We could not submit your information. Your answers are saved; please try again. Nothing has been confirmed.');
    }
  }
  function selectStage(value:Stage) {
    const nextBudget = a.budget_mode === 'example' ? examples(value,a.format)[0] : a.budget;
    setA({ ...a, stage:value, budget:nextBudget, original_suggestion:standardOffer(value) });
    setValidation('');
  }
  async function chooseNoProject(checked:boolean) {
    if (checked && !(a.age_confirmed || ageStatus.confirmed)) {
      setValidation('Confirm that you are 18 years of age or older to continue.');
      return;
    }
    if (checked && materialsBusy) return;
    if (checked && !await flushMaterials()) return;
    const next = { ...a, no_project_yet:checked };
    setA(next);
    setValidation('');
    if (checked) {
      if (editTimer.current !== null) window.clearTimeout(editTimer.current);
      void persist(5, next).then(() => { setScreen(5); window.scrollTo({ top:0, behavior:'smooth' }); }).catch(() => undefined);
    }
  }
  function toggleArray(key:'funding_sources'|'favorite_genres', item:string) {
    setA(current => {
      const selected=current[key].includes(item);
      if (key === 'funding_sources' && item === 'Haven’t yet' && !selected) {
        return { ...current, funding_sources:['Haven’t yet'] };
      }
      const values=selected ? current[key].filter(x=>x!==item) : [...current[key].filter(x=>!(key === 'funding_sources' && x === 'Haven’t yet')),item];
      return { ...current, [key]:values };
    });
    setValidation('');
  }
  const proposalCard = receipt && repNum !== null && <div className="fm-receipt" data-testid="receipt-deal">
    <h3>{negotiating ? 'Your proposal at a glance' : 'Suggested terms at a glance'}</h3><dl>
      <div><dt>Project budget</dt><dd data-testid="text-budget">{money(budget)}</dd></div>
      {a.stage !== 'distribution' && a.development_amount ? <div><dt>Development amount</dt><dd data-testid="text-development-amount">{money(Number(a.development_amount))}</dd></div> : null}
      <div><dt>1 · Investor repayment target · {money(repNum)} per $100, including original capital</dt><dd data-testid="text-investor-target">{money(receipt.investorTarget)}</dd></div>
      <div><dt>Platform fee, separate from the target · {feePct}% of budget</dt><dd data-testid="text-platform-fee">{money(receipt.platformFee)}</dd></div>
      <div className="fm-total"><dt>Combined project repayment threshold</dt><dd data-testid="text-combined-payback">{money(receipt.combinedPayback)}</dd></div>
      {termsView && <div><dt>2 · Then, backend split for {termsView.years} {termsView.years === 1 ? 'year' : 'years'}</dt><dd data-testid="text-backend-split">{termsView.inv}% investors / {100-termsView.inv}% filmmaker</dd></div>}
      {termsView && <div><dt>While investors are repaid</dt><dd data-testid="text-early-share">{termsView.early ? `${termsView.early}% filmmaker / ${100-termsView.early}% investors` : 'Investors first, no early filmmaker share'}</dd></div>}
    </dl>
    <p className="fm-small" style={{marginTop:14}}>The backend begins only after investors have been paid their full repayment target. {REVENUE_BASIS_NOTE}</p>
    <details style={{marginTop:10}}><summary className="fm-small" style={{cursor:'pointer'}} data-testid="toggle-math">How the numbers work</summary>
      <p className="fm-small">Investor target = budget × repayment ÷ 100. Platform fee = budget × {feePct}% (separate; not an investor return; paid under the existing proportional allocation toward the remaining investor target and fee). {BACKEND_EXAMPLE}{termsView?.early ? ` Early share example: if $1,000 is available at ${termsView.early}% filmmaker / ${100-termsView.early}% investors, the filmmaker receives ${money(1000*termsView.early/100)} and ${money(1000*(100-termsView.early)/100)} reduces the outstanding investor target. Early payments never lower the target and can delay reaching it.` : ''}</p></details>
    <p className="fm-small">Illustrative and revenue-dependent. Not a guaranteed return, forecast, payment date or monthly schedule.</p>
  </div>;
  const budgetTabs = <div>
    <p className="fm-label">Choose your budget approach</p>
    <div className="fm-tabs" role="group" aria-label="Budget type">
      <button type="button" data-testid="button-example-budget" className={a.budget_mode === 'example' ? 'active' : ''} aria-pressed={a.budget_mode === 'example'} onClick={()=>{if(a.budget_mode!=='example') updateBudget(budgetOptions[0],'example');}}>Example budget</button>
      <button type="button" data-testid="button-your-budget" className={a.budget_mode === 'custom' ? 'active' : ''} aria-pressed={a.budget_mode === 'custom'} onClick={()=>{if(a.budget_mode!=='custom') updateBudget(0,'custom');}}>My own budget</button>
    </div>
    {a.budget_mode === 'example' ? <div className="fm-amounts">{budgetOptions.map(value=><Choice key={value} id={`budget-${value}`} name="example-budget" selected={a.budget===value} onClick={()=>updateBudget(value)}>{money(value)}</Choice>)}</div> :
      <div className="fm-field"><label htmlFor="custom-budget" className="fm-label">Your estimated budget · USD</label><input id="custom-budget" data-testid="input-custom-budget" className="fm-input" inputMode="numeric" value={a.budget ? a.budget.toLocaleString('en-US') : ''} onChange={e=>{ const raw=e.target.value.replace(/,/g,''); if (/^\d*$/.test(raw)) updateBudget(raw ? Number(raw) : 0); }} aria-invalid={!budgetValid} />{!budgetValid && <p className="fm-error" role="alert">Enter a positive whole-dollar amount.</p>}</div>}
    {a.stage !== 'distribution' && <>
    <div className="fm-field" style={{ marginTop: 18 }}><label htmlFor="development-amount" className="fm-label">Development amount · USD <span className="fm-small">· optional</span></label>
      <input id="development-amount" data-testid="input-development-amount" className="fm-input" inputMode="numeric" value={a.development_amount ? Number(a.development_amount).toLocaleString('en-US') : ''} onChange={e=>change('development_amount', e.target.value.replace(/[^0-9]/g,''))} placeholder="For example: 15,000"/>
      <p className="fm-small">What you need to get the project ready to shoot, if that differs from the full budget. Shown next to the budget.</p></div>
    </>}
    <div className="fm-section" data-testid="section-your-timeline" style={{ marginTop: 22 }}>
      <p className="fm-label">Your timeline</p>
      <p className="fm-small" style={{ marginBottom: 14 }}>Private to you and Movie Show Investing. Never shown on your project page, in Explore or in emails to backers.</p>
      {/* Distribution projects are already filmed, so there is no filming start question. */}
      {(a.stage === 'idea' || a.stage === 'production') && <MonthYearField id="filming-start" label="When do you plan to start filming?" value={a.filming_start_month ?? ''} skipped={a.filming_start_skipped ?? false}
        onChange={next=>{change('filming_start_month', next.value); change('filming_start_skipped', next.skipped);}}/>}
      <MonthYearField id="money-needed-by" label="When do you need the money by?" value={a.money_needed_by_month ?? ''} skipped={a.money_needed_by_skipped ?? false}
        onChange={next=>{change('money_needed_by_month', next.value); change('money_needed_by_skipped', next.skipped);}}/>
    </div>
  </div>;

  // Surface the server's reason (e.g. a different account's visit, a cleared draft) instead of only "try again".
  const loadError = (completedResult.isError && completedResult.error?.status !== 404 ? completedResult.error : null)
    ?? (progress.isError && progress.error?.status !== 404 ? progress.error : null)
    ?? (group.isError ? group.error : null);
  const loadErrorStatus = loadError?.status;
  const loadErrorData: unknown = loadError?.data;
  const loadErrorText = loadErrorData && typeof loadErrorData === 'object' && 'error' in loadErrorData && typeof loadErrorData.error === 'string' ? loadErrorData.error : '';
  if (completedResult.isLoading || progress.isLoading || group.isLoading || completedResult.data?.completed || !hydrated && !progress.isError) return <section className="fm"><div className="page-wrap" style={{padding:'70px 0 140px'}} aria-label="Loading saved answers"><p className="fm-kicker">Opening your worksheet</p><div className="fm-skeleton" style={{maxWidth:440,height:75}}/><div className="fm-skeleton" style={{maxWidth:310}}/><div className="fm-skeleton" style={{maxWidth:600,height:190}}/></div></section>;
  if (completedResult.isError && completedResult.error?.status !== 404 || progress.isError && progress.error?.status !== 404 || group.isError || !group.data) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Connection interrupted</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>We can’t open your worksheet yet.</h1><p className="fm-small">{loadErrorText || 'Your previous answers and pricing group need to load before you continue. Please try again.'}</p>{loadErrorStatus === 403 && <p className="fm-small" style={{marginTop:12}}><Link href="/me/projects?action=manage" onClick={() => setFilmmakerAction('manage')} data-testid="link-load-error-projects">Open My projects</Link></p>}<button type="button" data-testid="button-retry-loading" className="fm-primary" style={{marginTop:30}} onClick={()=>{ void completedResult.refetch(); void progress.refetch(); void group.refetch(); }}><RotateCcw size={17}/> Try again</button>{startOverButton}</div></section>;
    if (identityId !== 'visitor' && progress.error?.status === 404 && handoffError) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Draft not connected</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>Your original draft is still safe.</h1><p className="fm-error" role="alert">{handoffError}</p><Link href="/me/projects" data-testid="link-filmmaker-handoff-recovery" className="fm-primary" style={{marginTop:30}}>Open My projects <ArrowRight size={17}/></Link></div></section>;
    if (identityId !== 'visitor' && progress.error?.status === 404) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Choose a project</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>Your draft isn’t selected.</h1><p className="fm-small">Open My projects to resume a saved draft or start another project. No project was changed.</p><Link href={fromPricing ? '/me/projects?action=start&new=1' : '/me/projects'} data-testid="link-select-filmmaker-draft" className="fm-primary" style={{marginTop:30}}>My projects <ArrowRight size={17}/></Link></div></section>;
   if (existingDraft && fromPricing) return <section className="fm"><div className="page-wrap" style={{padding:'100px 0 150px'}}><p className="fm-kicker">Saved worksheet found</p><h1 className="serif" style={{fontSize:'clamp(50px,7vw,85px)',margin:'20px 0'}}>Your pitch is still here.</h1><p className="fm-small">You have an unfinished pitch in this browser. Continue your saved pitch, or choose Start over to discard it after confirmation.</p><button type="button" className="fm-primary" data-testid="button-resume-pricing-draft" style={{marginTop:30}} onClick={() => { setExistingDraft(false); navigate('/start/filmmaker'); }}>Continue saved pitch <ArrowRight size={17}/></button>{startOverButton}</div></section>;
  return <section className="fm"><div className="page-wrap">
    <div className="fm-top"><Link href="/" data-testid="link-flow-home" className="fm-kicker">Movie Show Investing / Filmmakers</Link><span className="fm-kicker" data-testid="text-progress">Step {screen} of 5</span></div>
    <div className="fm-progress" aria-label={`Step ${screen} of 5`}>{headings.map((heading,i)=><span key={heading} className={i<screen ? 'active' : ''} title={`Step ${i+1}: ${heading}`}/>)}</div>
    <div className="fm-layout">
      <div className="fm-intro" key={`intro-${screen}`}><p className="fm-kicker">The filmmaker worksheet / 0{screen}</p><h1 data-testid="text-flow-heading">{headings[screen-1]}</h1><p>{a.no_project_yet && screen===5 ? 'No project details needed. Just leave a way to reach you if you’d like to be part of what comes next.' : descriptions[screen-1]}</p><div className="fm-note">This is an early conversation, not an application for funding. No money is collected and nothing here commits you to a deal.</div>{startOverButton}</div>
      <fieldset disabled={resetting || contextChanged} className="fm-panel" key={`panel-${screen}`} style={{ minWidth: 0, border: 0, margin: 0 }}>
        {contextChanged && <p className="fm-error" role="alert">Another draft was selected in this browser. Your displayed answers have not been moved to it. Refresh before editing or starting over.</p>}
        {screen === 3 && a.legacy_terms_review_required && <p className="fm-error" role="status">This draft predates the updated terms. Review the platform spread and choose your backend terms before continuing. Your previous repayment amount, project details, funding history, and contact answers are retained.</p>}
        {screen === 1 && <><div className="fm-choice-list">
          <Choice id="stage-distribution" name="project-stage" selected={a.stage==='distribution'} onClick={()=>selectStage('distribution')} detail="A finished film looking toward release.">Distribution phase</Choice>
          <Choice id="stage-production" name="project-stage" selected={a.stage==='production'} onClick={()=>selectStage('production')} detail="A short or pilot you want to make next.">Short or pilot I want to develop</Choice>
          <Choice id="stage-idea" name="project-stage" selected={a.stage==='idea'} onClick={()=>selectStage('idea')} detail="The story is taking shape.">Script or idea</Choice>
        </div>
        <AgeAcknowledgment role="filmmaker" checked={a.age_confirmed || ageStatus.confirmed} disabled={ageStatus.confirmed} savedAt={ageStatus.confirmedAt} onChange={v=>change('age_confirmed',v)} />
        </>}
         {screen === 2 && <><label className="fm-check fm-section"><input type="checkbox" data-testid="checkbox-no-project" checked={a.no_project_yet} disabled={saving || materialsBusy} onChange={e=>void chooseNoProject(e.target.checked)}/><span><strong>I don’t have a project yet. I want to participate in the future.</strong><small style={{display:'block',color:'#666',marginTop:5}}>Skip the project and deal questions. We’ll only ask how to reach you.</small></span></label>
          {!a.no_project_yet && <>
            <Field id="project-title" label="Working title" value={a.title} onChange={v=>change('title',v)} required placeholder="Even a working title is fine"/>
              <div className="fm-field"><p className="fm-label">Format</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{(['movie','show'] as const).map(value=><Choice id={`format-${value}`} name="project-format" key={value} selected={a.format===value} onClick={()=>setA(current=>{ const nextBudget=current.budget_mode==='example' ? examples(stage,value)[0] : current.budget; return {...current,format:value,budget:nextBudget,deal_answer:current.budget===nextBudget?current.deal_answer:null}; })}>{value==='movie'?'Movie':'Show'}</Choice>)}</div></div>
             <div className="fm-field"><p className="fm-label">Genre</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{genres.map(g=><Choice id={`genre-${g}`} name="project-genre" key={g} selected={a.genre===g} onClick={()=>change('genre',g)}>{g}</Choice>)}</div></div>
            {a.genre==='Other' && <Field id="genre-other" label="Describe your genre" value={a.genre_other} onChange={v=>change('genre_other',v)} required/>}
            <Field id="logline" label="Logline" value={a.logline} onChange={v=>change('logline',v)} required multiline placeholder="The story, in a sentence or two"/>
             <DraftPitchMaterials
               ref={materialsRef}
               draftId={worksheetDraftId ?? null}
               onBusyChange={onMaterialsBusyChange}
               onErrorChange={onMaterialsErrorChange}
             />
             {materialsError && <p className="fm-error" role="alert" data-testid="error-draft-materials">{materialsError}</p>}
            <OptionalSpecifics a={a} change={change}/>
            {a.stage==='production' && <Field id="pilot-url" label="Short or pilot URL" value={a.pilot_url} onChange={v=>change('pilot_url',v)} type="url" placeholder="https://"/>}
          </>}
        </>}
         {screen === 3 && <>{budgetTabs}
           <div className="fm-note" role="note" style={{marginTop:22}}><strong>Illustrative only.</strong> Enter the total budget for this stage. Repayment is calculated on it; the amount actually raised and each investor’s allocation may be smaller. Examples are optional starting points.</div>
           {proposalCard}
           <div className="fm-section"><p className="fm-label">What is your decision on these suggested terms?</p><div className="fm-choice-list">
             <Choice id="decision-standard" name="proposal-decision" selected={a.decision==='standard'} onClick={()=>setA(c=>({...c,decision:'standard',original_suggestion:standard}))} detail={`${money(standard)} per $100, then 50/50 backend for 5 years.`}>Looks good to me</Choice>
             <Choice id="decision-negotiation" name="proposal-decision" selected={negotiating} onClick={()=>setA(c=>({...c,decision:'negotiation',original_suggestion:standard,p_repayment:c.p_repayment || String(standard)}))} detail="You don’t need a counteroffer. Proposing terms is optional.">Open to negotiation</Choice>
           </div><p className="fm-small" style={{marginTop:10}}>Either choice is a non-binding preference, not a contract or an acceptance by investors.</p></div>
           {negotiating && <div className="fm-section" data-testid="section-propose-terms"><p className="fm-kicker">Propose my terms · optional</p>
             <div className="fm-calc" style={{marginTop:14}}>
               <div className="fm-field"><label htmlFor="p-repayment" className="fm-label">Total repayment per $100 invested</label><input id="p-repayment" data-testid="input-p-repayment" className="fm-input" inputMode="numeric" value={a.p_repayment} onChange={e=>change('p_repayment',e.target.value)} aria-invalid={Boolean(customErrors.repayment)}/><p className="fm-small">Includes original capital. Standard for this stage: {money(standard)}.</p>{customErrors.repayment && <p className="fm-error" role="alert">{customErrors.repayment}</p>}</div>
               <div className="fm-field"><label htmlFor="p-years" className="fm-label">Backend duration · years</label><input id="p-years" data-testid="input-p-years" className="fm-input" inputMode="numeric" value={a.p_years} onChange={e=>change('p_years',e.target.value)} aria-invalid={Boolean(customErrors.years)}/>{customErrors.years && <p className="fm-error" role="alert">{customErrors.years}</p>}</div>
               <div className="fm-field"><label htmlFor="p-investor" className="fm-label">Investors’ backend share · %</label><input id="p-investor" data-testid="input-p-investor" className="fm-input" inputMode="numeric" value={a.p_investor} onChange={e=>change('p_investor',e.target.value)} aria-invalid={Boolean(customErrors.backend)}/>{customErrors.backend && <p className="fm-error" role="alert">{customErrors.backend}</p>}</div>
               <div className="fm-field"><label htmlFor="p-filmmaker" className="fm-label">Filmmaker’s backend share · %</label><input id="p-filmmaker" data-testid="text-p-filmmaker" className="fm-input" readOnly value={parsedCustom.ok || !customErrors.backend ? String(100-Number(a.p_investor)) : '—'}/><p className="fm-small">The two shares always total 100%.</p></div>
             </div>
             <label className="fm-check"><input type="checkbox" data-testid="checkbox-early-share" checked={a.p_early_on} onChange={e=>change('p_early_on',e.target.checked)}/><span>Propose filmmaker payments while investors are repaid<small style={{display:'block'}} className="fm-small">Standard is none: investors are paid first. Example: {EARLY_EXAMPLE}% filmmaker / {100-EARLY_EXAMPLE}% investors of money available after agreed costs and fees. This is separate from salary or costs already in your budget.</small></span></label>
             {a.p_early_on && <div className="fm-field"><label htmlFor="p-early" className="fm-label">Filmmaker’s early share · %</label><input id="p-early" data-testid="input-p-early" className="fm-input" inputMode="numeric" value={a.p_early} onChange={e=>change('p_early',e.target.value)} aria-invalid={Boolean(customErrors.early)}/><p className="fm-small">Investors receive the remaining {customErrors.early ? '—' : 100-Number(a.p_early)}%.</p>{customErrors.early && <p className="fm-error" role="alert">{customErrors.early}</p>}</div>}
             <Field id="p-note" label="Short explanation" value={a.p_note} onChange={v=>change('p_note',v)} multiline placeholder="Why these terms? (optional)"/>
             <button type="button" className="fm-back" data-testid="button-reset-terms" onClick={()=>setA(c=>({...c,p_repayment:String(standard),p_investor:'50',p_years:'5',p_early_on:false,p_early:String(EARLY_EXAMPLE),p_note:''}))}>Reset to the suggestion</button>
             <p className="fm-small" style={{marginTop:10}}>Your terms are saved with your draft. If you switch back to Looks good to me, they stay saved but only the standard terms are submitted.</p>
           </div>}
         </>}
         {screen === 4 && <><p className="fm-label">Where have you looked for funding, or what best describes you? Select all that apply.</p><div className="fm-choice-list">{funding.map(source=><Choice id={`funding-${source.replace(/\W+/g,'-').toLowerCase()}`} name="funding-source" multiple key={source} selected={a.funding_sources.includes(source)} onClick={()=>toggleArray('funding_sources',source)}>{source}</Choice>)}</div>
          {a.funding_sources.includes('Other') && <div className="fm-section"><Field id="funding-other" label="Other funding source" value={a.funding_other} onChange={v=>change('funding_other',v)} required/></div>}
            {a.funding_sources.some(isCrowd) && <div className="fm-section" data-testid="section-crowdfunding"><p className="fm-label">Did you actually run a campaign?</p><p className="fm-small">Looking for crowdfunding is not the same as running a campaign.</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><Choice id="crowd-yes" name="crowd-ran" selected={a.crowdfunding_ran===true} onClick={()=>change('crowdfunding_ran',true)}>Yes</Choice><Choice id="crowd-no" name="crowd-ran" selected={a.crowdfunding_ran===false} onClick={()=>change('crowdfunding_ran',false)}>No</Choice></div>
              {a.crowdfunding_ran===true && <div className="fm-section" data-testid="group-crowdfunding-details">
                <Field id="crowd-campaign" label="Platform or campaign link" value={a.crowdfunding_campaign} onChange={v=>change('crowdfunding_campaign',v)} placeholder="Kickstarter link, or explain if you no longer have one"/>
                <div className="fm-field"><p className="fm-label">Was it for this project? <span className="fm-small">· optional</span></p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><Choice id="crowd-same-yes" name="crowd-same" selected={a.crowdfunding_same_project===true} onClick={()=>change('crowdfunding_same_project',true)}>Yes</Choice><Choice id="crowd-same-no" name="crowd-same" selected={a.crowdfunding_same_project===false} onClick={()=>change('crowdfunding_same_project',false)}>No</Choice></div></div>
                <div className="fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12}}><Field id="crowd-goal" label="Goal · $" value={a.crowdfunding_goal} onChange={v=>change('crowdfunding_goal',v)}/><Field id="crowd-raised" label="Raised · $" value={a.crowdfunding_raised} onChange={v=>change('crowdfunding_raised',v)}/></div>
                <Field id="crowd-obligations" label="Campaign type and anything still owed" value={a.crowdfunding_obligations} onChange={v=>change('crowdfunding_obligations',v)} multiline placeholder="For example: rewards still to ship, or repayment commitments"/>
                <p className="fm-small">Other campaigns can go in your experience notes below. We may follow up manually. This is not shown publicly.</p>
              </div>}
            </div>}
            {hasFundingHistory ? <><div className="fm-section"><p className="fm-label">Did you reach your goal?</p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><Choice id="goal-yes" name="funding-goal" selected={a.reached_goal===true} onClick={()=>change('reached_goal',true)}>Yes</Choice><Choice id="goal-no" name="funding-goal" selected={a.reached_goal===false} onClick={()=>change('reached_goal',false)}>No</Choice></div></div>
             <div className="fm-section"><Field id="funding-experience" label="What was your experience?" value={a.funding_experience} onChange={v=>change('funding_experience',v)} required multiline placeholder="What worked, what didn’t, or what you wish had been different"/></div></>
             : <div className="fm-note" role="status" style={{marginTop:18}}>No past funding experience needed. We’ll skip the goal and experience questions.</div>}
        </>}
        {screen === 5 && <>{a.no_project_yet && <div className="fm-note">You’re joining the conversation without a project. We won’t ask for a budget or deal terms.</div>}
           {!a.no_project_yet && <div className="fm-section" data-testid="summary-project" style={{marginTop:0}}><p className="fm-kicker">Your project and terms · edit any time</p>
             <div className="fm-receipt" style={{marginTop:12}}><dl>
               <div><dt>Stage</dt><dd>{phase(stage)}</dd></div>
               <div><dt>Title</dt><dd>{a.title || '—'}</dd></div>
               <div><dt>Budget</dt><dd data-testid="text-selected-budget">{money(budget)}</dd></div>
               {a.stage !== 'distribution' && a.development_amount ? <div><dt>Development amount</dt><dd data-testid="text-selected-development">{money(Number(a.development_amount))}</dd></div> : null}
               <div><dt>Decision</dt><dd>{negotiating ? 'Open to negotiation' : 'Looks good to me'}</dd></div>
               {repNum !== null && <div><dt>Repayment target</dt><dd>{money(repNum)} per $100 · {money(Math.round(budget*repNum)/100)}</dd></div>}
               {termsView && <div><dt>Backend</dt><dd>{termsView.inv}/{100-termsView.inv} for {termsView.years} yr{termsView.early ? ` · early share ${termsView.early}%` : ''}</dd></div>}
             </dl></div>
             <div className="fm-actions" style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="fm-back" data-testid="button-edit-project" disabled={saving||submit.isPending} onClick={()=>void goTo(2)}>Edit project</button><button type="button" className="fm-back" data-testid="button-edit-budget" disabled={saving||submit.isPending} onClick={()=>void goTo(3)}>Edit budget & terms</button></div></div>}
           {!ageStatus.confirmed && <AgeAcknowledgment role="filmmaker" checked={a.age_confirmed} onChange={v=>change('age_confirmed',v)} />}
           {identityId === 'visitor'
             ? <div className="fm-note" role="note" data-testid="text-filmmaker-sign-in-required"><strong>Sign in is required before we can receive and keep your final answers.</strong> Your worksheet saves in this browser as you go. Continue with Google opens a secure popup; we’ll finish saving this exact draft before linking it. You can cancel and return here any time. Account/email verification is not legal identity verification or KYC.</div>
             : <div className="fm-note" role="status" data-testid="text-filmmaker-account-status"><strong>Signed in as {signedInEmail || 'your verified account'}.</strong> This verifies your account email; it is not legal identity verification or KYC. {linkedDraftId === progress.data?.draft_id ? 'This worksheet is securely linked to this account.' : 'Connect this browser draft to your account before final submission.'}</div>}
           {handoffError && <div className="fm-error" role="alert" data-testid="error-filmmaker-handoff">{handoffError} <Link href="/me/projects" className="underline" data-testid="link-filmmaker-handoff-projects">My projects</Link></div>}
           {identityId !== 'visitor' && pendingHandoff && connectingDraft && <p className="fm-small" role="status">Verifying your account and securely connecting this exact saved draft before submission…</p>}
           {identityId !== 'visitor' && linkedDraftId === progress.data?.draft_id && <p className="fm-small" role="status" data-testid="status-filmmaker-draft-linked">Draft connected to {signedInEmail || 'your verified account'}. Your saved answers are ready for final submission.</p>}
          <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="filmmaker-website">Leave this field blank</label>
            <input id="filmmaker-website" name="website" type="text" autoComplete="off" tabIndex={-1}
              value={website} onChange={event => setWebsite(event.target.value)} />
          </div>
          <Field id="name" label="Your name" value={a.name} onChange={v=>change('name',v)} required/>
          <Field id="email" label="Email address" value={a.email} onChange={v=>change('email',v)} type="email" required/>
          {identityId !== 'visitor' && signedInEmail && a.email.trim().toLowerCase() !== signedInEmail.trim().toLowerCase() && <div className="fm-note" role="status">
            Your project email must match your signed-in email to submit. <button type="button" className="underline" data-testid="button-use-signed-in-email" onClick={()=>change('email',signedInEmail)}>Use my signed-in email</button>
          </div>}
          <Field id="phone" label="Phone number" value={a.phone} onChange={v=>change('phone',v)} type="tel"/>
          <LocationPicker value={{ city:a.city, state:a.state, country:a.country, location_manual:a.location_manual }}
            onChange={location=>{ setA(current=>({...current,...location})); setValidation(''); }} />
            <div className="fm-section"><p className="fm-label">Favorite genres <span className="fm-small">· optional</span></p><div className="fm-choice-list fm-grid" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{genres.map(g=><Choice id={`favorite-${g}`} name="favorite-genre" multiple key={g} selected={a.favorite_genres.includes(g)} onClick={()=>toggleArray('favorite_genres',g)}>{g}</Choice>)}</div></div>
          <label className="fm-check fm-section"><input type="checkbox" data-testid="checkbox-chat-opt-in" checked={a.chat_opt_in} onChange={e=>change('chat_opt_in',e.target.checked)}/><span>I’m open to a quick 15-minute chat about my experience.</span></label>
          <p className="fm-small">By submitting, you’re sharing information with Movie Show Investing for its launch MVP. This does not create a project listing or an investment opportunity. See our <Link href="/privacy" className="underline" data-testid="link-flow-privacy">privacy policy</Link>.</p>
           {submissionConfig.isLoading ? <p className="fm-small" role="status">Checking submission availability…</p>
             : submissionConfig.isError ? <div className="fm-error" role="alert">We could not check submission settings. Nothing has been sent. <button type="button" className="underline" onClick={()=>void submissionConfig.refetch()}>Check again</button></div>
             : !submissionConfig.data?.available ? <div className="fm-error" role="status">We could not prepare the final submission. Your answers remain saved. <button type="button" className="underline" onClick={()=>void submissionConfig.refetch()}>Check again</button></div>
              : null}
        </>}
        {validation && <p className="fm-error" data-testid="error-validation" role="alert">{validation}</p>}
        {materialsError && screen !== 2 && <p className="fm-error" data-testid="status-omitted-material-save" role="status">An optional pitch material was not saved: {materialsError} You can continue without it and add it later from your project page.</p>}
        {handoffError && screen !== 5 && <div className="fm-error" role="alert" data-testid="error-filmmaker-handoff">{handoffError} <Link href="/me/projects" className="underline">My projects</Link></div>}
        {saveError && <div className="fm-error" data-testid="error-save" role="alert">{saveError} {saveError.startsWith('This draft') ? <Link href="/me/projects" data-testid="link-reselect-draft">My projects</Link> : <button type="button" data-testid="button-retry-save" className="underline" onClick={()=>void persist(screenRef.current,answersRef.current).catch(()=>undefined)}>Retry save</button>}</div>}
        {submitError && <div className="fm-error" data-testid="error-submit" role="alert">{submitError} {(submitError.includes('draft') || submitError.includes('visitor is linked')) && <Link href="/me/projects" className="underline">My projects</Link>}</div>}
        <div className="fm-steps">
          {screen>1 ? <button type="button" data-testid="button-back" className="fm-back" disabled={saving || submit.isPending || screen===2 && materialsBusy || connectingDraft} onClick={()=>void back()}><ArrowLeft size={17}/> Back</button> : <span className="fm-small">Your answers save as you go.</span>}
          {screen===1 && !a.stage ? <span className="fm-small">Choose a stage to continue</span> :
             screen===5 && identityId==='visitor'
               ? <GoogleSignInButton
                   auth={getInitializedAuth()}
                   queryClient={queryClient}
                   className="fm-primary"
                   testId="button-filmmaker-google-sign-in"
                   label="Continue with Google"
                   disabled={saving || connectingDraft || materialsBusy}
                 />
               : screen===5 && linkedDraftId !== progress.data?.draft_id
                   ? <button type="button" data-testid="button-connect-filmmaker-draft" className="fm-primary" disabled={saving || connectingDraft || submit.isPending || Boolean(pendingHandoff)} onClick={()=>void connectCurrentDraft()}>{connectingDraft ? 'Connecting your draft…' : 'Connect draft to my account'} {!connectingDraft && <ArrowRight size={17}/>}</button>
                   : <button type="button" data-testid={screen===5?'button-submit-filmmaker':'button-continue'} className="fm-primary" disabled={saving || submit.isPending || connectingDraft || screen===5 && (submissionConfig.isLoading || submissionConfig.isError || !submissionConfig.data?.available) || screen===2 && materialsBusy} onClick={()=>screen===5 ? void finish() : void advance(a.no_project_yet && screen===2 ? 5 : screen+1)}>
                       {submit.isPending ? 'Submitting…' : saving ? 'Saving…' : screen===5 ? 'Send my answers' : 'Continue'} {!submit.isPending && <ArrowRight size={17}/>}
                     </button>}
        </div>
        <p className="fm-status" role="status" data-testid="status-save" style={{marginTop:15}}>{saveError ? 'Changes not saved' : saving ? 'Saving your answers…' : lastSaved.current === JSON.stringify({screen,answers:a}) ? 'All changes saved' : 'Changes save automatically'}</p>
      </fieldset>
    </div>
  </div></section>;
}
