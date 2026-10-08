import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { COPY } from './copy';
import { track } from './events';
import { GateSheet } from './GateSheet';
import { onGate, registerProfileOpener, registerSavesOpener, registerSheetOpener, requestProfile, requestSaves } from './gatebus';
import { GoogleMark } from './GoogleMark';
import { setAuthNotice } from './notice';
import type { OpenedSave } from './SavedPanel';
import { clearPending } from './pending';
import { isLeaving, startSignIn } from './signin';
import { getAuth, markSignedOut, useAuth } from './store';
import { resetSyncLocal, setSyncEnabled, useSyncEnabled } from './sync';

const SavedPanel = lazy(() => import('./SavedPanel'));
const ProfilePanel = lazy(() => import('./ProfilePanel'));

export function AuthHeader() {
  const auth = useAuth();
  const syncOn = useSyncEnabled();
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [auth.user?.avatar]);

  if (!auth.enabled || !auth.ready) return null;

  if (!auth.signedIn || !auth.user) {
    return (
      <Button variant="outline" className="h-11 shrink-0 gap-1.5 rounded-full px-3 text-[13px]" onClick={() => startSignIn('header')}>
        <GoogleMark className="size-4" />
        {COPY.signIn}
      </Button>
    );
  }

  const user = auth.user;
  const letter = (user.name || user.email || '?').trim().charAt(0).toUpperCase() || '?';

  const signOut = () => {
    track('signout');
    resetSyncLocal();
    markSignedOut();
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-11 shrink-0 rounded-full p-0" aria-label={COPY.account}>
          {user.avatar && !broken ? (
            <img src={user.avatar} alt="" className="size-8 rounded-full object-cover" onError={() => setBroken(true)} />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">{letter}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="whitespace-normal font-normal">
          {user.name && <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>}
          <span className="block break-all text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onSelect={() => requestProfile()}>{COPY.profile}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => requestSaves()}>{COPY.savedAnswers}</DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 whitespace-normal"
          role="menuitemcheckbox"
          aria-checked={syncOn}
          onSelect={(event) => {
            event.preventDefault();
            void setSyncEnabled(!syncOn);
          }}
        >
          <span className="min-w-0 flex-1">{COPY.sync}</span>
          <span className={`ml-2 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ${syncOn ? 'bg-foreground' : 'bg-muted'}`} aria-hidden>
            <span className={`size-5 rounded-full bg-background shadow-sm transition-transform ${syncOn ? 'translate-x-5' : ''}`} />
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onSelect={signOut}>{COPY.signOut}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AuthRoot({
  onDraft,
  onOpenSaved,
}: {
  onDraft: (question: string) => void;
  onOpenSaved: (saved: OpenedSave) => void;
}) {
  const draftRef = useRef(onDraft);
  const openRef = useRef(onOpenSaved);
  draftRef.current = onDraft;
  openRef.current = onOpenSaved;
  const auth = useAuth();
  const [sheet, setSheet] = useState({ open: false, waiting: false });
  const [savesOpen, setSavesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (auth.ready && !auth.enabled && sheet.open) setSheet((current) => ({ ...current, open: false }));
  }, [auth.ready, auth.enabled, sheet.open]);

  useEffect(() => {
    return registerSheetOpener((waiting) => {
      if (!getAuth().enabled) return;
      setSheet({ open: true, waiting });
    });
  }, []);

  useEffect(() => {
    return registerSavesOpener(() => {
      setSavesOpen(true);
    });
  }, []);

  useEffect(() => {
    return registerProfileOpener(() => {
      setProfileOpen(true);
    });
  }, []);

  useEffect(() => {
    return onGate((hit) => {
      if (hit.question) draftRef.current(hit.question);
      if (hit.route === 'sheet') setSheet({ open: true, waiting: true });
      else setAuthNotice({ kind: hit.route, limit: hit.limit });
    });
  }, []);

  return (
    <>
      <GateSheet
        open={sheet.open && auth.enabled}
        waiting={sheet.waiting}
        onOpenChange={(next) => {
          if (!next && !isLeaving() && sheet.waiting) clearPending();
          setSheet((current) => ({ ...current, open: next }));
        }}
      />
      {profileOpen && auth.enabled && auth.signedIn && (
        <Suspense fallback={null}>
          <ProfilePanel
            open={profileOpen}
            onOpenChange={setProfileOpen}
            onOpen={(saved) => {
              setProfileOpen(false);
              openRef.current(saved);
            }}
            onDraft={(q) => {
              setProfileOpen(false);
              draftRef.current(q);
            }}
          />
        </Suspense>
      )}
      {savesOpen && auth.enabled && auth.signedIn && (
        <Suspense fallback={null}>
          <SavedPanel
            open={savesOpen}
            onOpenChange={setSavesOpen}
            onOpen={(saved) => {
              setSavesOpen(false);
              openRef.current(saved);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
