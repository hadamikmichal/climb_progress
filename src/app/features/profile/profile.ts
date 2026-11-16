import { Component, computed, inject, signal } from '@angular/core';
import { ThemePref, ThemeService } from '../../shared/theme';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { GripPosition, HangboardSetup, HoldType, TrainingParams, TrainingType, UserProfile, Weekday } from '../../core/models/models';
import { GRADES } from '../../core/logic/grades';
import { WEEKDAY_NAMES, toISODate } from '../../core/logic/dates';
import { validateTrainingDays } from '../../core/logic/plan';
import { GRIP_LABELS, HOLD_LABELS, TEMPLATES } from '../../core/logic/templates';
import { describeLevel } from '../../core/logic/progression';
import { DatePlPipe } from '../../shared/pipes';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, FormsModule, DatePlPipe],
  templateUrl: './profile.html',
  styles: `
    .pf-sum { font-size: 0.85rem; }
    .pf-sec { display: flex; flex-direction: column; gap: var(--s4); }
    .pf-head { display: flex; align-items: baseline; gap: var(--s3); padding-top: var(--s2); border-top: 1px solid var(--border-strong); }
    .pf-head.sub { border-top-color: var(--border); margin-top: var(--s3); }
    .pf-head .num { font-size: 0.75rem; color: var(--muted); }
    .pf-head h2 { flex: 1; }
    .pf-h4 { margin-top: var(--s3); padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    .pf-save { align-self: flex-start; }
    .cyc { display: flex; flex-direction: column; gap: 2px; }
    .cyc small { font-size: 0.78rem; }
    @media (max-width: 559px) { .pf-save { align-self: stretch; } }
    .theme-seg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .theme-seg button {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 96px; padding: 12px;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text);
      font: inherit; text-align: left; cursor: pointer; transition: border-color var(--dur) var(--ease);
    }
    .theme-seg button.on { border-color: var(--text); box-shadow: inset 0 -3px 0 var(--accent); }
    .theme-seg .t { font: 700 0.95rem var(--font-heading); }
    .theme-seg .d { font-size: 0.75rem; color: var(--muted); line-height: 1.3; }
    .swatch { width: 28px; height: 18px; border-radius: 4px; border: 1px solid var(--border); }
    .swatch[data-swatch='light'] { background: #f3f2ed; }
    .swatch[data-swatch='dark'] { background: #1a1f1b; }
    .swatch[data-swatch='auto'] { background: linear-gradient(135deg, #f3f2ed 50%, #1a1f1b 50%); }
    .small-note { font-size: 0.82rem; }
  `,
})
export class ProfilePage {
  protected readonly store = inject(AppStore);
  protected readonly grades = GRADES;
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly holdLabels = HOLD_LABELS;
  protected readonly grips = Object.keys(GRIP_LABELS) as GripPosition[];
  protected readonly holds = Object.keys(HOLD_LABELS) as HoldType[];
  protected readonly weekdays = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((d) => ({ d, name: WEEKDAY_NAMES[d] }));
  protected readonly types: TrainingType[] = ['A', 'B', 'C'];
  protected readonly templates = TEMPLATES;

  protected readonly p = signal<UserProfile>(structuredClone(this.store.profile()));
  protected readonly params = signal<TrainingParams | null>(this.store.cycle() ? structuredClone(this.store.cycle()!.params) : null);
  protected readonly theme = inject(ThemeService);
  protected readonly themeOptions: { key: ThemePref; label: string; desc: string }[] = [
    { key: 'light', label: 'Jasny', desc: 'Kreda i grafit – domyślny' },
    { key: 'dark', label: 'Ciemny', desc: 'Grafitowe tło, mniej światła' },
    { key: 'auto', label: 'Auto', desc: 'Zgodnie z ustawieniem systemu' },
  ];
  protected readonly msg = signal<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  protected readonly busy = signal(false);

  protected readonly dayErrors = computed(() => validateTrainingDays(this.p().trainingDays));
  protected readonly cycles = computed(() => [...this.store.cycles()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));

  /* Akcesory do edycji (zwracają funkcję modyfikującą kopię) */
  protected readonly setName = (v: string) => (p: UserProfile) => {
    p.name = v;
  };
  protected readonly setNum = (k: 'heightCm' | 'weightKg' | 'routeLengthM', v: unknown) => (p: UserProfile) => {
    p[k] = Number(v);
  };
  protected readonly setStr = (k: 'grade' | 'targetGrade', v: string) => (p: UserProfile) => {
    p[k] = v;
  };
  protected readonly setHb = (k: keyof HangboardSetup, v: unknown) => (p: UserProfile) => {
    (p.hangboard as unknown as Record<string, unknown>)[k] = v;
  };
  protected readonly pp = (sec: keyof TrainingParams, k: string, v: unknown) => (n: TrainingParams) => {
    (n[sec] as unknown as Record<string, unknown>)[k] = v;
  };

  protected edit(fn: (p: UserProfile) => void) {
    const n = structuredClone(this.p());
    fn(n);
    this.p.set(n);
  }

