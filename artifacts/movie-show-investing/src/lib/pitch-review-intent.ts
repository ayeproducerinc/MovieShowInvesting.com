const KEY = 'msi_pitch_review_choice';
const PROOF_KEY = 'msi_pitch_review_checkout_proof';

export function storePitchReviewProof(projectId: number | null, proof: string | null) {
  try {
    if (projectId && proof) window.sessionStorage.setItem(PROOF_KEY, JSON.stringify({ projectId, proof }));
    else window.sessionStorage.removeItem(PROOF_KEY);
  } catch {
    // The result endpoint can issue a fresh checkout proof when storage is unavailable.
  }
}

export function getPitchReviewProof(projectId: number | null): string | null {
  if (!projectId) return null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(PROOF_KEY) || 'null');
    return saved?.projectId === projectId && typeof saved.proof === 'string' ? saved.proof : null;
  } catch {
    return null;
  }
}

export function choosePitchReview(paid: boolean) {
  if (paid) window.sessionStorage.setItem(KEY, 'selected');
  else window.sessionStorage.removeItem(KEY);
}

export function recordPitchForReview(projectId: number | null) {
  if (projectId && window.sessionStorage.getItem(KEY) === 'selected') {
    window.sessionStorage.setItem(KEY, `project:${projectId}`);
  } else {
    window.sessionStorage.removeItem(KEY);
  }
}

export function consumePitchReviewChoice(projectId: number) {
  if (window.sessionStorage.getItem(KEY) !== `project:${projectId}`) return false;
  window.sessionStorage.removeItem(KEY);
  return true;
}