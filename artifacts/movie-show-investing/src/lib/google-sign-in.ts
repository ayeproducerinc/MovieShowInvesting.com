import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  type Auth,
} from 'firebase/auth';

export async function signInWithGoogle(auth: Auth) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const existingUser = auth.currentUser;

  try {
    if (existingUser && !existingUser.providerData.some(provider => provider.providerId === GoogleAuthProvider.PROVIDER_ID)) {
      return await linkWithPopup(existingUser, provider);
    }
    // A Google-linked user can explicitly select a different Google account.
    // Firebase changes the active user only through this deliberate popup;
    // matching email addresses are never used to merge identities.
    return await signInWithPopup(auth, provider);
  } catch (error) {
    const code = error instanceof FirebaseError ? error.code : '';
    switch (code) {
      case 'auth/popup-blocked':
        throw new Error('Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.');
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        throw new Error('Google sign-in was cancelled. You can try again whenever you are ready.');
      case 'auth/account-exists-with-different-credential':
        throw new Error('A Google account with this email already exists under another sign-in method. Sign in with that existing method first, then choose Continue with Google to link it. For email-link accounts, use the email-link recovery option. We will not transfer an account based only on a matching email address.');
      case 'auth/credential-already-in-use':
        throw new Error('That Google account is already linked to another Movie Show Investing account. Sign in with the account it is linked to; accounts cannot be merged automatically.');
      case 'auth/provider-already-linked':
        throw new Error('Google is already linked to this account.');
      case 'auth/unauthorized-domain':
      case 'auth/unauthorized-continue-uri':
        throw new Error('This site address is not authorized for Google sign-in. Please contact the site owner.');
      case 'auth/operation-not-allowed':
        throw new Error('Google sign-in is not enabled for this Firebase project. Please contact the site owner.');
      case 'auth/network-request-failed':
        throw new Error('Firebase could not connect. Check your connection and try again.');
      default:
        throw new Error(code
          ? `Google sign-in could not be completed (${code}). Please try again or use email-link recovery.`
          : 'Google sign-in could not be completed. Please try again or use email-link recovery.');
    }
  }
}