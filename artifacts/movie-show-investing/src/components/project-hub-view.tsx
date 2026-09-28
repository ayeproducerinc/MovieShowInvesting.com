import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, RotateCcw } from 'lucide-react';
import './project-hub-view.css';

export type ProjectHubItem = {
  project_id: number;
  project_slug: string | null;
  title: string;
  approved: boolean;
  hidden: boolean;
  created_at: string;
};

export type ProjectHubViewProps = {
  email: string;
  initiallyOpen?: boolean;
  projects: ProjectHubItem[];
  draftAvailable: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  phoneVerificationSlot: ReactNode;
  onStart: () => void;
  onResume: () => void;
  onOpen: (projectId: number) => void;
  onSignOut: () => void;
  onRetry: () => void;
};

function formattedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function ProjectHubView({
  email,
  initiallyOpen = false,
  projects,
  draftAvailable,
  loading,
  busy,
  error,
  phoneVerificationSlot,
  onStart,
  onResume,
  onOpen,
  onSignOut,
  onRetry,
}: ProjectHubViewProps) {
  const projectsHeading = useRef<HTMLHeadingElement>(null);
  const [showProjects, setShowProjects] = useState(initiallyOpen);
  useEffect(() => {
    if (showProjects && !loading && !error) projectsHeading.current?.focus();
  }, [showProjects, loading, error]);
  function manage() {
    setShowProjects(true);
  }
  return (
    <section className="project-hub" aria-label="Your film projects" aria-busy={loading || busy}>
      <div className="project-hub__wrap">
        <header className="project-hub__masthead">
          <span className="project-hub__mark">Movie Show Investing / Filmmaker desk</span>
          <div className="project-hub__identity">
            <span data-testid="text-project-hub-email" title={email}>{email}</span>
            <button type="button" className="project-hub__text-button" data-testid="button-project-hub-sign-out" onClick={onSignOut} disabled={busy}>Sign out</button>
          </div>
        </header>

        <div className="project-hub__intro">
          <div>
            <p className="project-hub__eyebrow">Your private project desk</p>
            <h1 className="project-hub__title">Every story<br /><em>has its place.</em></h1>
            <p className="project-hub__lede">Your film projects live here, each with its own details and next steps. Pick up where you left off, or make room for something new.</p>
          </div>
          <div className="project-hub__intro-aside">
            <p className="project-hub__eyebrow">A note for filmmakers</p>
            <p>This desk is private to your signed-in account. Your projects stay separate, so the right story is always the one in front of you.</p>
          </div>
        </div>

        <div className="project-hub__entry-actions" aria-label="Project desk actions">
          <button type="button" className="project-hub__action project-hub__action--outline" data-testid="button-project-hub-manage" onClick={manage} disabled={loading || busy || !!error}>Manage projects <ArrowRight size={17} aria-hidden="true" /></button>
          <button type="button" className="project-hub__action" data-testid="button-project-hub-start" onClick={onStart} disabled={loading || busy}>Start another project <ArrowRight size={17} aria-hidden="true" /></button>
        </div>
        {phoneVerificationSlot}

        {(showProjects || loading || !!error) && <div className="project-hub__body">
          <div className="project-hub__main">
            <div className="project-hub__section-head">
              <h2 ref={projectsHeading} tabIndex={-1}>Projects on file</h2>
              {!loading && !error && <span className="project-hub__meta" data-testid="text-project-hub-count">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>}
            </div>

            {loading ? (
              <div role="status" aria-label="Loading your projects" data-testid="status-project-hub-loading">
                {[0, 1, 2].map((index) => (
                  <div className="project-hub__skeleton-row" key={index} aria-hidden="true">
                    <div className="project-hub__skeleton project-hub__skeleton--title" />
                    <div className="project-hub__skeleton project-hub__skeleton--line" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="project-hub__state project-hub__state--error" role="alert" data-testid="status-project-hub-error">
                <p className="project-hub__eyebrow">Connection interrupted</p>
                <h3>Your stories are still here.</h3>
                <p>{error}</p>
                <button type="button" className="project-hub__action project-hub__action--outline" data-testid="button-project-hub-retry" onClick={onRetry} disabled={busy}>Try again <RotateCcw size={16} aria-hidden="true" /></button>
              </div>
            ) : (
              <>
                {projects.length > 0 ? (
                  <ol className="project-hub__list" data-testid="list-project-hub-projects">
                    {projects.map((project, index) => {
                      const status = project.hidden ? 'Hidden' : project.approved ? 'Approved' : 'Unlisted';
                      return (
                        <li className="project-hub__item" key={project.project_id} data-testid={`row-project-hub-${project.project_id}`}>
                          <button
                            type="button"
                            className="project-hub__project"
                            data-testid={`button-open-project-${project.project_id}`}
                            onClick={() => onOpen(project.project_id)}
                            disabled={busy}
                            aria-label={`Open ${project.title?.trim() || 'Untitled project'}`}
                          >
                            <span className="project-hub__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                            <span>
                              <span className="project-hub__project-title" data-testid={`text-project-title-${project.project_id}`}>{project.title?.trim() || 'Untitled project'}</span>
                              <span className="project-hub__project-date" data-testid={`text-project-date-${project.project_id}`}>Saved {formattedDate(project.created_at)}</span>
                            </span>
                            <span className={`project-hub__status project-hub__meta project-hub__status--${status.toLowerCase()}`} data-testid={`status-project-${project.project_id}`}>{status}</span>
                            <ArrowUpRight className="project-hub__project-arrow" size={19} strokeWidth={1.7} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="project-hub__state" data-testid="status-project-hub-empty">
                    <p className="project-hub__eyebrow">Nothing filed yet</p>
                    <h3>A blank page is a beginning.</h3>
                    <p>Your first film project will appear here once it is saved. Start with the story you want to tell.</p>
                    <button type="button" className="project-hub__action" data-testid="button-project-hub-start-empty" onClick={onStart} disabled={busy}>Start a project <ArrowRight size={17} aria-hidden="true" /></button>
                  </div>
                )}

                {draftAvailable && (
                  <div className="project-hub__draft" data-testid="card-project-hub-draft">
                    <div>
                      <p className="project-hub__eyebrow">Unfinished worksheet / Draft</p>
                      <h3>Still in the making.</h3>
                      <p>You have a worksheet in progress. Return to your saved answers when you’re ready.</p>
                    </div>
                    <button type="button" className="project-hub__action" data-testid="button-project-hub-resume" onClick={onResume} disabled={busy}>Resume draft <ArrowRight size={17} aria-hidden="true" /></button>
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="project-hub__side">
            <div className="project-hub__side-card">
              <p className="project-hub__eyebrow">The next chapter</p>
              <h2>Another film<br />in mind?</h2>
              <p>Start a separate worksheet for each project. Nothing from one film needs to carry over to the next.</p>
              <div className="project-hub__side-rule" />
              <p className="project-hub__fineprint">This is a prelaunch space for filmmakers. No investments are available and no money is collected here.</p>
            </div>
          </aside>
        </div>}
      </div>
    </section>
  );
}