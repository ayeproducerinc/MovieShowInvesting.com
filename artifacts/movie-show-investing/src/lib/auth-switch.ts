import type { QueryClient } from '@tanstack/react-query';
import { signOut, type Auth } from 'firebase/auth';
import { setAuthTokenGetter } from '@workspace/api-client-react';

export async function switchToSso(auth: Auth | null, queryClient: QueryClient, login: () => void) {
  if (auth?.currentUser) await signOut(auth);
  setAuthTokenGetter(null);
  queryClient.clear();
  login();
}

export function switchToFirebase(queryClient: QueryClient, logout: (returnTo?: string) => void) {
  queryClient.clear();
  setAuthTokenGetter(null);
  logout(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}