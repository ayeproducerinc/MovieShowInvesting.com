import { ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import { ProposalSummary } from './proposal-summary';
import { exploreStoryHook } from '@/lib/explore-recap';
import type { ExploreProject } from '@workspace/api-client-react';

type ExploreProjectWithDeck = ExploreProject & { pitch_deck_url?: string | null; pitch_deck_name?: string | null };
function safeDeckUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function InvestorProjectCard({ project, action, matched = false, showPitchDeck = false, variant = 'default' }: { project: ExploreProjectWithDeck; action?: { label: string; onClick: () => void; disabled?: boolean }; matched?: boolean; showPitchDeck?: boolean; variant?: 'default' | 'explore' }) {
  const recap = variant === 'explore';
  const stageLabel = String(project.stage) === 'other' ? 'Other stage (legacy)' : project.stage || 'Stage not listed';
  const deckUrl = !recap && showPitchDeck ? safeDeckUrl(project.pitch_deck_url) : null;
  return <article className="inv-project" data-testid={`card-project-${project.id}`}>
    <div className="inv-poster">{project.poster_url && <img src={project.poster_url} alt={`${project.title} poster`} loading="lazy" />}</div>
    <div className="inv-project-body">
      <p className="inv-kicker">{project.format || 'Project'} / {stageLabel} / {project.genre || 'Genre not listed'}</p>
      {project.is_owner && <span className="inv-match-badge" data-testid={`badge-owned-project-${project.id}`}>Your project</span>}
      {matched && <span className="inv-match-badge" data-testid={`badge-match-${project.id}`}>Matches your preferences</span>}
      <h2>{project.title}</h2>
      <p data-testid={`story-project-${project.id}`}>{recap ? exploreStoryHook(project.logline) : project.logline || 'Read the project dossier for more about this story.'}</p>
      {!recap && (project.proposal || project.budget) && <ProposalSummary proposal={project.proposal} budget={project.budget} stage={project.stage} testId={`proposal-${project.id}`} />}
      <div className="inv-project-links">
        <Link href={`/project/${project.slug}`} className={recap ? 'explore-view-project' : undefined} data-testid={`link-project-${project.id}`}>View project <ArrowUpRight size={13} className="inline"/></Link>
        {deckUrl && <a href={deckUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-pitch-deck-${project.id}`}>View pitch deck <ArrowUpRight size={13} className="inline"/></a>}
        {project.is_owner && <Link href="/me/projects" data-testid={`link-manage-project-${project.id}`}>Manage project <ArrowUpRight size={13} className="inline"/></Link>}
        {action && !project.is_owner && <button type="button" className="inv-button secondary" data-testid={`button-project-${project.id}`} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>}
      </div>
    </div>
  </article>;
}