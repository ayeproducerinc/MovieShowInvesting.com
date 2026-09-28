import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import {
  getGetFirebaseConfigQueryKey,
  getGetFilmmakerProjectsQueryKey,
  getGetFilmmakerResultQueryKey,
  getGetFlowProgressQueryKey,
  setAuthTokenGetter,
  useGetFirebaseConfig,
} from '@workspace/api-client-react';

const APP_NAME = 'movie-show-investing';
let initializedAuth: Auth | null = null;
let reportedConfigError = false;
let sessionReady = false;
let currentUser: User | null = null;
let previousUid: string | null = null;
const listeners = new Set<() => void>();

function setSessionReady(ready: boolean) {
  if (sessionReady === ready) return;
  sessionReady = ready;
  listeners.forEach(listener => listener());
}

/** Wait for Firebase to restore the browser session before loading owner-scoped data. */
export function useFirebaseSessionReady() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => sessionReady,
    () => false,
  );
}

export function useFirebaseUser() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => currentUser,
    () => null,
  );
}

/** Auth is unavailable until the public config endpoint succeeds. */
export function getInitializedAuth(): Auth | null {
  return initializedAuth;
}

export function FirebaseBootstrap() {
  const queryClient = useQueryClient();
  const { data: config, error, isError } = useGetFirebaseConfig({
    query: {
      queryKey: getGetFirebaseConfigQueryKey(),
      retry: false,
      staleTime: 300_000,
    },
  });

  useEffect(() => {
    if (!config) return undefined;
    if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      if (import.meta.env.DEV) console.warn('[Movie Show Investing] Firebase Auth was not initialized: /api/config returned incomplete web configuration.');
      setSessionReady(true);
      return undefined;
    }
    try {
      const app = getApps().some((existing) => existing.name === APP_NAME)
        ? getApp(APP_NAME)
        : initializeApp({
            apiKey: config.apiKey,
            authDomain: config.authDomain,
            projectId: config.projectId,
            appId: config.appId,
          }, APP_NAME);
      initializedAuth = getAuth(app);
      return onAuthStateChanged(initializedAuth, user => {
        if (previousUid !== (user?.uid ?? null)) {
          queryClient.removeQueries({ queryKey: getGetFilmmakerProjectsQueryKey() });
          queryClient.removeQueries({ queryKey: getGetFilmmakerResultQueryKey() });
          queryClient.removeQueries({ queryKey: getGetFlowProgressQueryKey('filmmaker') });
          previousUid = user?.uid ?? null;
        }
        setAuthTokenGetter(user ? () => initializedAuth?.currentUser?.getIdToken() ?? null : null);
        currentUser = user;
        listeners.forEach(listener => listener());
        setSessionReady(true);
      }, () => {
        currentUser = null;
        listeners.forEach(listener => listener());
        setAuthTokenGetter(null);
        setSessionReady(true);
      });
    } catch (cause) {
      if (import.meta.env.DEV) console.error('[Movie Show Investing] Firebase Auth initialization failed. Check the Firebase web configuration.', cause);
      setSessionReady(true);
      return undefined;
    }
  }, [config, queryClient]);

  useEffect(() => {
    if (isError) setSessionReady(true);
    if (!isError || reportedConfigError || !import.meta.env.DEV) return;
    reportedConfigError = true;
    if (error?.status === 503) {
      console.warn('[Movie Show Investing] Firebase Auth is not configured yet: /api/config returned 503. Supply the Firebase web configuration in Replit Secrets. Public pages remain available.');
    } else {
      console.warn('[Movie Show Investing] Firebase Auth configuration could not be loaded from /api/config. Public pages remain available.', error);
    }
  }, [error, isError]);

  return null;
}