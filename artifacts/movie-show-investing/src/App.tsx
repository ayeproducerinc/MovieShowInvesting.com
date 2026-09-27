import { useEffect, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { FirebaseBootstrap } from '@/components/firebase-bootstrap';
import { SiteShell } from '@/components/site-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { useVisitAttribution } from '@/hooks/use-public-site';
import Home from '@/pages/home';
import Admin from '@/pages/admin';
import FAQ from '@/pages/faq';
import Legal from '@/pages/legal';
import OpeningLater from '@/pages/opening-later';
import Filmmaker from '@/pages/filmmaker';
import FilmmakerDone from '@/pages/filmmaker-done';
import FilmmakerProjects from '@/pages/filmmaker-projects';
import Project from '@/pages/project';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const metadata: Record<string, [string, string]> = {
  '/': ['Movie Show Investing | A new path for independent film', 'A place for filmmakers to share projects and explore future investor interest. No money is collected.'],
  '/faq': ['FAQ | Movie Show Investing', 'Answers about Movie Show Investing, non-binding interest, distribution, and protecting your ideas.'],
  '/privacy': ['Privacy | Movie Show Investing', 'Prelaunch privacy information about visitor cookies and campaign attribution.'],
  '/terms': ['Terms | Movie Show Investing', 'Prelaunch terms for the Movie Show Investing informational site.'],
  '/disclaimers': ['Disclaimers | Movie Show Investing', 'Important context about non-binding interest, securities, and investment risk.'],
  '/invest': ['For investors | Movie Show Investing', 'Investor signup and non-binding pledges will open later, after approved projects are available.'],
   '/start/filmmaker': ['Filmmaker worksheet | Movie Show Investing', 'Share your project and explore illustrative terms in a guided prelaunch worksheet.'],
   '/start/filmmaker/done': ['Thank you | Movie Show Investing', 'Your filmmaker answers have been received.'],
    '/me/projects': ['My projects | Movie Show Investing', 'Manage your filmmaker projects and start another submission.'],
};

function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const [title, description] = metadata[location] ?? ['Page not found | Movie Show Investing', 'Explore Movie Show Investing.'];
    document.title = title;
    const update = (selector: string, attribute: 'name' | 'property', key: string, content: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
      }
      element.content = content;
    };
    update('meta[name="description"]', 'name', 'description', description);
    update('meta[property="og:title"]', 'property', 'og:title', title);
    update('meta[property="og:description"]', 'property', 'og:description', description);
    update('meta[property="og:type"]', 'property', 'og:type', 'website');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function adminEmailLinkTarget() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') !== 'signIn' || !params.has('oobCode')) return null;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const adminPath = `${base}/admin`;
  const projectsPath = `${base}/me/projects`;
  if (window.location.pathname === adminPath || window.location.pathname === projectsPath) return null;
  let path = adminPath;
  try {
    const continuation = params.get('continueUrl');
    if (continuation) {
      const target = new URL(continuation);
      if (target.origin === window.location.origin && target.pathname === projectsPath) path = projectsPath;
    }
  } catch { /* Unknown email-link continuation keeps the existing admin fallback. */ }
  return `${window.location.origin}${path}${window.location.search}${window.location.hash}`;
}

function PublicPages() {
  const visit = useVisitAttribution();
  return <>
    <FirebaseBootstrap />
    <SiteShell>
    <PageMetadata />
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/faq" component={FAQ} />
        <Route path="/privacy">{() => <Legal kind="privacy" />}</Route>
        <Route path="/terms">{() => <Legal kind="terms" />}</Route>
        <Route path="/disclaimers">{() => <Legal kind="disclaimers" />}</Route>
        <Route path="/invest">{() => <OpeningLater audience="investor" />}</Route>
          <Route path="/start/filmmaker/done" component={FilmmakerDone} />
          <Route path="/me/projects" component={FilmmakerProjects} />
          <Route path="/project/:slug" component={Project} />
         <Route path="/start/filmmaker">{() => visit.status === 'ready'
           ? <Filmmaker />
           : <section className="fm"><div className="page-wrap" style={{padding:'clamp(80px,10vw,150px) 0 160px'}}>
             {visit.status === 'error' ? <>
               <p className="fm-kicker">Connection interrupted</p>
               <h1 className="serif" style={{fontSize:'clamp(54px,7vw,94px)',lineHeight:'.95',margin:'24px 0'}}>We can’t open your worksheet yet.</h1>
               <p className="fm-small" role="alert" data-testid="error-visit">We couldn’t establish your visit, so your answers would not be saved reliably. Please retry before continuing.</p>
               <button type="button" data-testid="button-retry-visit" className="fm-primary" style={{marginTop:28}} onClick={visit.retry}><RotateCcw size={17}/> Try again</button>
             </> : <div aria-label="Preparing your visit"><p className="fm-kicker">Preparing your worksheet</p><div className="fm-skeleton" style={{maxWidth:430,height:76,marginTop:28}}/><div className="fm-skeleton" style={{maxWidth:600,height:190}}/></div>}
           </div></section>}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
    </SiteShell>
  </>;
}

function App() {
  const emailLinkTarget = adminEmailLinkTarget();
  useEffect(() => {
    if (emailLinkTarget) window.location.replace(emailLinkTarget);
  }, [emailLinkTarget]);
  if (emailLinkTarget) return <div role="status" aria-label="Opening administration sign-in" />;

  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Switch>
          <Route path="/admin" component={Admin} />
          <Route>{() => <PublicPages />}</Route>
        </Switch>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;