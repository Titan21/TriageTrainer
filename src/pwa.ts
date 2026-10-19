/// <reference types="vite-plugin-pwa/client" />
// Service worker registration for offline play. Not registered in `npm run dev`.
import { registerSW } from 'virtual:pwa-register';

let ready = false;
const listeners = new Set<(ready: boolean) => void>();

/** True once everything needed to play without a connection is cached. */
export function offlineReady(): boolean {
  return ready || (typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller);
}

export function onOfflineReady(fn: (ready: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startPwa(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onOfflineReady() {
      ready = true;
      for (const fn of listeners) fn(true);
    },
  });
}
