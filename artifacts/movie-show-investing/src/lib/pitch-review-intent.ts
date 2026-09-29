const KEY = 'msi_pitch_review_choice';
const PROOF_KEY = 'msi_pitch_review_checkout_proof';
export type PitchReviewChoice = 'paid' | 'free';

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
  try {
    window.sessionStorage.setItem(KEY, paid ? 'selected:paid' : 'selected:free');
  } catch {
    // Storage restrictions must not prevent a filmmaker from creating a pitch.
  }
}

export function recordPitchForReview(projectId: number | null) {
  // Offer review once after every completed pitch, including pitches started for free.
  try {
    if (projectId) {
      const selected = window.sessionStorage.getItem(KEY);
      const choice: PitchReviewChoice = selected === 'selected:paid' || selected === 'selected' ? 'paid' : 'free';
      window.sessionStorage.setItem(KEY, `project:${projectId}:${choice}`);
    } else {
      window.sessionStorage.removeItem(KEY);
    }
  } catch {
    // Submission succeeded even if this browser cannot persist a one-time offer.
  }
}

export function consumePitchReviewChoice(projectId: number): PitchReviewChoice | null {
  try {
    const saved = window.sessionStorage.getItem(KEY);
    if (saved !== `project:${projectId}:paid` && saved !== `project:${projectId}:free` && saved !== `project:${projectId}`) return null;
    window.sessionStorage.removeItem(KEY);
    return saved === `project:${projectId}:paid` ? 'paid' : 'free';
  } catch {
    return null;
  }
}