import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LockKeyhole, Send, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import { useAnswerQuestionByToken, useReportQuestionByToken } from '@workspace/api-client-react';
import '@/components/questions.css';

function takeToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return /^[a-fA-F0-9]{64}$/.test(token) ? token : '';
}

export default function QuestionToken({ kind }: { kind: 'answer' | 'report' }) {
  const [token] = useState(takeToken);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [answerBlocked, setAnswerBlocked] = useState(false);
  const sendAnswer = useAnswerQuestionByToken();
  const report = useReportQuestionByToken();
  useEffect(() => {
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="referrer"]') ?? document.createElement('meta');
    const previous = meta.content;
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    if (!meta.parentNode) document.head.appendChild(meta);
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]') ?? document.createElement('meta');
    const previousRobots = robots.content;
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    if (!robots.parentNode) document.head.appendChild(robots);
    document.title = kind === 'answer' ? 'Private answer | Movie Show Investing' : 'Report a question | Movie Show Investing';
    return () => { if (previous) meta.content = previous; else meta.remove(); if (previousRobots) robots.content = previousRobots; else robots.remove(); };
  }, [kind]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !answer.trim()) return;
    setError('');
    try {
      await sendAnswer.mutateAsync({ data: { token, answer: answer.trim() } });
      setDone(true);
      setAnswer('');
    } catch {
      setAnswerBlocked(true);
      setError('Delivery could not be confirmed. Do not retry this answer; it may already have been emailed. Your draft remains here.');
    }
  }
  async function submitReport() {
    if (!token) return;
    setError('');
    try {
      await report.mutateAsync({ data: { token } });
      setDone(true);
    } catch {
      setError('The report did not go through. The link may have expired or already been used. Please try again.');
    }
  }
  const isReport = kind === 'report';
  return <main className="q-token-page questions-room"><div className="page-wrap">
    <header className="q-token-head"><Link href="/" className="q-kicker" data-testid="link-token-home">Movie Show Investing</Link><span className="q-kicker">Private correspondence / {isReport ? 'Report' : 'Reply'}</span></header>
    <div className="q-token-layout">
      <div><span className="q-kicker">{isReport ? 'Keep the conversation safe' : 'From your inbox to theirs'}</span><h1 className="q-title">{isReport ? <>A safer<br/><em>space.</em></> : <>Your words,<br/><em>delivered.</em></>}</h1><p className="q-copy">{isReport ? 'If a question crossed a line, use this private link to flag it for review. No reply is required.' : 'Answer the question from your email, directly and privately. Your response will be delivered to the person who asked.'}</p><p className="q-private-note"><LockKeyhole size={17}/> This link is single-use. Contact addresses are never displayed on this page.</p></div>
      <div className="q-token-aside"><div className="q-card">
        {!token ? <div className="q-state" role="alert" data-testid="error-question-token"><h3>This link can’t be opened.</h3><p>Use the complete link from your email. It may be missing its private token.</p><Link href="/me/projects" className="q-button q-button--outline">Open filmmaker desk <ArrowUpRight size={16}/></Link></div>
        : done ? <div className="q-state" role="status" data-testid="status-question-token-complete"><span className="q-kicker">Completed</span><h3>{isReport ? 'Your report was received.' : 'Your answer was sent.'}</h3><p>{isReport ? 'Thank you for helping keep this space trustworthy. The question has been flagged.' : 'The person who asked will receive your private reply by email.'}</p><Link href="/me/projects" className="q-button q-button--outline">Return to the filmmaker desk <ArrowUpRight size={16}/></Link></div>
        : isReport ? <><ShieldAlert size={29} color="#853c4d"/><h2 className="q-title">Report this question.</h2><p className="q-copy">Submit a report for the question linked in your email. This action cannot be undone with the same link.</p>{error && <p className="q-feedback" role="alert">{error}</p>}<button type="button" className="q-button" disabled={report.isPending} onClick={() => void submitReport()} data-testid="button-report-question">{report.isPending ? 'Submitting report…' : 'Report question'} <ArrowUpRight size={16}/></button></>
        : <form onSubmit={event => void submit(event)}><span className="q-kicker">Private reply</span><h2 className="q-title">Write your answer.</h2><label className="q-field">Your message<textarea required maxLength={5000} autoFocus value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Write your reply here…" data-testid="textarea-token-answer"/><small>{answer.length} / 5000 characters</small></label>{error && <p className="q-feedback" role="alert" data-testid="error-token-answer">{error}</p>}<button type="submit" className="q-button" disabled={sendAnswer.isPending || answerBlocked || !answer.trim()} data-testid="button-send-token-answer">{sendAnswer.isPending ? 'Sending…' : 'Send private answer'} <Send size={16}/></button></form>}
      </div></div></div>
    <div style={{marginTop:80,borderTop:'1px solid #c9c0b2',paddingTop:20}}><Link href="/me/projects" className="q-kicker" data-testid="link-token-projects"><ArrowLeft size={13} style={{display:'inline'}}/> Filmmaker desk</Link></div>
  </div></main>;
}