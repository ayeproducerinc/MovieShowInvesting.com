import type { QueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';

export function switchToFirebase(queryClient: QueryClient, logout: (returnTo?: string) => void) {
  queryClient.clear();
  setAuthTokenGetter(null);
  logout(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}