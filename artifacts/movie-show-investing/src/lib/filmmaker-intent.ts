const KEY = 'msi_filmmaker_next_action';
export type FilmmakerAction = 'start' | 'manage';

export function setFilmmakerAction(action: FilmmakerAction) {
  window.localStorage.setItem(KEY, action);
}

export function clearFilmmakerAction() {
  window.localStorage.removeItem(KEY);
}

export function hasPendingStartAction() {
  return window.localStorage.getItem(KEY) === 'start';
}

export function pendingFilmmakerAction(): FilmmakerAction | null {
  const params = new URLSearchParams(window.location.search);
  const direct = params.get('action');
  if (direct === 'start' || direct === 'manage') return direct;
  const continuation = params.get('continueUrl');
  if (continuation) {
    try {
      const url = new URL(continuation);
      const nested = url.searchParams.get('action');
      if (url.origin === window.location.origin && (nested === 'start' || nested === 'manage')) return nested;
    } catch { /* Ignore invalid email-link continuation. */ }
  }
  const stored = window.localStorage.getItem(KEY);
  return stored === 'start' || stored === 'manage' ? stored : null;
}