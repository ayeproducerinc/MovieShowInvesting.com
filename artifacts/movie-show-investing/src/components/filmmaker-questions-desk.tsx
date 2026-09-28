import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, LockKeyhole, RotateCcw, Send } from 'lucide-react';
import { Link } from 'wouter';
import { getGetFilmmakerQuestionsQueryKey, useAnswerFilmmakerQuestion, useGetFilmmakerQuestions } from '@workspace/api-client-react';
import './questions.css';

type ProjectSummary = { id: number; title: string | null; slug: string | null };

function QuestionProject({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient();
  const list = useGetFilmmakerQuestions(project.id, { query: { queryKey: getGetFilmmakerQuestionsQueryKey(project.id), retry: (count, error) => error.status !== 401 && error.status !== 403 && count < 2 } });
  const answer = useAnswerFilmmakerQuestion();
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);
  const questions = [...(list.data?.questions ?? [])].sort((a,b) => Number(!!a.answer) - Number(!!b.answer) || new Date(b.asked_at).getTime() - new Date(a.asked_at).getTime());
  const unanswered = questions.filter(question => !question.answer && !question.reported && !question.delivery_pending).length;
  async function submit(event: FormEvent<HTMLFormElement>, messageId: number) {
    event.preventDefault();
    if (!text.trim()) return;
    setError('');
    try {
      await answer.mutateAsync({ projectId: project.id, messageId, data: { answer: text.trim() } });
      setEditing(null);
      setText('');
      setDone(messageId);
      await queryClient.invalidateQueries({ queryKey: getGetFilmmakerQuestionsQueryKey(project.id) });
    } catch {
      setBlocked(messageId);
      setError('Delivery could not be confirmed. Do not retry this answer; it may already have been emailed.');
    }
  }
  return <section className="q-project" data-testid={`section-project-questions-${project.id}`}>
    <div className="q-project__top"><h3 className="q-project__name">{project.title || 'Untitled project'}</h3><span className="q-count" data-testid={`status-unanswered-count-${project.id}`}>{unanswered} awaiting reply</span></div>
    {project.slug && <Link className="q-kicker" href={`/project/${project.slug}`} data-testid={`link-question-project-${project.id}`}>View public dossier <ArrowUpRight size={13} style={{display:'inline'}}/></Link>}
    {list.isLoading ? <div role="status" aria-label={`Loading questions for ${project.title || 'project'}`}><div className="q-skeleton" style={{width:'42%'}}/><div className="q-skeleton" style={{height:85}}/></div>
    : list.isError ? <div className="q-state" role="alert"><h3>Questions are out of reach.</h3><p>We couldn’t load this project’s private correspondence. Nothing has changed.</p><button type="button" className="q-button q-button--outline" onClick={() => void list.refetch()}><RotateCcw size={16}/> Try again</button></div>
    : !questions.length ? <div className="q-state"><h3>No questions yet.</h3><p>When someone writes from this film’s dossier, their question will appear here. Only you can see this desk.</p></div>
    : <div className="q-list">{questions.map(item => <article key={item.id} className={`q-item ${item.answer ? 'q-item--answered' : ''}`} data-testid={`card-question-${item.id}`}>
      <div className="q-item__top"><span className="q-item__meta">From {item.first_name || 'A visitor'} · {new Date(item.asked_at).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'})}</span><span className="q-item__meta q-item__status">{item.reported ? 'Reported' : item.answer ? 'Answered' : item.delivery_pending ? 'Delivery needs review' : 'Awaiting your reply'}</span></div>
      <p className="q-item__body" data-testid={`text-question-${item.id}`}>{item.question || 'Question content unavailable.'}</p>
      {item.answer ? <blockquote className="q-answer" data-testid={`text-answer-${item.id}`}><span className="q-kicker">Your answer · {item.answered_at ? new Date(item.answered_at).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'sent'}</span>{item.answer}</blockquote>
      : item.reported ? <p className="q-copy">This question has been reported. Replies are unavailable.</p>
      : item.delivery_pending ? <p className="q-feedback" role="status">This answer may already have been emailed. To prevent a duplicate, it cannot be retried automatically.</p>
      : editing === item.id ? <form className="q-answer-form" onSubmit={event => void submit(event, item.id)}>
        <label className="q-field">Your private answer<textarea autoFocus required maxLength={5000} value={text} onChange={event => setText(event.target.value)} data-testid={`textarea-answer-${item.id}`} placeholder="Write a thoughtful reply…"/><small>{text.length} / 5000 characters · The reply is delivered by email.</small></label>
        {error && <p className="q-feedback" role="alert" data-testid={`error-answer-${item.id}`}>{error}</p>}
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="q-button" type="submit" disabled={answer.isPending || blocked === item.id || !text.trim()} data-testid={`button-send-answer-${item.id}`}>{answer.isPending ? 'Sending…' : 'Send private answer'} <Send size={15}/></button><button className="q-button q-button--outline" type="button" disabled={answer.isPending} onClick={() => { setEditing(null); setError(''); }}>Cancel</button></div>
      </form>
      : <button type="button" className="q-button q-button--outline" data-testid={`button-reply-question-${item.id}`} onClick={() => { setEditing(item.id); setText(''); setError(''); setDone(null); }}>Write an answer <ArrowUpRight size={15}/></button>}
      {done === item.id && <p className="q-feedback q-feedback--success" role="status">Your answer was sent privately.</p>}
    </article>)}</div>}
  </section>;
}

export function FilmmakerQuestionsDesk({ projects }: { projects: ProjectSummary[] }) {
  return <section className="q-desk questions-room" aria-label="Private questions"><div className="page-wrap">
    <div className="q-desk__head"><div><span className="q-kicker">The filmmaker desk / Private correspondence</span><h2 className="q-title">Questions,<br/><em>answered.</em></h2></div><p className="q-copy"><LockKeyhole size={17} style={{display:'inline',verticalAlign:'middle',marginRight:8}}/>Each conversation belongs to its project. Unanswered questions come first; neither party’s email address is shown here.</p></div>
    {projects.length ? projects.map(project => <QuestionProject key={project.id} project={project}/>) : <div className="q-state" style={{marginTop:32}}><h3>A quiet desk for now.</h3><p>Your project conversations will appear here once you have a project.</p></div>}
  </div></section>;
}