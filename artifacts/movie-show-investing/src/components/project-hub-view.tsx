import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Plus, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import './project-hub-view.css';

export type ProjectHubItem = {
  project_id: number;
  project_slug: string | null;
  title: string;
  approved: boolean;
  hidden: boolean;
  created_at: string;
  /** Private confirmed pledge total and distinct backers. */
  pledged_total?: number;
  backer_count?: number;
};

export type ProjectHubViewProps = {
  email: string;
  projects: ProjectHubItem[];
  draftAvailable: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  phoneVerificationSlot: ReactNode;
  /** Secondary draft controls, such as Start over. */
  draftActions?: ReactNode;
  onStart: () => void;
  onResume: () => void;
  onOpen: (projectId: number) => void;
  onRetry: () => void;
};

function formattedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export function ProjectHubView({
  email,
  projects,
  draftAvailable,
  loading,
  busy,
  error,
  phoneVerificationSlot,
  draftActions,
  onStart,
  onResume,
  onOpen,
  onRetry,
}: ProjectHubViewProps) {
  return (
    <section className="project-hub" aria-label="Your film projects" aria-busy={loading || busy}>
      <div className="project-hub__wrap">
        <header className="project-hub__header">
          <div>
            <h1 className="project-hub__title">My projects</h1>
            <span className="project-hub__email" data-testid="text-project-hub-email" title={email}>{email}</span>
          </div>
          <button type="button" className="project-hub__action" data-testid="button-project-hub-start" onClick={onStart} disabled={loading || busy}><Plus size={17} aria-hidden="true" /> New project</button>
        </header>

        {!loading && !error && draftAvailable && (
          <div className="project-hub__draft" data-testid="card-project-hub-draft">
            <div>
              <h2>Draft in progress</h2>
              <p>You have an unfinished worksheet. Your answers are saved.</p>
              {draftActions}
            </div>
            <button type="button" className="project-hub__action" data-testid="button-project-hub-resume" onClick={onResume} disabled={busy}>Resume draft <ArrowRight size={17} aria-hidden="true" /></button>
          </div>
        )}
        {phoneVerificationSlot}

        <div className="project-hub__section-head">
          <h2>Projects</h2>
          {!loading && !error && <span className="project-hub__meta" data-testid="text-project-hub-count">{projects.length}</span>}
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
            <h3>Your projects couldn’t load.</h3>
            <p>{error}</p>
            <button type="button" className="project-hub__action project-hub__action--outline" data-testid="button-project-hub-retry" onClick={onRetry} disabled={busy}>Try again <RotateCcw size={16} aria-hidden="true" /></button>
          </div>
        ) : projects.length > 0 ? (
          <ul className="project-hub__list" data-testid="list-project-hub-projects">
            {projects.map((project) => {
              const status = project.hidden ? 'Hidden' : project.approved ? 'Approved' : 'Unlisted';
              const title = project.title?.trim() || 'Untitled project';
              return (
                <li className="project-hub__item" key={project.project_id} data-testid={`row-project-hub-${project.project_id}`}>
                  <div className="project-hub__project-info">
                    <span className="project-hub__project-title" data-testid={`text-project-title-${project.project_id}`}>{title}</span>
                    <span className="project-hub__project-date" data-testid={`text-project-date-${project.project_id}`}>
                      Created {formattedDate(project.created_at)}
                      {project.backer_count !== undefined && <span data-testid={`text-project-pledged-${project.project_id}`}> · {project.backer_count ? `${dollars(project.pledged_total ?? 0)} pledged · ${project.backer_count} backer${project.backer_count === 1 ? '' : 's'}` : 'No pledges yet'}</span>}
                    </span>
                  </div>
                  <span className={`project-hub__status project-hub__status--${status.toLowerCase()}`} data-testid={`status-project-${project.project_id}`}>{status}</span>
                  <div className="project-hub__row-actions">
                    <button type="button" className="project-hub__action" data-testid={`button-open-project-${project.project_id}`} onClick={() => onOpen(project.project_id)} disabled={busy} aria-label={`Manage ${title}`}>Manage</button>
                    {project.project_slug && !project.hidden && <Link href={`/project/${project.project_slug}`} className="project-hub__action project-hub__action--outline" data-testid={`link-view-project-${project.project_id}`}>View page <ArrowUpRight size={15} aria-hidden="true" /></Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="project-hub__state" data-testid="status-project-hub-empty">
            <h3>No projects yet.</h3>
            <p>Start a worksheet to pitch your first film or show.</p>
            <button type="button" className="project-hub__action" onClick={onStart} disabled={busy}>Start a project <ArrowRight size={17} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </section>
  );
}
