import { useEffect, useState } from 'react';

// The browser fires `beforeinstallprompt` once, often before React mounts,
// so it is captured at module load and shared with every subscriber.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; notify(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstallApp() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return {
    installed: isStandalone(),
    canPrompt: Boolean(deferredPrompt),
    ios: isIOS(),
    async install() {
      if (!deferredPrompt) return 'unavailable';
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      notify();
      return outcome;
    }
  };
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
