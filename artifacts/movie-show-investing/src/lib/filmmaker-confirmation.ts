const KEY = 'msi_guest_confirmation_visible';
let grantedInCurrentDocument = false;
let leftCurrentDocument = false;

// Pagehide also runs for refresh; leave the tab-scoped flag in place so only a
// genuine reload can restore it. Back/forward and reopened tabs cannot.
window.addEventListener('pagehide', () => {
  grantedInCurrentDocument = false;
  leftCurrentDocument = true;
});

export function showGuestConfirmation() {
  grantedInCurrentDocument = true;
  window.sessionStorage.setItem(KEY, 'yes');
}

export function guestConfirmationVisible() {
  if (window.sessionStorage.getItem(KEY) !== 'yes') return false;
  // A bfcache restoration keeps the original navigation type (even "reload").
  if (leftCurrentDocument) { closeGuestConfirmation(); return false; }
  if (grantedInCurrentDocument) return true;
  const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type === 'reload') return true;
  closeGuestConfirmation();
  return false;
}

export function closeGuestConfirmation() {
  grantedInCurrentDocument = false;
  window.sessionStorage.removeItem(KEY);
}