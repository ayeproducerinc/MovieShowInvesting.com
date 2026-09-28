import { ArrowDown, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { ArrowButton } from '@/components/site-shell';
import { usePublicSite } from '@/hooks/use-public-site';
import './home.css';

const filmmakerSteps = [
  ['Create your project.', 'Tell us what you’re making and what it may cost.'],
  ['Propose the terms.', 'Explore an illustrative payback target and explain what you have in mind.'],
  ['Build interest.', 'Create a free, unlisted pitch and share its link. Choose the $49 test checkout to submit it for editorial review; only approved pitches enter public discovery.'],
];

const investorSteps = [
  ['Find a story.', 'Browse approved movies and shows.'],
  ['Discuss the possibilities.', 'Review proposed terms and, when eligible, speak privately with the filmmaker.'],
  ['Pledge and share.', 'Record your interest without paying, and share public project pages with friends and family.'],
];

function ProcessColumn({ title, steps, index }: { title: string; steps: string[][]; index: string }) {
  return (
    <div className="home-process__column">
      <div className="home-process__column-head">
        <span className="home-process__index">{index}</span>
        <h3>{title}</h3>
      </div>
      <ol>
        {steps.map(([lead, body], step) => (
          <li key={lead}>
            <span className="home-process__number">0{step + 1}</span>
            <p><strong>{lead}</strong> {body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Home() {
  const { stats } = usePublicSite();
  return (
    <>
      <section className="home-hero">
        <div className="page-wrap home-hero__grid">
          <div className="home-hero__content reveal">
            <p className="home-hero__eyebrow"><span className="home-hero__rule" /> GOT A MOVIE OR SHOW?</p>
            <h1 data-testid="text-home-headline">Pitch to investors.<br /><em>Pay with returns, not T-shirts.</em></h1>
            <p className="home-hero__intro">Create a project, show its budget, and propose potential return terms. Investors can discover approved projects, discuss possible terms, and pledge interest—not money.</p>
            <div className="home-hero__actions">
              <ArrowButton href="/start/filmmaker" testId="link-home-filmmaker">Pitch your project</ArrowButton>
              <ArrowButton href="/explore" testId="link-home-explore" outline>Explore projects</ArrowButton>
            </div>
            <Link href="/pricing" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">View filmmaker pricing</Link>
            <p className="home-hero__notice">Pledges are non-binding. No money is collected, and no investment is offered on this site today.</p>
            {stats.isLoading && <div role="status" aria-label="Loading filmmaker count" className="home-hero__count-skeleton" />}
            {stats.isError && <div className="home-hero__count-error" role="status">Community count is temporarily unavailable. <button type="button" data-testid="button-retry-stats" onClick={() => stats.refetch()}>Try again</button></div>}
            {typeof stats.data?.filmmakers === 'number' && stats.data.filmmakers > 0 && <p data-testid="text-filmmaker-count" className="home-hero__count"><span aria-hidden="true" /> {stats.data.filmmakers.toLocaleString()} filmmakers have joined</p>}
          </div>
          <div className="home-hero__visual reveal-delayed">
            <img src="/film-frame.jpg" alt="An empty cinema with a softly illuminated screen" />
            <div className="home-hero__visual-shade" />
            <div className="home-hero__frame-label" aria-hidden="true"><span>MSI / 001</span><span>THE OPENING FRAME</span></div>
          </div>
        </div>
        <a href="#how-it-works" data-testid="link-home-how-it-works" className="home-hero__scroll"><span>How it works</span><ArrowDown size={17} strokeWidth={1.5} aria-hidden="true" /></a>
      </section>

      <section id="how-it-works" className="home-process">
        <div className="page-wrap">
          <div className="home-process__heading">
            <p className="home-section-label">THE PROCESS / 01</p>
            <h2>How it works</h2>
          </div>
          <div className="home-process__grid">
            <ProcessColumn index="A" title="For filmmakers" steps={filmmakerSteps} />
            <ProcessColumn index="B" title="For potential investors" steps={investorSteps} />
          </div>
        </div>
      </section>

      <section className="home-context">
        <div className="page-wrap home-context__grid">
          <div>
            <p className="home-section-label">READ BEFORE YOU BEGIN / 02</p>
            <h2>Important<br /><em>context</em></h2>
          </div>
          <div className="home-context__copy">
            <p>Pledges are non-binding. No money is collected, and no investment is offered on this site today. Returns are not guaranteed; you may get back less, or nothing. Any future investment would require separate offering documents and a separate decision.</p>
            <Link href="/disclaimers" data-testid="link-home-disclaimers">Read the disclaimers <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
    </>
  );
}