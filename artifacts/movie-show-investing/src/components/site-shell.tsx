import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { signOut } from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { leaveFilmmakerAccount } from '@workspace/api-client-react';
import { getInitializedAuth, useFirebaseSessionReady, useFirebaseUser } from '@/components/firebase-bootstrap';
import { clearFilmmakerAction } from '@/lib/filmmaker-intent';
import { useAuth } from '@workspace/replit-auth-web';
import { switchToSso } from '@/lib/auth-switch';

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/explore', label: 'Explore projects' },
  { href: '/faq', label: 'Questions' },
  { href: '/start/filmmaker', label: 'For filmmakers' },
  { href: '/invest', label: 'For investors' },
  { href: '/messages', label: 'Messages' },
];

export function SiteShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();
  const user = useFirebaseUser();
  const firebaseReady = useFirebaseSessionReady();
  const replitAuth = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  async function leave() {
    if (replitAuth.user) {
      setSigningOut(true);
      setSignOutError('');
      try {
        clearFilmmakerAction();
        queryClient.clear();
        replitAuth.logout('/');
      } catch {
        setSignOutError('Could not sign out. Please try again.');
        setSigningOut(false);
      }
      return;
    }
    const auth = getInitializedAuth();
    if (!auth || signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await leaveFilmmakerAccount();
      await signOut(auth);
      clearFilmmakerAction();
      queryClient.clear();
      setOpen(false);
      navigate('/');
    } catch {
      setSignOutError('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }
  const signedIn = replitAuth.user || (!replitAuth.isLoading && user);
  function beginSso() {
    void switchToSso(getInitializedAuth(), queryClient, replitAuth.login);
  }
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="relative z-20 border-b hairline bg-[#f4f0e7]">
        <div className="page-wrap flex h-[72px] items-center justify-between gap-6 md:h-[86px]">
          <Link href="/" data-testid="link-brand" onClick={() => setOpen(false)} className="group inline-flex items-center gap-3 shrink-0" aria-label="Movie Show Investing home">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#26303d] transition-transform duration-300 group-hover:rotate-45">
              <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#902f4d]" />
              <span className="absolute top-1 left-1 h-1 w-1 rounded-full bg-[#26303d]" />
            </span>
            <span className="text-[15px] font-bold leading-[1.05] tracking-[-.055em] md:text-[17px]">MOVIE SHOW<br/>INVESTING<span className="text-[#9c4256]">.</span></span>
          </Link>
          <nav className="hidden items-center gap-5 lg:gap-9 md:flex" aria-label="Main navigation">
            {navigation.slice(1).map((item) => (
              <Link key={item.href} href={item.href} data-testid={`link-nav-${item.href.replaceAll('/', '-')}`} className={`text-[13px] font-semibold transition-colors hover:text-[#9c4256] ${location === item.href ? 'text-[#9c4256]' : 'text-[#26303d]'}`}>{item.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 md:flex">
              {signedIn ? <>
                <Link href="/me/projects" data-testid="link-header-my-projects" className="text-[12px] font-bold whitespace-nowrap text-[#902f4d]">My projects</Link>
                {!replitAuth.user && <button type="button" onClick={beginSso} disabled={replitAuth.isLoading || !firebaseReady} className="text-[12px] font-semibold whitespace-nowrap underline underline-offset-4">Single sign-on</button>}
                <button type="button" data-testid="button-header-sign-out" onClick={() => void leave()} disabled={signingOut || replitAuth.isLoading} className="text-[12px] font-semibold whitespace-nowrap underline underline-offset-4">Sign out</button>
              </> : <>
                <Link href="/me/projects" data-testid="link-header-sign-in" onClick={clearFilmmakerAction} className="text-[12px] font-bold whitespace-nowrap text-[#902f4d]">Sign in</Link>
                <button type="button" onClick={beginSso} disabled={replitAuth.isLoading || !firebaseReady} className="text-[12px] font-semibold whitespace-nowrap underline underline-offset-4">Continue with single sign-on</button>
              </>}
            </div>
            <button type="button" data-testid="button-toggle-menu" className="inline-flex h-10 w-10 items-center justify-center border border-[#26303d] md:hidden" aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X size={19} /> : <Menu size={19} />}</button>
          </div>
        </div>
        <div className="page-wrap flex min-h-10 items-center justify-end gap-5 border-t border-[#d7d0c5] py-2 md:hidden" aria-label="Account controls">
          {signedIn ? <>
            <Link href="/me/projects" data-testid="link-mobile-my-projects" onClick={() => setOpen(false)} className="text-[12px] font-bold text-[#902f4d]">My projects</Link>
            {!replitAuth.user && <button type="button" onClick={beginSso} disabled={replitAuth.isLoading || !firebaseReady} className="text-[12px] font-semibold underline underline-offset-4">Single sign-on</button>}
            <button type="button" data-testid="button-mobile-sign-out" onClick={() => void leave()} disabled={signingOut || replitAuth.isLoading} className="text-[12px] font-semibold underline underline-offset-4">Sign out</button>
          </> : <>
            <Link href="/me/projects" data-testid="link-mobile-sign-in" onClick={() => { clearFilmmakerAction(); setOpen(false); }} className="text-[12px] font-bold text-[#902f4d]">Sign in</Link>
            <button type="button" onClick={beginSso} disabled={replitAuth.isLoading || !firebaseReady} className="text-[12px] font-semibold underline underline-offset-4">Continue with single sign-on</button>
          </>}
        </div>
        {open && <nav className="absolute top-full left-0 right-0 border-b border-[#bcb4a7] bg-[#f4f0e7] px-5 pb-5 shadow-lg md:hidden" aria-label="Mobile navigation">
          {navigation.map((item) => <Link key={item.href} href={item.href} data-testid={`link-mobile-${item.href.replaceAll('/', '-')}`} onClick={() => setOpen(false)} className="flex items-center justify-between border-t border-[#cec7bb] py-4 text-lg font-semibold">{item.label}<ArrowUpRight size={18}/></Link>)}
        </nav>}
        {signOutError && <p className="page-wrap pb-2 text-sm text-[#902f4d]" role="alert">{signOutError}</p>}
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
                <Link href="/start/filmmaker" data-testid="link-footer-filmmaker" className="hover:text-[#dfb674]">For filmmakers</Link>
                <Link href="/invest" data-testid="link-footer-invest" className="hover:text-[#dfb674]">For investors</Link>
                <Link href="/messages" data-testid="link-footer-messages" className="hover:text-[#dfb674]">Messages</Link>
              </div>
              <div className="flex flex-col gap-4">
                <Link href="/privacy" data-testid="link-footer-privacy" className="hover:text-[#dfb674]">Privacy</Link>
                <Link href="/terms" data-testid="link-footer-terms" className="hover:text-[#dfb674]">Terms</Link>
                <Link href="/disclaimers" data-testid="link-footer-disclaimers" className="hover:text-[#dfb674]">Disclaimers</Link>
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