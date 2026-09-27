import { useEffect } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getGetFirebaseConfigQueryKey,
  useGetFirebaseConfig,
} from '@workspace/api-client-react';

const APP_NAME = 'movie-show-investing';
let initializedAuth: Auth | null = null;
let reportedConfigError = false;

/** Auth is unavailable until the public config endpoint succeeds. */
export function getInitializedAuth(): Auth | null {
  return initializedAuth;
}

export function FirebaseBootstrap() {
  const { data: config, error, isError } = useGetFirebaseConfig({
    query: {
      queryKey: getGetFirebaseConfigQueryKey(),
      retry: false,
      staleTime: 300_000,
    },
  });

  useEffect(() => {
    if (!config) return;
    if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      if (import.meta.env.DEV) console.warn('[Movie Show Investing] Firebase Auth was not initialized: /api/config returned incomplete web configuration.');
      return;
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
    } catch (cause) {
      if (import.meta.env.DEV) console.error('[Movie Show Investing] Firebase Auth initialization failed. Check the Firebase web configuration.', cause);
    }
  }, [config]);

  useEffect(() => {
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