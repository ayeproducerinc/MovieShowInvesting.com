import { ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import type { ExploreProject } from '@workspace/api-client-react';

export function InvestorProjectCard({ project, action, matched = false }: { project: ExploreProject; action?: { label: string; onClick: () => void; disabled?: boolean }; matched?: boolean }) {
  const stageLabel = String(project.stage) === 'other' ? 'Other stage (legacy)' : project.stage || 'Stage not listed';
  return <article className="inv-project" data-testid={`card-project-${project.id}`}>
    <div className="inv-poster">{project.poster_url && <img src={project.poster_url} alt={`${project.title} poster`} loading="lazy" />}</div>
    <div className="inv-project-body">
      <p className="inv-kicker">{project.format || 'Project'} / {stageLabel} / {project.genre || 'Genre not listed'}</p>
      {project.is_owner && <span className="inv-match-badge" data-testid={`badge-owned-project-${project.id}`}>Your project</span>}
      {matched && <span className="inv-match-badge" data-testid={`badge-match-${project.id}`}>Matches your preferences</span>}
      <h2>{project.title}</h2>
      <p>{project.logline || 'Read the project dossier for more about this story.'}</p>
      <div className="inv-project-links">
        <Link href={`/project/${project.slug}`} data-testid={`link-project-${project.id}`}>View project <ArrowUpRight size={13} className="inline"/></Link>
        {project.is_owner && <Link href="/me/projects" data-testid={`link-manage-project-${project.id}`}>Manage project <ArrowUpRight size={13} className="inline"/></Link>}
        {action && !project.is_owner && <button type="button" className="inv-button secondary" data-testid={`button-project-${project.id}`} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>}
      </div>
    </div>
  </article>;
}