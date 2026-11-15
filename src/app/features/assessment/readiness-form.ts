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
    <section class="card">
      <h2>Warunki początkowe</h2>
      <p class="faint">Ważenie przed każdą sesją. Testy w podobnej porze dnia, z podobną rozgrzewką, sprzętem, magnezją i nawodnieniem. W asekuracji.</p>
      <label class="field">Masa ciała (kg) – z dzisiejszego ważenia</label>
      <app-stepper [value]="r.bodyMassKg" (valueChange)="set('bodyMassKg', $event)" [step]="0.1" [min]="0" unit="kg" label="Masa ciała" />
      <div class="grid-2">
        <label class="field">Data i godzina testu
          <input type="datetime-local" [ngModel]="local(r.testedAt)" (ngModelChange)="setTime($event)" />
        </label>
        <label class="field">Sen poprzedniej nocy (h)
          <input type="number" inputmode="decimal" step="0.5" min="0" max="16" [ngModel]="r.sleepHours" (ngModelChange)="set('sleepHours', $event === '' || $event == null ? null : +$event)" />
        </label>
      </div>
      <label class="field">Samopoczucie (1–5)</label>
      <app-scale [min]="1" [max]="5" [value]="r.wellbeing" (valueChange)="set('wellbeing', $event)" low="bardzo słabe" high="świetne" />
      <label class="field">Zmęczenie (1–5)</label>
      <app-scale [min]="1" [max]="5" [hotFrom]="4" [value]="r.fatigue" (valueChange)="set('fatigue', $event)" low="wypoczęty" high="bardzo zmęczony" />
      <label class="field">Ból palców?</label>
      <app-yes-no [value]="r.fingerPain" (valueChange)="set('fingerPain', $event)" [warnOnYes]="true" />
      <label class="field">Ból łokci?</label>
      <app-yes-no [value]="r.elbowPain" (valueChange)="set('elbowPain', $event)" [warnOnYes]="true" />
      <label class="field">Ból barków?</label>
      <app-yes-no [value]="r.shoulderPain" (valueChange)="set('shoulderPain', $event)" [warnOnYes]="true" />
      @if (r.fingerPain || r.elbowPain || r.shoulderPain) {
        <label class="field">Opis dolegliwości (opcjonalnie)<input [ngModel]="r.painNotes" (ngModelChange)="set('painNotes', $event)" /></label>
      }
      <label class="field">Choroba / infekcja?</label>
      <app-yes-no [value]="r.illness" (valueChange)="set('illness', $event)" [warnOnYes]="true" />
      <label class="field">Intensywny trening w ostatnich 48 h?</label>
      <app-yes-no [value]="r.recentHardTraining" (valueChange)="set('recentHardTraining', $event)" [warnOnYes]="true" />

      @let v = verdict();
      @for (b of v.blockers; track b) { <div class="note bad"><strong>Test zablokowany.</strong> {{ b }}</div> }
      @if (!v.blocked) {
        @for (w of v.warnings; track w) { <div class="note warn">{{ w }}</div> }
        @if (v.warnings.length) {
          <label class="check-line"><input type="checkbox" [ngModel]="r.acknowledgedWarnings" (ngModelChange)="set('acknowledgedWarnings', $event)" /> Rozumiem – kontynuuję mimo to (wynik zostanie oznaczony jako mniej porównywalny)</label>
        }
      }
      @if (!v.complete) { <p class="faint">Uzupełnij: {{ v.missing.join(', ') }}.</p> }
      @if (v.blocked) {
        <button class="btn danger xl" type="button" (click)="postpone.emit()">Przełóż test</button>
      } @else {
        <button class="btn primary xl" type="button" [disabled]="!allowed()" (click)="confirm.emit()">Dalej – rozgrzewka</button>
      }
    </section>
  `,
  styles: `.check-line { display: flex; gap: 10px; align-items: flex-start; font-size: 0.9rem; }`,
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
