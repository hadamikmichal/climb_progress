import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStore } from '../../core/data/store';
import { CompletedWorkout } from '../../core/models/models';
import { progressiveOverload, TrackLoadView } from '../../core/logic/overload';
import { ProgressionDecision, Track } from '../../core/logic/progression';
import { addDays } from '../../core/logic/dates';
import { TYPE_SHORT } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';

const ORDER: Track[] = ['hang', 'aerobic', 'pe', 'hard'];

interface FollowUpForm {
  feeling: number | null;
  fingerPain: boolean | null;
}

/**
 * TRAINING LOAD PROGRESSION – aktualne, poprzednie i następne obciążenie w każdym torze,
 * warunki progresji, liczba udanych sesji i historia zmian. Logika: ProgressiveOverloadService (bez UI).
 */
@Component({
  selector: 'app-load-progression',
  imports: [RouterLink, DatePlPipe, Scale, YesNo],
  templateUrl: './load-progression.html',
  styleUrl: './load-progression.scss',
})
export class LoadProgressionPage {
  protected readonly store = inject(AppStore);
  protected readonly typeShort = TYPE_SHORT;

  protected readonly views = computed<TrackLoadView[]>(() => {
    const c = this.store.cycle();
    if (!c || !c.planStart) return [];
    // zależności sygnałów: treningi, pominięcia, zdarzenia
    this.store.completed();
    this.store.planned();
    const events = this.store.events().filter((e) => e.cycleId === c.id);
    return ORDER.map((t) => progressiveOverload.trackView(t, this.store.historyFor(c.id, t), c.params, events));
  });

  /** Sesje z ostatnich 3 dni bez samopoczucia następnego dnia */
  protected readonly followUpDue = computed<CompletedWorkout[]>(() => {
    const c = this.store.cycle();
    const today = this.store.today();
    if (!c) return [];
    return this.store.completedSorted()
      .filter((w) => w.cycleId === c.id && !w.deload && !w.followUp && w.date < today && w.date >= addDays(today, -3))
      .slice(0, 3);
  });
  protected readonly forms = signal<Record<string, FollowUpForm>>({});
  protected readonly followUpResult = signal<ProgressionDecision[] | null>(null);
  protected readonly busy = signal(false);

  /** Retest Max Hang po 6. tygodniu – identyczne warunki jak w teście początkowym */
  protected readonly retest = computed(() => {
    const c = this.store.cycle() ?? this.store.lastCycle();
    if (!c) return null;
    const base = this.store.assessmentFor(c.id, 'BASELINE');
    const final = this.store.assessmentFor(c.id, 'FINAL');
    const svc = progressiveOverload.hangboard;
    const baseline = svc.maxHang(base);
    const comparison = svc.compareMaxHang(base, final);
    const planned = this.store.planned().find((p) => p.cycleId === c.id && p.type === 'FINAL' && p.part === 'strength') ?? null;
    return { baseline, comparison, planned };
  });

  protected form(id: string): FollowUpForm {
    return this.forms()[id] ?? { feeling: null, fingerPain: null };
  }

  protected setForm(id: string, patch: Partial<FollowUpForm>) {
    this.forms.update((f) => ({ ...f, [id]: { ...this.form(id), ...patch } }));
  }

  protected async saveFollowUp(w: CompletedWorkout) {
    const f = this.form(w.id);
    if (f.feeling == null || f.fingerPain == null) return;
    this.busy.set(true);
    try {
      const d = await this.store.setFollowUp(w.id, { date: addDays(w.date, 1), feeling: f.feeling, fingerPain: f.fingerPain, notes: '' });
      this.followUpResult.set(d);
    } finally {
      this.busy.set(false);
    }
  }

  protected dots(v: TrackLoadView): boolean[] {
    return Array.from({ length: v.required }, (_, i) => i < v.successful);
  }

  protected fmt(n: number | null, unit = ''): string {
    if (n == null) return '–';
    return `${`${Math.round(n * 100) / 100}`.replace('.', ',')}${unit ? ' ' + unit : ''}`;
  }

  protected delta(n: number | null, unit = ''): string {
    if (n == null) return '–';
    const s = this.fmt(Math.abs(n), unit);
    return n > 0 ? `+${s}` : n < 0 ? `−${s}` : `±${s}`;
  }
}
