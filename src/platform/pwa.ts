// Service worker registration, the beforeinstallprompt install line, and the Wake Lock
// request (Task 5.1, TECH_SPEC.md §10). Three independent concerns kept in one small file
// since they're all "PWA plumbing main.ts wires up once at bootstrap and otherwise
// ignores," not because they share any state.

import type { KeyValueStorage } from './storage.js';

/** Registers the service worker `npm run build`'s `generate-sw` step writes to
 *  `dist/sw.js` (TECH_SPEC.md §10: "Hand-written service worker... precache the built
 *  asset manifest at install"). No-op wherever the API doesn't exist (older browsers,
 *  or `npm run dev`'s server, which never runs `generate-sw` — a 404'd registration
 *  would just fail silently anyway, but skipping it outright avoids a console error
 *  during ordinary local development) — TECH_SPEC.md §9's "the game must run fine with
 *  [this] silently disabled" spirit, same as `platform/storage.ts`'s fallback. */
export function registerServiceWorker(win: { navigator: Navigator } = window): void {
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in win.navigator)) return;
  win.navigator.serviceWorker.register('/sw.js').catch(() => {
    // Offline-first (TECH_SPEC.md §3) means a failed SW registration must never block
    // or degrade actual gameplay — the app already works without one, just without the
    // offline/installable guarantees.
  });
}

/** Chrome's `beforeinstallprompt` event isn't in TypeScript's own DOM lib yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const DISMISSED_KEY = 'inkfall.installPromptDismissed';

export interface InstallPromptController {
  /** Called whenever whether the title screen's install line should be shown changes —
   *  fires once eagerly with the current (always-false-at-first) state, so a caller
   *  never has to separately query an initial value. */
  onAvailabilityChange(callback: (available: boolean) => void): void;
  /** Shows the browser's own install UI. A no-op if the prompt isn't currently
   *  available (e.g. the line is stale, or the user already installed) — nothing to
   *  prompt in that case. */
  promptInstall(): void;
  /** Dismisses the line for this device permanently — TECH_SPEC.md §10's "dismissible
   *  permanently." Survives reload via `storage` (falls back to in-memory/session-only
   *  if persistence is unavailable, same as every other Settings toggle). */
  dismiss(): void;
}

/**
 * Not UI itself — `ui/screens/title.ts` owns the actual line/buttons. This is just the
 * "when is there anything to show, and what do the two actions do" state machine,
 * kept out of /ui the same way every other /platform module stays presentation-agnostic.
 */
export function createInstallPromptController(
  storage: KeyValueStorage,
  win: { addEventListener: typeof window.addEventListener } = window,
): InstallPromptController {
  let deferredEvent: BeforeInstallPromptEvent | null = null;
  let dismissed = storage.read(DISMISSED_KEY) === '1';
  let listener: ((available: boolean) => void) | null = null;

  function notify(): void {
    listener?.(deferredEvent !== null && !dismissed);
  }

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredEvent = event as BeforeInstallPromptEvent;
    notify();
  });
  win.addEventListener('appinstalled', () => {
    deferredEvent = null;
    notify();
  });

  return {
    onAvailabilityChange(callback): void {
      listener = callback;
      callback(deferredEvent !== null && !dismissed);
    },
    promptInstall(): void {
      deferredEvent?.prompt();
    },
    dismiss(): void {
      dismissed = true;
      storage.write(DISMISSED_KEY, '1');
      notify();
    },
  };
}

/** The Wake Lock API isn't in TypeScript's DOM lib as of the version this project pins
 *  (TECH_SPEC.md §2). */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface NavigatorWithWakeLock {
  readonly wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface WakeLockController {
  /** Requests a screen wake lock — TECH_SPEC.md §10: "wake lock requested during a
   *  Passage where supported." Fire-and-forget: unsupported browsers, a user declining
   *  (some platforms prompt), or the tab losing visibility mid-request all resolve to
   *  simply not holding a lock, never an error the caller has to handle. Re-entrant —
   *  calling it again while already held is a safe no-op. */
  acquire(): void;
  /** Releases the held lock, if any. Safe to call whether or not one is currently held. */
  release(): void;
}

export function createWakeLockController(nav: NavigatorWithWakeLock = navigator): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;

  return {
    acquire(): void {
      if (sentinel !== null || nav.wakeLock === undefined) return;
      nav.wakeLock
        .request('screen')
        .then((s) => {
          sentinel = s;
        })
        .catch(() => {
          // Declined, unsupported mid-flight, or the document was already hidden —
          // gameplay never depends on holding one, so there's nothing to recover from.
        });
    },
    release(): void {
      const held = sentinel;
      sentinel = null;
      held?.release().catch(() => {
        // Already released, or the sentinel's underlying lock is gone — nothing to do.
      });
    },
  };
}
