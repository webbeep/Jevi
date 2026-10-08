import { Quote, Tag, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleButton } from './auth/GoogleButton';
import { startSignIn } from './auth/signin';
import { Wordmark } from './Logo';

export function LandingHero() {
  return (
    <div data-testid="landing" className="min-w-0">
      <div className="flex justify-center" aria-hidden>
        <Wordmark className="text-[28px] sm:text-[32px]" />
      </div>
      <span className="sr-only">ZO</span>
      <h1 className="mt-4 text-balance break-words text-center text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
        Answers you can check.
      </h1>
      <p className="mx-auto mt-3 max-w-[30rem] text-center text-[15px] text-muted-foreground sm:text-[17px]">
        ZO searches the web and shows its sources, prices and picks as cards — free.
      </p>
    </div>
  );
}

export function LandingCtas({
  onTry,
  onGoogle,
  auth,
}: {
  onTry: () => void;
  onGoogle: () => void;
  auth: { enabled: boolean; ready: boolean; signedIn: boolean; limit: number };
}) {
  const showGoogle = auth.enabled && auth.ready && !auth.signedIn;
  const showLimit = auth.enabled && auth.ready && auth.limit > 0;
  return (
    <div data-testid="landing-ctas" className="mt-8 min-w-0 sm:mt-10">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button type="button" data-testid="landing-try" onClick={onTry} className="h-11 w-full min-w-11 rounded-xl px-5 sm:w-auto">
          Try it free
        </Button>
        {showGoogle && (
          <GoogleButton
            testId="landing-google"
            className="w-full min-w-11 sm:w-auto"
            onClick={() => {
              onGoogle();
              startSignIn('welcome');
            }}
          />
        )}
      </div>
      {showLimit && (
        <p data-testid="landing-limit" className="mt-3 text-center text-[13px] text-muted-foreground">
          {auth.limit} free questions, more when you sign in.
        </p>
      )}
    </div>
  );
}

const VALUE_PROPS = [
  { icon: Quote, text: 'Sources on every claim' },
  { icon: Tag, text: 'Product cards with real prices' },
  { icon: WifiOff, text: 'Offline-safe — keeps your answer' },
] as const;

export function LandingValueProps() {
  return (
    <ul data-testid="landing-value" className="mt-8 grid min-w-0 gap-2 sm:mt-10 sm:grid-cols-3">
      {VALUE_PROPS.map(({ icon: Icon, text }) => (
        <li key={text} className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-card">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <span className="min-w-0 break-words text-[14px] leading-snug">{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function LandingExample() {
  return (
    <figure data-testid="landing-example" className="mt-8 min-w-0 sm:mt-10">
      <div className="relative aspect-[730/545] w-full overflow-hidden rounded-2xl border bg-card shadow-card">
        <img
          src="/landing/landing-example-light.webp"
          alt="Example ZO answer: help desks under $20 per seat, with sourced prices"
          width={730}
          height={545}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-top dark:hidden"
        />
        <img
          src="/landing/landing-example-dark.webp"
          alt=""
          aria-hidden
          width={730}
          height={545}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 hidden h-full w-full object-cover object-top dark:block"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background" aria-hidden />
      </div>
      <figcaption className="mt-2 text-center text-xs text-muted-foreground">A real ZO answer</figcaption>
    </figure>
  );
}

export function LandingFooter() {
  return (
    <nav data-testid="landing-footer" className="mt-8 flex flex-wrap items-center justify-center sm:mt-10">
      <a href="/privacy" className="inline-flex min-h-11 min-w-11 items-center px-2 text-[13px] text-muted-foreground hover:text-foreground">
        Privacy
      </a>
      <span className="text-[13px] text-muted-foreground" aria-hidden>
        ·
      </span>
      <a href="/terms" className="inline-flex min-h-11 min-w-11 items-center px-2 text-[13px] text-muted-foreground hover:text-foreground">
        Terms
      </a>
    </nav>
  );
}
