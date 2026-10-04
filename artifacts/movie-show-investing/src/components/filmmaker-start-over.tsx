import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { inspectFilmmakerDraftReset, resetFilmmakerDrafts } from '@workspace/api-client-react';
import { clearFilmmakerAuthHandoff } from '@/lib/filmmaker-auth-handoff';
import { clearFilmmakerAction } from '@/lib/filmmaker-intent';

export function FilmmakerStartOver({ disabled = false, beforeInspect, onSettled, draftId }: {
  disabled?: boolean;
  draftId?: number;
  beforeInspect?: () => Promise<void>;
  onSettled?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function startOver() {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      await beforeInspect?.();
      const headers: Record<string, string> = draftId ? { 'X-MSI-Draft-Id': String(draftId) } : {};
      const options = { headers };
      const preview = await inspectFilmmakerDraftReset(options);
      const list = preview.drafts.map(draft => `• ${draft.label}`).join('\n');
      if (!window.confirm(`Start over?\n\n${list || 'Open a fresh filmmaker worksheet.'}\n\nThis permanently clears the unfinished pitch answers and attached material selections listed above, plus unsaved work in this worksheet. You cannot undo this action. Submitted projects, your account, investor work and payment records will not be deleted.\n\nContinue?`)) return;
      await resetFilmmakerDrafts({ ...preview, confirm: true }, options);
      clearFilmmakerAuthHandoff();
      clearFilmmakerAction();
      // Remount the worksheet and its query cache only after a confirmed server
      // reset. A navigation to the same SPA route would retain old form state.
      window.location.replace(`${import.meta.env.BASE_URL}start/filmmaker`);
    } catch (failure) {
      const detail = failure && typeof failure === 'object' && 'data' in failure
        ? (failure.data as { error?: string } | null)?.error : null;
      setError(detail || 'We couldn’t start over. No unconfirmed changes were cleared. Please try again.');
    } finally {
      setBusy(false);
      onSettled?.();
    }
  }
  return <div style={{ marginTop: 18 }}>
    <button type="button" className="fm-back" data-testid="button-filmmaker-start-over" disabled={disabled || busy} onClick={() => void startOver()}>
      <RotateCcw size={16} /> {busy ? 'Starting over…' : 'Start over'}
    </button>
    {error && <p className="fm-error" role="alert" data-testid="error-filmmaker-start-over">{error}</p>}
  </div>;
}