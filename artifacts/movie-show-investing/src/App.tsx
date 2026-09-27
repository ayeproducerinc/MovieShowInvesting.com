import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { FirebaseBootstrap } from '@/components/firebase-bootstrap';
import { SiteShell } from '@/components/site-shell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { useVisitAttribution } from '@/hooks/use-public-site';
import Home from '@/pages/home';
import FAQ from '@/pages/faq';
import Legal from '@/pages/legal';
import OpeningLater from '@/pages/opening-later';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const metadata: Record<string, [string, string]> = {
  '/': ['Movie Show Investing | A new path for independent film', 'A place for filmmakers to share projects and explore future investor interest. No money is collected.'],
  '/faq': ['FAQ | Movie Show Investing', 'Answers about Movie Show Investing, non-binding interest, distribution, and protecting your ideas.'],
  '/privacy': ['Privacy | Movie Show Investing', 'Prelaunch privacy information about visitor cookies and campaign attribution.'],
  '/terms': ['Terms | Movie Show Investing', 'Prelaunch terms for the Movie Show Investing informational site.'],
  '/disclaimers': ['Disclaimers | Movie Show Investing', 'Important context about non-binding interest, securities, and investment risk.'],
  '/invest': ['For investors | Movie Show Investing', 'Investor signup and non-binding pledges will open later, after approved projects are available.'],
  '/start/filmmaker': ['For filmmakers | Movie Show Investing', 'The filmmaker experience is being prepared and project submissions are not yet open.'],
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

function PublicPages() {
  useVisitAttribution();
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
        <Route path="/start/filmmaker">{() => <OpeningLater audience="filmmaker" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
    </SiteShell>
  </>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <PublicPages />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;