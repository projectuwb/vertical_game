// Capacitor project config (Task 5.4, TECH_SPEC.md §11). Wraps the built `dist/` — no
// live-reload/dev-server URL configured here, since the shipped app is always the fully
// offline-capable static build, never a network-dependent webview pointed at a dev
// server (CLAUDE.md's "no network calls at runtime, ever").
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.inkfall.game',
  appName: 'Inkfall',
  webDir: 'dist',
  // GAME_DESIGN.md §3 is portrait-only; TECH_SPEC.md §11 locks it at the native layer
  // too (belt and braces over the manifest's own orientation lock, since Capacitor's
  // own `initialFocus`/behaviour can otherwise briefly show a rotated frame on launch).
  android: {
    allowMixedContent: false,
  },
};

export default config;
