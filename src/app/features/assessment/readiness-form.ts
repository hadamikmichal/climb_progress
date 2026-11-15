import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionReadiness } from '../../core/models/assessment';
import { evaluateTestReadiness, readinessAllowsStart } from '../../core/logic/assessment/factory';
import { Scale } from '../../shared/scale';
import { YesNo } from '../../shared/yes-no';
import { NumberStepper } from '../../shared/number-stepper';

/** Warunki początkowe sesji testowej – wspólne dla dnia 1 i 2 */
@Component({
  selector: 'app-test-readiness',
  imports: [FormsModule, Scale, YesNo, NumberStepper],
  template: `
    @let r = value();
    <section class="rf">
      <div class="grp">
        <span class="kicker">Ważenie · dziś</span>
        <app-stepper [value]="r.bodyMassKg" (valueChange)="set('bodyMassKg', $event)" [step]="0.1" [min]="0" unit="kg · masa ciała z dzisiejszego ważenia" label="Masa ciała" />
      </div>
      <div class="grid-2 compact">
        <label class="field">Data i godzina
          <input type="datetime-local" [ngModel]="local(r.testedAt)" (ngModelChange)="setTime($event)" />
        </label>
        <label class="field">Sen (h)
          <input type="number" inputmode="decimal" step="0.5" min="0" max="16" [ngModel]="r.sleepHours" (ngModelChange)="set('sleepHours', $event === '' || $event == null ? null : +$event)" />
        </label>
      </div>
      <div class="grp">
        <span class="kicker">Samopoczucie</span>
        <app-scale [min]="1" [max]="5" [value]="r.wellbeing" (valueChange)="set('wellbeing', $event)" low="bardzo słabe" high="świetne" label="Samopoczucie" />
      </div>
      <div class="grp">
        <span class="kicker">Zmęczenie</span>
        <app-scale [min]="1" [max]="5" [hotFrom]="4" [value]="r.fatigue" (valueChange)="set('fatigue', $event)" low="wypoczęty" high="bardzo zmęczony" label="Zmęczenie" />
      </div>
      <div class="qs">
        <span class="kicker">Dolegliwości i obciążenie</span>
        <div class="q"><span>Ból palców</span><app-yes-no [value]="r.fingerPain" (valueChange)="set('fingerPain', $event)" [warnOnYes]="true" label="Ból palców" /></div>
        <div class="q"><span>Ból łokci</span><app-yes-no [value]="r.elbowPain" (valueChange)="set('elbowPain', $event)" [warnOnYes]="true" label="Ból łokci" /></div>
        <div class="q"><span>Ból barków</span><app-yes-no [value]="r.shoulderPain" (valueChange)="set('shoulderPain', $event)" [warnOnYes]="true" label="Ból barków" /></div>
        <div class="q"><span>Choroba / infekcja</span><app-yes-no [value]="r.illness" (valueChange)="set('illness', $event)" [warnOnYes]="true" label="Choroba" /></div>
        <div class="q"><span>Intensywny trening w ostatnich 48 h</span><app-yes-no [value]="r.recentHardTraining" (valueChange)="set('recentHardTraining', $event)" [warnOnYes]="true" label="Trening w 48 h" /></div>
      </div>
      @if (r.fingerPain || r.elbowPain || r.shoulderPain) {
        <label class="field">Opis dolegliwości (opcjonalnie)<input [ngModel]="r.painNotes" (ngModelChange)="set('painNotes', $event)" /></label>
      }

      @let v = verdict();
      @for (b of v.blockers; track b) { <div class="note bad"><strong>Test zablokowany.</strong> {{ b }}</div> }
      @if (!v.blocked) {
        @for (w of v.warnings; track w) { <div class="note warn">{{ w }}</div> }
        @if (v.warnings.length) {
          <label class="check-line"><input type="checkbox" [ngModel]="r.acknowledgedWarnings" (ngModelChange)="set('acknowledgedWarnings', $event)" /> Rozumiem – kontynuuję mimo to (wynik zostanie oznaczony jako mniej porównywalny)</label>
        }
      }
      @if (!v.complete) { <p class="params">Uzupełnij: {{ v.missing.join(', ') }}</p> }
      <div class="foot">
        @if (v.blocked) {
          <button class="btn danger xl" type="button" (click)="postpone.emit()">Przełóż test</button>
        } @else {
          <button class="btn primary xl" type="button" [disabled]="!allowed()" (click)="confirm.emit()">Dalej · rozgrzewka</button>
        }
      </div>
    </section>
  `,
  styles: `
    .rf { display: flex; flex-direction: column; gap: var(--s5); }
    .grp { display: flex; flex-direction: column; gap: var(--s2); }
    .compact { gap: var(--s2); }
    .qs { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
    .qs > .kicker { padding: var(--s3) 0 var(--s2); }
    .q { display: grid; grid-template-columns: minmax(0, 1fr) 176px; align-items: center; gap: var(--s3); min-height: 60px; padding: 6px 0; border-top: 1px solid var(--border); font-weight: 500; }
    .params { font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted); }
    .check-line { display: flex; gap: 10px; align-items: flex-start; font-size: 0.9rem; }
    .foot { position: sticky; bottom: 0; padding: var(--s3) 0 calc(var(--s3) + env(safe-area-inset-bottom)); background: linear-gradient(to top, var(--bg) 70%, transparent); }
  `,
})
export class TestReadinessForm {
  readonly value = input.required<SessionReadiness>();
  readonly hoursSinceStrength = input<number | null>(null);
  /** Pojedyncza zmiana pola – rodzic nakłada ją na najnowszy stan (bez ryzyka nadpisania przez nieaktualną kopię) */
  readonly changed = output<Partial<SessionReadiness>>();
  readonly confirm = output<void>();
  readonly postpone = output<void>();

  protected readonly verdict = computed(() => evaluateTestReadiness(this.value(), this.hoursSinceStrength()));
  protected readonly allowed = computed(() => readinessAllowsStart(this.value(), this.verdict()));

  protected set<K extends keyof SessionReadiness>(k: K, v: SessionReadiness[K]) {
    this.changed.emit({ [k]: v } as Partial<SessionReadiness>);
  }

  protected local(ts: string): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  protected setTime(v: string) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) this.set('testedAt', d.toISOString());
  }
}
