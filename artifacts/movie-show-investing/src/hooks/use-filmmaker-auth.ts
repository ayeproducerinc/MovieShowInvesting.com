import { useEffect, useState } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut, type Auth, type User } from 'firebase/auth';
import { getGetFirebaseConfigQueryKey, setAuthTokenGetter, useGetFirebaseConfig } from '@workspace/api-client-react';

const APP_NAME = 'movie-show-investing';

export function useFilmmakerAuth() {
  const config = useGetFirebaseConfig({
    query: { queryKey: getGetFirebaseConfigQueryKey(), retry: false, staleTime: 300_000 },
  });
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const web = config.data;
    if (!web?.apiKey || !web.authDomain || !web.projectId || !web.appId) return;
    try {
      const app = getApps().some(existing => existing.name === APP_NAME)
        ? getApp(APP_NAME)
        : initializeApp({
            apiKey: web.apiKey,
            authDomain: web.authDomain,
            projectId: web.projectId,
            appId: web.appId,
          }, APP_NAME);
      setAuth(getAuth(app));
    } catch {
      setAuthError('Firebase could not be initialized. Check the web configuration and try again.');
      setReady(true);
    }
  }, [config.data]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, next => {
      setAuthTokenGetter(next ? () => auth.currentUser?.getIdToken() ?? null : null);
      setUser(next);
      setReady(true);
    }, () => {
      setAuthTokenGetter(null);
      setAuthError('The sign-in session could not be restored. Please try signing in again.');
      setReady(true);
    });
  }, [auth]);

  async function leave() {
    if (!auth) return;
    try {
      await signOut(auth);
      setAuthTokenGetter(null);
      setUser(null);
    } catch {
      throw new Error('Sign-out could not be completed. Please try again.');
    }
  }

  return {
    user,
    authError,
    ready: ready && !!auth,
    configPending: config.isPending,
    configError: Boolean(authError) || config.isError || (!!config.data && (!config.data.apiKey || !config.data.authDomain || !config.data.projectId || !config.data.appId)),
    retryConfig: config.refetch,
    leave,
  };
}