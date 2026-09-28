import type { QueryClient } from '@tanstack/react-query';
import { signOut, type Auth } from 'firebase/auth';
import { leaveFilmmakerAccount, setAuthTokenGetter } from '@workspace/api-client-react';

export type AuthSwitchResult = { ok: true } | { ok: false; message: string };

export async function switchToSso(auth: Auth | null, queryClient: QueryClient, login: () => void): Promise<AuthSwitchResult> {
  if (auth?.currentUser) {
    try {
      // Keep the Firebase bearer active while rotating the account-owned
      // visitor cookie before changing authentication systems.
      await leaveFilmmakerAccount();
    } catch {
      return {
        ok: false,
        message: 'Your browser session could not be safely prepared for single sign-on. You are still signed in; please try again.',
      };
    }
    try {
      await signOut(auth);
    } catch {
      return { ok: false, message: 'Firebase sign-out could not be completed. You are still signed in; please try again.' };
    }
  }
  try {
    setAuthTokenGetter(null);
    queryClient.clear();
    login();
    return { ok: true };
  } catch {
    return { ok: false, message: 'Single sign-on could not be started. Please try again.' };
  }
}

export function switchToFirebase(queryClient: QueryClient, logout: (returnTo?: string) => void) {
  queryClient.clear();
  setAuthTokenGetter(null);
  logout(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}