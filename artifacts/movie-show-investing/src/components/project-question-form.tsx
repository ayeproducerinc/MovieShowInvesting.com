import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { ArrowUpRight, LockKeyhole, RotateCcw } from 'lucide-react';
import { useAskFilmmaker, useGetQuestionConfig } from '@workspace/api-client-react';
import './questions.css';

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<void> | null = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => window.turnstile ? resolve() : reject(new Error('Verification could not start.'));
      script.onerror = () => reject(new Error('Verification could not load.'));
      document.head.appendChild(script);
    }).catch(error => { scriptPromise = null; throw error; });
  }
  return scriptPromise;
}

function Verification({ siteKey, onToken, resetRef }: { siteKey: string; onToken: (token: string) => void; resetRef: MutableRefObject<(() => void) | null> }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    let id: string | null = null;
    void loadTurnstile().then(() => {
      if (!mounted || !element.current || !window.turnstile) return;
      id = window.turnstile.render(element.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (value: string) => { setError(''); callback.current(value); },
        'expired-callback': () => { callback.current(''); if (id && window.turnstile) window.turnstile.reset(id); },
        'error-callback': () => { callback.current(''); setError('Verification interrupted. Try the challenge again.'); if (id && window.turnstile) window.turnstile.reset(id); },
      });
      resetRef.current = () => { callback.current(''); if (id && window.turnstile) window.turnstile.reset(id); };
    }).catch(() => { if (mounted) setError('Verification could not load. Check your connection and try again.'); });
    return () => {
      mounted = false;
      resetRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, resetRef, attempt]);
  return <div className="q-turnstile"><div ref={element} aria-label="Cloudflare verification" data-testid="widget-question-turnstile" />{error && <div className="q-feedback" role="alert">{error} <button type="button" onClick={() => { setError(''); scriptPromise = null; setAttempt(value => value + 1); }}>Retry verification</button></div>}</div>;
}

export function ProjectQuestionForm({ slug, title }: { slug: string; title: string }) {
  const config = useGetQuestionConfig();
  const ask = useAskFilmmaker();
  const resetRef = useRef<(() => void) | null>(null);
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !config.data?.available || !config.data.turnstile_site_key) return;
    setFeedback('');
    try {
      await ask.mutateAsync({ slug, data: { first_name: firstName.trim(), email: email.trim(), question: question.trim(), turnstile_token: token } });
      setSent(true);
      setToken('');
      resetRef.current?.();
    } catch {
      setFeedback('Your question was not sent. Please check your details, complete verification again, and retry.');
      setToken('');
      resetRef.current?.();
    }
  }
  return <section id="ask-filmmaker" className="q-section questions-room" aria-label="Ask the filmmaker">
    <div className="q-section-inner">
      <div><span className="q-kicker">A private line / {title}</span><h2 className="q-title">A question worth<br/><em>asking.</em></h2><p className="q-copy">Speak directly to the filmmaker about the story, the plan, or what comes next. Your question is private, and their answer arrives by email.</p><p className="q-private-note"><LockKeyhole size={17}/> Your email is only used to deliver the reply. It is not displayed to the filmmaker.</p></div>
      <div className="q-card">
        {config.isLoading ? <div role="status" aria-label="Checking question availability"><div className="q-skeleton" style={{width:'60%',height:36}}/><div className="q-skeleton"/><div className="q-skeleton" style={{height:130}}/></div>
        : config.isError ? <div className="q-state" role="alert"><h3>We can’t open questions right now.</h3><p>Availability could not be checked. Nothing has been sent.</p><button className="q-button q-button--outline" type="button" onClick={() => void config.refetch()}><RotateCcw size={16}/> Check again</button></div>
        : !config.data?.available || !config.data.turnstile_site_key ? <div className="q-state" role="status"><h3>Questions aren’t open yet.</h3><p>The private question desk is temporarily unavailable for this project. Please check back later.</p></div>
        : sent ? <div className="q-state" role="status" data-testid="status-question-submitted"><span className="q-kicker">Sent privately</span><h3>Your question is on its way.</h3><p>If the filmmaker replies, we’ll send the answer to the address you provided. Your contact details are not shown on the project page.</p><button type="button" className="q-button q-button--outline" onClick={() => { setSent(false); setQuestion(''); setFeedback(''); }}>Ask another question <ArrowUpRight size={16}/></button></div>
        : <form onSubmit={event => void submit(event)}>
          <span className="q-kicker">Private correspondence</span><h3 className="q-title">Write to the filmmaker.</h3>
          <label className="q-field">First name<input data-testid="input-question-first-name" required maxLength={80} autoComplete="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} placeholder="Your first name"/></label>
          <label className="q-field">Email for the reply<input data-testid="input-question-email" required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/><small>Kept private. Used only for this correspondence.</small></label>
          <label className="q-field">Your question<textarea data-testid="textarea-question" required minLength={5} maxLength={3000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What would you like to know about this project?"/><small>{question.length} / 3000 characters</small></label>
          <Verification siteKey={config.data.turnstile_site_key} onToken={setToken} resetRef={resetRef}/>
          {feedback && <p role="alert" className="q-feedback" data-testid="error-question-submit">{feedback}</p>}
          <button type="submit" className="q-button" data-testid="button-ask-filmmaker" disabled={!token || ask.isPending}>{ask.isPending ? 'Sending privately…' : 'Send private question'} <ArrowUpRight size={16}/></button>
        </form>}
      </div>
    </div>
  </section>;
}