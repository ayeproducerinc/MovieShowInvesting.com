import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AuthUser } from '@workspace/api-client-react';
import { setAuthTokenGetter } from '@workspace/api-client-react';

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (returnTo?: string) => void;
  logout: (returnTo?: string) => void;
}

const ACTIVE_KEY = 'msi_replit_auth_active';
let user: AuthUser | null = null;
let loading = true;
let initialLoadStarted = false;
let initialResolved = false;
let listeners = new Set<() => void>();
let currentIdentity: string | null | undefined;
let inFlight: Promise<void> | null = null;
let refreshAgain = false;
let logoutPending = false;
let listenersInitialized = false;
const queryClients = new Map<QueryClient, number>();
let broadcast: BroadcastChannel | null = null;

function hasReplitAuthMarker() {
  const marker = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_KEY) : null;
  return marker === '1' || Boolean(marker?.startsWith('1:'));
}

function publish() {
  listeners.forEach(listener => listener());
}

export function isReplitAuthActive() {
  return user !== null || hasReplitAuthMarker();
}

export function isReplitAuthLoading() {
  return loading;
}

export function markReplitAuthActive() {
  if (typeof window !== 'undefined') window.localStorage.setItem(ACTIVE_KEY, `1:${Date.now()}`);
  setAuthTokenGetter(null);
}

export function clearReplitAuthMarker() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(ACTIVE_KEY);
}

function registerQueryClient(queryClient: QueryClient, delta: 1 | -1) {
  const count = (queryClients.get(queryClient) ?? 0) + delta;
  if (count <= 0) queryClients.delete(queryClient);
  else queryClients.set(queryClient, count);
}

function setUser(next: AuthUser | null) {
  const nextIdentity = next?.id ?? null;
  const identityChanged = currentIdentity !== nextIdentity;
  if (identityChanged) {
    currentIdentity = nextIdentity;
    queryClients.forEach((_count, queryClient) => queryClient.clear());
  }
  user = next;
  if (user) {
    if (identityChanged || !hasReplitAuthMarker()) markReplitAuthActive();
  } else clearReplitAuthMarker();
  if (user || isReplitAuthActive()) setAuthTokenGetter(null);
  if (identityChanged && user) notifyOtherTabs();
}

function safeReturnTo(value: string) {
  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin) return getBasePath();
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return getBasePath();
  }
}

function notifyOtherTabs() {
  try {
    broadcast?.postMessage({ type: 'revalidate-session' });
  } catch {
    // Cross-tab notification is best effort; focus and visibility events revalidate too.
  }
}

// Background checks (focus, visibility, other tabs) run silently once the
// session is known: flipping to loading would unmount auth-gated pages and
// drop the bearer token mid-upload. A real identity change still publishes.
function revalidate(background = false) {
  if (typeof window === 'undefined') return;
  if (logoutPending) {
    refreshAgain = true;
    return;
  }
  if (inFlight) {
    refreshAgain = true;
    return;
  }
  const silent = background && initialResolved;
  if (!silent) {
    loading = true;
    setAuthTokenGetter(null);
    publish();
  }
  let resolved = false;
  inFlight = fetch('/api/auth/user', { credentials: 'include', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ user: AuthUser | null }>;
    })
    .then(result => {
      if (logoutPending) return;
      resolved = true;
      setUser(result.user ?? null);
    })
    .catch(() => {
      if (!isReplitAuthActive()) user = null;
      else if (!silent) setAuthTokenGetter(null);
    })
    .finally(() => {
      if (!silent) loading = !resolved && isReplitAuthActive();
      if (!loading) initialResolved = true;
      inFlight = null;
      publish();
      if (refreshAgain) {
        refreshAgain = false;
        revalidate(initialResolved);
      }
    });
}

function initializeBrowserListeners() {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      broadcast = new BroadcastChannel('msi-replit-auth');
      broadcast.addEventListener('message', event => {
        if (event.data?.type === 'revalidate-session') revalidate(true);
      });
    } catch {
      broadcast = null;
    }
  }
  window.addEventListener('storage', event => {
    if (event.key === ACTIVE_KEY) revalidate(true);
  });
  window.addEventListener('focus', () => revalidate(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidate(true);
  });
}

function getBasePath() {
  return '/';
}

function currentReturnTo() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || getBasePath();
}

export function useAuth(): AuthState {
  const queryClient = useQueryClient();
  const snapshot = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      registerQueryClient(queryClient, 1);
      initializeBrowserListeners();
      if (!initialLoadStarted) {
        initialLoadStarted = true;
        revalidate();
      }
      return () => {
        listeners.delete(listener);
        registerQueryClient(queryClient, -1);
      };
    },
    () => `${loading ? 'loading' : 'ready'}:${user?.id ?? ''}`,
    () => 'loading:',
  );
  useEffect(() => { initializeBrowserListeners(); }, []);
  const login = useCallback((returnTo = currentReturnTo()) => {
    markReplitAuthActive();
    notifyOtherTabs();
    window.location.assign(`/api/login?returnTo=${encodeURIComponent(returnTo || getBasePath())}`);
  }, []);
  const logout = useCallback((returnTo = currentReturnTo()) => {
    logoutPending = true;
    user = null;
    loading = true;
    setAuthTokenGetter(null);
    publish();
    const destination = safeReturnTo(returnTo);
    const url = `/api/logout?returnTo=${encodeURIComponent(destination)}`;
    void fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
    }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ success: boolean; returnTo?: string }>;
    }).then(result => {
      if (result.success !== true) throw new Error('Logout was not confirmed by the server.');
      logoutPending = false;
      setUser(null);
      loading = false;
      publish();
      notifyOtherTabs();
      window.location.assign(safeReturnTo(result.returnTo ?? destination));
    }).catch(() => {
      logoutPending = false;
      revalidate();
    });
  }, []);
  void snapshot;
  return { user, isLoading: loading, isAuthenticated: !!user, login, logout };
}