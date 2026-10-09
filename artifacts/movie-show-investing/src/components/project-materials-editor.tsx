import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLocation } from 'wouter';
import { DraftPitchMaterials, UnsavedMaterialError, type DraftPitchMaterialsHandle } from './draft-pitch-materials';

export function ProjectMaterialsEditor({ projectId, title }: { projectId: number; title: string }) {
  const [, navigate] = useLocation();
  const materials = useRef<DraftPitchMaterialsHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    heading.current?.focus({ preventScroll: true });
  }, []);

  async function returnToOverview() {
    if (busy || returning) return;
    setReturning(true);
    setError('');
    try {
      await materials.current?.flush();
      navigate('/start/filmmaker/done?details=materials');
    } catch (cause) {
      setError(cause instanceof UnsavedMaterialError ? cause.message
        : 'Your latest materials could not be saved. Retry the save or clear the unfinished change before returning.');
    } finally {
      setReturning(false);
    }
  }

  return <>
    <div className="dossier-hero">
      <p className="dossier-kicker">Account-owned project / edit</p>
      <h1 ref={heading} tabIndex={-1} className="dossier-title">Manage your<br/><em>pitch materials.</em></h1>
      <p className="dossier-lead">Update or remove the optional materials attached to {title || 'this selected project'}. Hidden projects remain editable; their decks are not public.</p>
      <button type="button" className="dossier-button dossier-button-outline" data-testid="link-finish-managing-materials" disabled={busy || returning} onClick={() => void returnToOverview()}>
        <ArrowRight size={16}/>{busy ? 'Wait for materials to finish saving…' : returning ? 'Saving before returning…' : 'Return to project overview'}
      </button>
      {error && <p className="dossier-error" role="alert">{error}</p>}
    </div>
    <DraftPitchMaterials ref={materials} draftId={null} projectId={projectId} onBusyChange={setBusy}/>
  </>;
}