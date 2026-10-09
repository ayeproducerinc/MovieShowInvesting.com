import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { signOut, type User } from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { leaveFilmmakerAccount } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { clearFilmmakerAction } from '@/lib/filmmaker-intent';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { ReplayConsent } from '@/components/replay-consent';
import { hasReplayProviderConfigured } from '@/lib/analytics';
import { clearPrivateAuthQueries, communityRegistrationError, refreshCommunityCount, registerHomepageCommunity } from '@/lib/homepage-community';

const navigation = [
  { href: '/explore', label: 'Explore projects' },
  { href: '/start/filmmaker', label: 'Pitch' },
  { href: '/invest', label: 'Pledge' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];
const accountLink = (active: boolean) => `text-[12px] font-bold whitespace-nowrap ${active ? 'text-[#26303d] underline underline-offset-4' : 'text-[#902f4d]'}`;

export function SiteShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();
  const user = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [communityRegistration, setCommunityRegistration] = useState<{ uid: string; pending: boolean; error: string } | null>(null);
  async function joinFromHomepage(signedInUser: User) {
    setCommunityRegistration({ uid: signedInUser.uid, pending: true, error: '' });
    try {
      const result = await registerHomepageCommunity(await signedInUser.getIdToken());
      if (getInitializedAuth()?.currentUser?.uid !== signedInUser.uid) return;
      await refreshCommunityCount(queryClient, result.filmmakers);
      if (getInitializedAuth()?.currentUser?.uid === signedInUser.uid) setCommunityRegistration(null);
    } catch (error) {
      if (getInitializedAuth()?.currentUser?.uid === signedInUser.uid) {
        setCommunityRegistration({ uid: signedInUser.uid, pending: false, error: communityRegistrationError(error) });
      }
    }
  }
  // Capture intent on this button's successful sign-in, not on all auth changes
  // (which would incorrectly register investors returning to the homepage).
  const onHomepageSignedIn = location === '/' ? (signedInUser: User) => { void joinFromHomepage(signedInUser); } : undefined;
  async function leave() {
    const auth = getInitializedAuth();
    if (!auth || signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await leaveFilmmakerAccount();
      await signOut(auth);
      clearFilmmakerAction();
      clearPrivateAuthQueries(queryClient);
      setOpen(false);
      navigate('/');
    } catch {
      setSignOutError('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }
  const signedIn = Boolean(user);
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="relative z-20 border-b hairline bg-[#f4f0e7]">
        <div className="page-wrap flex h-[72px] items-center justify-between gap-4 lg:h-[86px]">
          <Link href="/" data-testid="link-brand" onClick={() => setOpen(false)} className="group inline-flex items-center gap-3 shrink-0" aria-label="Movie Show Investing home">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#26303d] transition-transform duration-300 group-hover:rotate-45">
              <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#902f4d]" />
              <span className="absolute top-1 left-1 h-1 w-1 rounded-full bg-[#26303d]" />
            </span>
            <span className="text-[15px] font-bold leading-[1.05] tracking-[-.055em] md:text-[17px]">MOVIE SHOW<br/>INVESTING<span className="text-[#9c4256]">.</span></span>
          </Link>
          <nav className="hidden items-center gap-4 xl:gap-7 lg:flex" aria-label="Main navigation">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} data-testid={`link-nav-${item.href.replaceAll('/', '-')}`} className={`text-[13px] font-semibold transition-colors hover:text-[#9c4256] ${location === item.href ? 'text-[#9c4256]' : 'text-[#26303d]'}`}>{item.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 lg:flex">
              {signedIn ? <>
                <Link href="/lineup" data-testid="link-header-lineup" className={accountLink(location.startsWith('/lineup'))}>My lineup</Link>
                <Link href="/messages" data-testid="link-nav--messages" className={accountLink(location.startsWith('/messages'))}>Messages</Link>
                <Link href="/referrals" data-testid="link-header-referrals" className={accountLink(location === '/referrals')}>Referrals</Link>
                <Link href="/me/projects" data-testid="link-header-my-projects" className={accountLink(location === '/me/projects')}>My projects</Link>
                <button type="button" data-testid="button-header-sign-out" onClick={() => void leave()} disabled={signingOut} className="text-[12px] font-semibold whitespace-nowrap underline underline-offset-4">Sign out</button>
              </> : <>
                <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inline-flex items-center gap-2 text-[12px] font-bold whitespace-nowrap text-[#902f4d]" testId="button-header-google-sign-in" label="Sign in" onSignedIn={onHomepageSignedIn} />
              </>}
            </div>
            <button type="button" data-testid="button-toggle-menu" className="inline-flex h-10 w-10 items-center justify-center border border-[#26303d] lg:hidden" aria-expanded={open} aria-controls="mobile-site-navigation" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X size={19} /> : <Menu size={19} />}</button>
          </div>
        </div>
        <div className="page-wrap flex min-h-10 items-center justify-end gap-5 border-t border-[#d7d0c5] py-2 lg:hidden" aria-label="Account controls">
          {signedIn ? <>
            <Link href="/lineup" data-testid="link-mobile-lineup" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#902f4d]">My lineup</Link>
            <Link href="/messages" data-testid="link-mobile--messages" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#902f4d]">Messages</Link>
            <Link href="/referrals" data-testid="link-mobile-referrals" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#902f4d]">Referrals</Link>
            <Link href="/me/projects" data-testid="link-mobile-my-projects" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#902f4d]">My projects</Link>
            <button type="button" data-testid="button-mobile-sign-out" onClick={() => void leave()} disabled={signingOut} className="text-[12px] font-semibold underline underline-offset-4">Sign out</button>
          </> : <>
            <GoogleSignInButton auth={getInitializedAuth()} queryClient={queryClient} disabled={!firebaseReady} className="inline-flex items-center gap-2 text-[12px] font-bold text-[#902f4d]" testId="button-mobile-google-sign-in" label="Sign in" onSignedIn={onHomepageSignedIn} />
          </>}
        </div>
        {open && <nav id="mobile-site-navigation" className="absolute top-full left-0 right-0 border-b border-[#bcb4a7] bg-[#f4f0e7] px-5 pb-5 shadow-lg lg:hidden" aria-label="Mobile navigation">
          {navigation.map((item) => <Link key={item.href} href={item.href} data-testid={`link-mobile-${item.href.replaceAll('/', '-')}`} onClick={() => setOpen(false)} className="flex items-center justify-between border-t border-[#cec7bb] py-4 text-lg font-semibold">{item.label}<ArrowUpRight size={18}/></Link>)}
        </nav>}
        {signOutError && <p className="page-wrap pb-2 text-sm text-[#902f4d]" role="alert">{signOutError}</p>}
        {communityRegistration && communityRegistration.uid === user?.uid && <p className="page-wrap pb-2 text-sm text-[#902f4d]" role={communityRegistration.pending ? 'status' : 'alert'} data-testid="status-community-registration">
          {communityRegistration.pending ? 'Updating community count…' : <>You are signed in, but your community count was not updated. {communityRegistration.error} <button type="button" className="font-semibold underline" data-testid="button-retry-community-registration" onClick={() => { if (user) void joinFromHomepage(user); }}>Try again</button></>}
        </p>}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-[#202936] text-[#f4f0e7]">
        <div className="page-wrap pt-16 pb-8 md:pt-20">
          <div className="grid gap-12 border-b border-[#65707a] pb-16 md:grid-cols-[1.3fr_1fr] md:gap-24">
            <div>
              <p className="eyebrow text-[#dfb674]">Movie Show Investing</p>
              <p className="serif mt-5 max-w-[600px] text-[42px] leading-[.98] md:text-[62px]">Good stories need<br/><em>a way forward.</em></p>
            </div>
            <div className="grid grid-cols-2 gap-6 self-end text-[13px]">
              <div className="flex flex-col gap-4">
                <Link href="/" data-testid="link-footer-home" className="hover:text-[#dfb674]">Home</Link>
                <Link href="/explore" data-testid="link-footer-explore" className="hover:text-[#dfb674]">Explore projects</Link>
                <Link href="/faq" data-testid="link-footer-faq" className="hover:text-[#dfb674]">FAQ</Link>
                <Link href="/start/filmmaker" data-testid="link-footer-filmmaker" className="hover:text-[#dfb674]">Pitch</Link>
                <Link href="/pricing" className="hover:text-[#dfb674]">Pricing</Link>
                <Link href="/invest" data-testid="link-footer-invest" className="hover:text-[#dfb674]">Pledge</Link>
                {signedIn && <Link href="/messages" data-testid="link-footer-messages" className="hover:text-[#dfb674]">Messages</Link>}
              </div>
              <div className="flex flex-col gap-4">
                <Link href="/privacy" data-testid="link-footer-privacy" className="hover:text-[#dfb674]">Privacy</Link>
                <Link href="/terms" data-testid="link-footer-terms" className="hover:text-[#dfb674]">Terms</Link>
                <Link href="/disclaimers" data-testid="link-footer-disclaimers" className="hover:text-[#dfb674]">Disclaimers</Link>
                {hasReplayProviderConfigured() && <ReplayConsent />}
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-7 pt-7 md:flex-row md:items-end">
            <p data-testid="text-required-footer-notice" className="max-w-[610px] text-[13px] leading-relaxed text-[#d1d0c9]">Pledges are non-binding. No money is collected. This is not an offer to sell securities.</p>
            <p className="mono text-[10px] uppercase tracking-wider text-[#9ca6aa]">© {new Date().getFullYear()} AYe Producer, Inc.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function ArrowButton({ href, children, outline = false, testId }: { href: string; children: ReactNode; outline?: boolean; testId: string }) {
  return <Link href={href} data-testid={testId} className={`group inline-flex min-h-14 items-center justify-between gap-8 border px-6 py-3 text-sm font-bold transition-colors duration-300 ${outline ? 'border-[#26303d] text-[#26303d] hover:bg-[#26303d] hover:text-[#f4f0e7]' : 'border-[#943c55] bg-[#943c55] text-[#fff8ed] hover:border-[#6c263d] hover:bg-[#6c263d]'}`}>
    <span>{children}</span><ArrowUpRight size={18} strokeWidth={1.7} className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"/>
  </Link>;
}