const KEY = 'msi_pitch_review_choice';

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