  protected editParams(fn: (p: TrainingParams) => void) {
    const cur = this.params();
    if (!cur) return;
    const n = structuredClone(cur);
    fn(n);
    this.params.set(n);
  }

  protected setDay(t: TrainingType, d: string) {
    this.edit((p) => (p.trainingDays[t] = Number(d) as Weekday));
  }

  protected async saveProfile() {
    if (this.dayErrors().length) return;
    this.busy.set(true);
    const p = this.p();
    const clean: UserProfile = { ...p, heightCm: Number(p.heightCm) || 0, weightKg: Number(p.weightKg) || 0, routeLengthM: Number(p.routeLengthM) || 13,
      hangboard: { ...p.hangboard, edgeSizeMm: p.hangboard.edgeSizeMm ? Number(p.hangboard.edgeSizeMm) : null } };
    const moved = await this.store.saveProfile(clean);
    this.p.set(structuredClone(this.store.profile()));
    this.busy.set(false);
    this.msg.set({ kind: 'ok', text: moved ? `Zapisano. Przeliczono daty ${moved} przyszłych jednostek – obciążenie bez zmian.` : 'Zapisano profil.' });
  }

  protected async saveParams() {
    const c = this.store.cycle();
    const n = this.params();
    if (!c || !n) return;
    const num = (v: unknown, f: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : f);
    const clean: TrainingParams = {
      hangboard: { ...n.hangboard, hangSec: num(n.hangboard.hangSec, 10), sets: Math.min(5, num(n.hangboard.sets, 3)), restSec: num(n.hangboard.restSec, 180),
        addedKg: num(n.hangboard.addedKg, 0), assistKg: num(n.hangboard.assistKg, 0), edgeSizeMm: n.hangboard.edgeSizeMm ? Number(n.hangboard.edgeSizeMm) : null },
      hardRoutes: { ...n.hardRoutes, maxAttempts: num(n.hardRoutes.maxAttempts, 6) },
      aerobic: { ...n.aerobic, routes: num(n.aerobic.routes, 4), restMin: num(n.aerobic.restMin, 3), targetMaxPump: num(n.aerobic.targetMaxPump, 4) },
      powerEndurance: { ...n.powerEndurance, sets: num(n.powerEndurance.sets, 2), routesPerSet: num(n.powerEndurance.routesPerSet, 3),
        restBetweenRoutesMin: num(n.powerEndurance.restBetweenRoutesMin, 2), restBetweenSetsMin: num(n.powerEndurance.restBetweenSetsMin, 12) },
    };
    const changes = this.types
      .filter((t) => describeLevel(t, c.params) !== describeLevel(t, clean))
      .map((t) => `${t}: ${describeLevel(t, c.params)} → ${describeLevel(t, clean)}`);
    const text = changes.length ? `Ręczna zmiana parametrów – ${changes.join('; ')}.` : 'Ręczna korekta parametrów pomocniczych (przerwy, rozmiar krawądki).';
    await this.store.updateParams(clean, `${text} Nowy poziom wymaga dwóch dobrych sesji przed kolejną progresją.`);
    this.params.set(structuredClone(clean));
    this.msg.set({ kind: 'ok', text: 'Zapisano parametry cyklu. Zmiana jest widoczna w historii zmian planu.' });
  }

  protected exportData() {
    const blob = new Blob([this.store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `climbprogress-${toISODate(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.msg.set({ kind: 'ok', text: 'Wyeksportowano kopię zapasową.' });
  }

  protected async importData(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('Import zastąpi wszystkie obecne dane danymi z pliku. Kontynuować?')) return;
    try {
      await this.store.importJson(await file.text());
      this.p.set(structuredClone(this.store.profile()));
      this.params.set(this.store.cycle() ? structuredClone(this.store.cycle()!.params) : null);
      this.msg.set({ kind: 'ok', text: `Zaimportowano dane: ${this.store.completed().length} treningów, ${this.store.tests().length} testów.` });
    } catch (e) {
      this.msg.set({ kind: 'bad', text: e instanceof Error ? e.message : 'Nie udało się zaimportować pliku.' });
    }
  }

  protected async reset() {
    if (!confirm('Usunąć WSZYSTKIE dane (profil, cykle, historię)? Najpierw wyeksportuj kopię zapasową.')) return;
    if (!confirm('Na pewno? Tej operacji nie można cofnąć.')) return;
    await this.store.resetAll();
    this.p.set(structuredClone(this.store.profile()));
    this.params.set(null);
    this.msg.set({ kind: 'info', text: 'Dane zostały usunięte.' });
  }

  protected async newCycle() {
    const active = this.store.cycle();
    if (active && !confirm(`${active.name} jest w trakcie. Rozpoczęcie nowego cyklu zarchiwizuje bieżący. Kontynuować?`)) return;
    await this.store.startCycle(this.store.today());
    this.params.set(structuredClone(this.store.cycle()!.params));
    this.msg.set({ kind: 'ok', text: 'Rozpoczęto nowy cykl – zacznij od testu początkowego na ekranie Start.' });
  }

}
