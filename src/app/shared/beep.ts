/** Sygnał końca odliczania: wibracja + krótki dźwięk (bez zależności) */
export function beep(times = 1): void {
  try { navigator.vibrate?.(times > 1 ? [200, 100, 200, 100, 200] : [200, 100, 200]); } catch { /* brak wsparcia */ }
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime + i * 0.45;
      o.start(t);
      o.stop(t + 0.3);
      if (i === times - 1) o.onended = () => ctx.close();
    }
  } catch { /* brak audio */ }
}
