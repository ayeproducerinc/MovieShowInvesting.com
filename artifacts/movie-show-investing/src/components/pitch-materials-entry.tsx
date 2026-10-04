import type { MouseEventHandler } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

export function PitchMaterialsEntry({ onOpen, warning, disabled = false }: {
  onOpen?: MouseEventHandler<HTMLAnchorElement>;
  warning?: string;
  disabled?: boolean;
}) {
  return <div className="dossier-section" data-testid="section-manage-pitch-materials" style={{ marginTop: 18 }}>
    <h3>Pitch materials</h3>
    <p>Synopsis, trailer, poster, share image, and pitch deck.</p>
    <Link href="/start/filmmaker/done?edit=materials" onClick={onOpen}
      aria-disabled={disabled || undefined} className="dossier-button dossier-button-outline"
      data-testid="link-manage-pitch-materials">Manage pitch materials <ArrowRight size={16}/></Link>
    {warning && <p className="dossier-error" role="alert" data-testid="warning-unsaved-pitch-details">{warning}</p>}
  </div>;
}