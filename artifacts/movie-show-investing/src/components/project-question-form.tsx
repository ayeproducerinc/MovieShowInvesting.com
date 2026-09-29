import { LockKeyhole } from 'lucide-react';
import './questions.css';

export function ProjectQuestionForm({ title }: { slug: string; title: string }) {
  return <section id="ask-filmmaker" className="q-section questions-room" aria-label="Ask the filmmaker">
    <div className="q-section-inner">
      <div>
        <span className="q-kicker">A private line / {title}</span>
        <h2 className="q-title">A question worth<br/><em>asking.</em></h2>
        <p className="q-copy">Private questions are not open yet.</p>
        <p className="q-private-note"><LockKeyhole size={17}/> No questions or contact details are being collected here.</p>
      </div>
      <div className="q-card">
        <div className="q-state" role="status">
          <h3>Questions aren’t open yet.</h3>
          <p>The private question desk is temporarily unavailable for this project. Please check back later.</p>
        </div>
      </div>
    </div>
  </section>;
}