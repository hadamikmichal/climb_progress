import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { AscentStyle, CompletedWorkout, GripPosition, HangboardLog, RouteLog } from '../../core/models/models';
import { assessSession, formatLoad } from '../../core/logic/progression';
import { prescriptionLines } from '../../core/logic/describe';
import { GRADES } from '../../core/logic/grades';
import { now, uid } from '../../core/logic/ids';
import { ASCENT_LABELS, GRIP_LABELS, TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';
import { MetricItem, MetricRow } from '../progress/metric-row';

/** Szczegóły zapisanego treningu z możliwością edycji */
@Component({
  selector: 'app-workout-detail',
  imports: [RouterLink, FormsModule, DatePlPipe, Icon, MetricRow],
  template: `
    <div class="page">
      @if (w(); as w) {
        <header class="page-head">
          <div>
            <div class="eyebrow">{{ w.date | datePl }} · {{ typeShort[w.type] }} · tydz. {{ w.week }}@if (w.deload) { · deload / lżej }</div>
            <h1>{{ templates[w.type].name }}</h1>
          </div>
          <div class="row">
            <a class="btn sm ghost" routerLink="/history"><app-icon name="arrow-left" /> Dziennik</a>
            <button class="btn sm" [class.dark]="!editing()" type="button" (click)="toggleEdit()">@if (!editing()) { <app-icon name="edit" /> Edytuj } @else { Anuluj }</button>
          </div>
        </header>

        @if (!editing()) {
          <app-metric-row [items]="metrics()" />

          <section class="section">
            <div class="section-head"><h3>Ocena sesji</h3><span class="eyebrow">{{ quality() }}</span></div>
            <p class="facts mono">@for (f of assessment().facts; track f) { <span>{{ f }}</span> }</p>
            @if (assessment().issues.length) { <p class="muted small">Uwagi: {{ assessment().issues.join(', ') }}.</p> }
            @if (w.notes) { <blockquote class="notes">„{{ w.notes }}”</blockquote> }
          </section>

          <section class="section two">
            <div>
              <h3>Plan sesji</h3>
              <ul class="plain">@for (l of presc(); track l) { <li>{{ l }}</li> }</ul>
            </div>
            <div>
              <h3>Wykonanie</h3>
              <ul class="plain ticks">
                @for (e of w.exercises; track e.exerciseId) {
                  @if (e.kind !== 'technique') { <li [class.miss]="!e.done"><app-icon [name]="e.done ? 'check' : 'x'" /> {{ e.name }}</li> }
                } @empty { <li class="miss">Brak zapisanej listy ćwiczeń.</li> }
              </ul>
            </div>
          </section>

          @if (w.hangs.length) {
            <section class="section">
              <div class="section-head"><h3>Max Hangs · Beastmaker 2000</h3></div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Krawądka</th><th>Chwyt</th><th class="num">Serie</th><th class="num">Obciążenie</th><th class="num">RPE</th></tr></thead>
                  <tbody>
                    @for (h of w.hangs; track h.id) {
                      <tr>
                        <td>{{ h.edge }}@if (h.edgeSizeMm) { <span class="mono"> · {{ h.edgeSizeMm }} mm</span> }</td>
                        <td>{{ gripLabels[h.grip] }}</td>
                        <td class="num">{{ h.setsDone }}/{{ h.setsPlanned }} × {{ h.hangSec }} s</td>
                        <td class="num">{{ fmtLoad(h) }}</td>
                        <td class="num">{{ h.rpe ?? '–' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @for (h of w.hangs; track h.id) { @if (h.pain) { <p class="note warn">Zgłoszony ból lub dyskomfort podczas zwisów.</p> } }
            </section>
          }

          @if (w.routes.length) {
            <section class="section">
              <div class="section-head"><h3>Drogi</h3><span class="eyebrow">{{ sent() }}/{{ w.routes.length }} ukończone</span></div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr>@if (w.type === 'C') { <th>Seria</th> }<th class="num">#</th><th>Wycena</th><th>Wynik</th>@if (w.type === 'A') { <th>Styl</th><th>Crux</th> }<th class="num">Pompa</th></tr></thead>
                  <tbody>
                    @for (r of w.routes; track r.id) {
                      <tr>
                        @if (w.type === 'C') { <td class="mono">{{ r.setIndex }}</td> }
                        <td class="num">{{ r.order }}</td>
                        <td class="mono"><strong>{{ r.grade }}</strong></td>
                        <td [class.trend-worse]="!r.completed">{{ r.completed ? 'ukończona' : 'odpadnięcie' }}</td>
                        @if (w.type === 'A') { <td class="mono">{{ r.ascent ? ascentLabels[r.ascent] : '–' }}</td><td>{{ r.cruxSent ? '✓' : '–' }}</td> }
                        <td class="num">{{ r.pump ?? '–' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }

          @if (w.sets.length) {
            <section class="section">
              <div class="section-head"><h3>Serie obwodu</h3></div>
              <div class="table-wrap">
                <table class="table">
                  <thead><tr><th>Seria</th><th class="num">RPE</th><th class="num">Pompa</th><th>Uwagi</th></tr></thead>
                  <tbody>
                    @for (s of w.sets; track s.setIndex) {
                      <tr><td class="mono">{{ s.setIndex }}</td><td class="num">{{ s.rpe ?? '–' }}</td><td class="num">{{ s.pump ?? '–' }}</td><td class="muted">{{ s.notes || '–' }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }

          <section class="section">
            <div class="section-head"><h3>Decyzje planu</h3></div>
            @for (e of events(); track e.id) {
              <div class="note" [class.ok]="e.kind === 'progress'" [class.warn]="e.kind === 'reduce'" [class.info]="e.kind === 'hold' || e.kind === 'deload'"><p>{{ e.reason }}</p></div>
            } @empty {
              <p class="muted small">Ta sesja nie zmieniła parametrów planu.</p>
            }
            <p class="faint small">Edycja historii nie zmienia wstecz już podjętych decyzji adaptacji – są zapisane jako zdarzenia z uzasadnieniem.</p>
          </section>
        } @else if (form(); as f) {
          <section class="section">
            <div class="section-head"><h3>Edycja sesji</h3></div>
            <div class="grid-2">
              <label class="field">Data<input type="date" [(ngModel)]="f.date" /></label>
              <label class="field">Czas trwania (min)<input type="number" min="1" [(ngModel)]="f.durationMin" /></label>
              <label class="field">Wykonanie
                <select [(ngModel)]="f.completion"><option value="full">Pełne</option><option value="partial">Częściowe</option></select>
              </label>
              <label class="field">RPE (1–10)<input type="number" min="1" max="10" [(ngModel)]="f.rpe" /></label>
              <label class="field">Pompowanie (0–10)<input type="number" min="0" max="10" [(ngModel)]="f.pump" /></label>
              <label class="field">Technika (1–5)<input type="number" min="1" max="5" [(ngModel)]="f.technique" /></label>
              <label class="field">Samopoczucie po (1–5)<input type="number" min="1" max="5" [(ngModel)]="f.feelingAfter" /></label>
            </div>
            <label class="field">Notatki<textarea [(ngModel)]="f.notes"></textarea></label>
            <h4>Ćwiczenia</h4>
            @for (e of f.exercises; track e.exerciseId) {
              @if (e.kind !== 'technique') { <label class="check-line"><input type="checkbox" [(ngModel)]="e.done" /> {{ e.name }}</label> }
            }
          </section>

          @if (f.hangs.length || f.type === 'B') {
            <section class="section">
              <div class="section-head"><h3>Zwisy</h3>@if (!f.hangs.length) { <button class="btn sm" type="button" (click)="addHang(f)"><app-icon name="plus" /> Dodaj</button> }</div>
              @for (h of f.hangs; track h.id) {
                <div class="grid-2">
                  <label class="field">Krawądka<input [(ngModel)]="h.edge" /></label>
                  <label class="field">Rozmiar (mm)<input type="number" [(ngModel)]="h.edgeSizeMm" /></label>
                  <label class="field">Uchwyt<select [(ngModel)]="h.grip">@for (g of grips; track g) { <option [value]="g">{{ gripLabels[g] }}</option> }</select></label>
                  <label class="field">Czas zwisu (s)<input type="number" [(ngModel)]="h.hangSec" /></label>
                  <label class="field">Serie wykonane<input type="number" min="0" [(ngModel)]="h.setsDone" /></label>
                  <label class="field">Serie zaplanowane<input type="number" min="0" [(ngModel)]="h.setsPlanned" /></label>
                  <label class="field">Obciążenie +kg<input type="number" step="0.5" [(ngModel)]="h.addedKg" /></label>
                  <label class="field">Odciążenie −kg<input type="number" step="0.5" [(ngModel)]="h.assistKg" /></label>
                  <label class="field">RPE<input type="number" min="1" max="10" [(ngModel)]="h.rpe" /></label>
                  <label class="check-line"><input type="checkbox" [(ngModel)]="h.pain" /> Ból / dyskomfort</label>
                </div>
                <button class="btn ghost sm" type="button" (click)="f.hangs = []"><app-icon name="trash" /> Usuń zwisy</button>
              }
            </section>
          }

          <section class="section">
            <div class="section-head"><h3>Drogi</h3><button class="btn sm" type="button" (click)="addRoute(f)"><app-icon name="plus" /> Droga</button></div>
            @for (r of f.routes; track r.id) {
              <div class="edit-route" [class.with-set]="f.type === 'C'" [class.with-style]="f.type === 'A'">
                @if (f.type === 'C') { <input type="number" min="1" [(ngModel)]="r.setIndex" aria-label="Seria" title="Seria" /> }
                <select [(ngModel)]="r.grade" aria-label="Wycena">@for (g of grades; track g) { <option [value]="g">{{ g }}</option> }</select>
                <label class="check-line"><input type="checkbox" [(ngModel)]="r.completed" /> ukończ.</label>
                @if (f.type === 'A') {
                  <select [(ngModel)]="r.ascent" aria-label="Styl przejścia" [disabled]="!r.completed">
                    <option [ngValue]="null">styl –</option>
                    @for (a of ascents; track a) { <option [ngValue]="a">{{ ascentLabels[a] }}</option> }
                  </select>
                }
                <input type="number" min="0" max="10" [(ngModel)]="r.pump" placeholder="pompa" aria-label="Pompowanie" />
                <button class="btn ghost sm" type="button" (click)="removeRoute(f, r.id)" aria-label="Usuń drogę"><app-icon name="x" /></button>
              </div>
            } @empty { <p class="empty">Brak dróg.</p> }
          </section>

          <div class="btn-row">
            <button class="btn primary big" type="button" (click)="save(f)" [disabled]="busy()">Zapisz zmiany</button>
            <button class="btn danger" type="button" (click)="remove(w)"><app-icon name="trash" /> Usuń trening</button>
          </div>
        }
      } @else {
        <p class="empty">Nie znaleziono treningu. <a routerLink="/history">Wróć do dziennika</a></p>
      }
    </div>
  `,
  styles: `
    .btn app-icon { --icon: 16px; }
    .facts { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 0.82rem; margin: 0; }
    .notes { margin: 0; padding-left: 12px; border-left: 2px solid var(--color-border-strong); font-style: italic; color: var(--color-text-primary); }
    .two { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 768px) { .two { grid-template-columns: 1fr 1fr; } }
    .two > div { display: flex; flex-direction: column; gap: 8px; }
    .plain { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; font-size: 0.9rem; }
    .plain li { padding: 7px 0; border-bottom: 1px solid var(--color-border); }
    .ticks li { display: flex; align-items: center; gap: 8px; --icon: 16px; }
    .ticks li.miss { color: var(--color-text-secondary); }
    .ticks li.miss app-icon { color: var(--color-warning); }
    .edit-route { display: grid; grid-template-columns: 1fr auto 70px auto; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--color-border); }
    .edit-route.with-set { grid-template-columns: 52px 1fr auto 70px auto; }
    .edit-route.with-style { grid-template-columns: 1fr auto 88px 64px auto; }
  `,
})
export class WorkoutDetail {
  protected readonly store = inject(AppStore);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  protected readonly templates = TEMPLATES;
  protected readonly typeShort = TYPE_SHORT;
  protected readonly gripLabels = GRIP_LABELS;
  protected readonly grips = Object.keys(GRIP_LABELS) as GripPosition[];
  protected readonly grades = GRADES;
  protected readonly fmtLoad = formatLoad;
  protected readonly ascentLabels = ASCENT_LABELS;
  protected readonly ascents = Object.keys(ASCENT_LABELS) as AscentStyle[];

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly form = signal<CompletedWorkout | null>(null);

  protected readonly w = computed(() => this.store.completed().find((x) => x.id === this.id()) ?? null);
  protected readonly presc = computed(() => (this.w() ? prescriptionLines(this.w()!.type, this.w()!.prescription) : []));
  protected readonly assessment = computed(() => assessSession(this.w()!));
  protected readonly quality = computed(() => ({ good: 'dobra sesja', ok: 'bez progresji', bad: 'sesja za ciężka' })[this.assessment().quality]);
  protected readonly metrics = computed<MetricItem[]>(() => {
    const w = this.w()!;
    return [
      { label: 'Czas', value: String(w.durationMin), unit: 'min' },
      { label: 'Wykonanie', value: w.completion === 'full' ? 'pełne' : 'częściowe' },
      { label: 'RPE', value: w.rpe != null ? String(w.rpe) : '–', unit: '/10' },
      { label: 'Pompowanie', value: w.pump != null ? String(w.pump) : '–', unit: '/10' },
      { label: 'Technika', value: w.technique != null ? String(w.technique) : '–', unit: '/5' },
      { label: 'Po treningu', value: w.feelingAfter != null ? String(w.feelingAfter) : '–', unit: '/5' },
    ];
  });
  protected readonly sent = computed(() => this.w()?.routes.filter((r) => r.completed).length ?? 0);
  protected readonly events = computed(() => this.store.eventsSorted().filter((e) => e.sourceIds.includes(this.id())));

  constructor() {
    effect(() => {
      this.id();
      untracked(() => this.editing.set(false));
    });
  }

  protected toggleEdit() {
    if (this.editing()) {
      this.editing.set(false);
      return;
    }
    this.form.set(structuredClone(this.w()!));
    this.editing.set(true);
  }

  protected addRoute(f: CompletedWorkout) {
    const last = f.routes[f.routes.length - 1];
    const r: RouteLog = {
      id: uid(), order: f.routes.length + 1, setIndex: last?.setIndex ?? (f.type === 'C' ? 1 : 0), grade: last?.grade ?? '6a', lengthM: 13,
      completed: true, pump: null, rpe: null, notes: '', timestamp: now(),
    };
    f.routes = [...f.routes, r];
  }

  protected removeRoute(f: CompletedWorkout, id: string) {
    f.routes = f.routes.filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i + 1 }));
  }

  protected addHang(f: CompletedWorkout) {
    const p = f.prescription.hangboard;
    const h: HangboardLog = {
      id: uid(), date: f.date, board: 'Beastmaker 2000', holdType: p.holdType, edge: p.edge, edgeSizeMm: p.edgeSizeMm, grip: p.grip, hangSec: p.hangSec,
      setsPlanned: p.sets, setsDone: p.sets, addedKg: p.addedKg, assistKg: p.assistKg, rpe: null, pain: false, notes: '', timestamp: now(),
    };
    f.hangs = [h];
  }

  protected async save(f: CompletedWorkout) {
    this.busy.set(true);
    const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
    const clean: CompletedWorkout = {
      ...f,
      durationMin: Number(f.durationMin) || 1,
      rpe: num(f.rpe), pump: num(f.pump), technique: num(f.technique), feelingAfter: num(f.feelingAfter),
      routes: f.routes.map((r) => ({ ...r, pump: num(r.pump), setIndex: Number(r.setIndex) || 0, ascent: r.completed ? r.ascent ?? null : null })),
      hangs: f.hangs.map((h) => ({
        ...h, date: f.date, edgeSizeMm: num(h.edgeSizeMm), hangSec: Number(h.hangSec) || 10, setsDone: Number(h.setsDone) || 0, setsPlanned: Number(h.setsPlanned) || 0,
        addedKg: Number(h.addedKg) || 0, assistKg: Number(h.assistKg) || 0, rpe: num(h.rpe),
      })),
    };
    await this.store.updateCompleted(clean);
    this.busy.set(false);
    this.editing.set(false);
  }

  protected async remove(w: CompletedWorkout) {
    if (!confirm('Usunąć ten trening z historii? Zaplanowana jednostka wróci do statusu „zaplanowany”.')) return;
    await this.store.deleteCompleted(w.id);
    void this.router.navigate(['/history']);
  }
}
