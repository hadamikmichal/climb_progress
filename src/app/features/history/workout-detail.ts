import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AppStore } from '../../core/data/store';
import { CompletedWorkout, GripPosition, HangboardLog, RouteLog } from '../../core/models/models';
import { assessSession, formatLoad } from '../../core/logic/progression';
import { prescriptionLines } from '../../core/logic/describe';
import { GRADES } from '../../core/logic/grades';
import { now, uid } from '../../core/logic/ids';
import { GRIP_LABELS, TEMPLATES, TYPE_SHORT } from '../../core/logic/templates';
import { DatePlPipe } from '../../shared/pipes';

/** Szczegóły zapisanego treningu z możliwością edycji */
@Component({
  selector: 'app-workout-detail',
  imports: [RouterLink, FormsModule, DatePlPipe],
  template: `
    <div class="page">
      @if (w(); as w) {
        <header class="page-head">
          <div>
            <div class="eyebrow">{{ w.date | datePl }} · {{ typeShort[w.type] }}@if (w.deload) { · deload / lżej }</div>
            <h1>{{ templates[w.type].name }}</h1>
          </div>
          <div class="row">
            <a class="btn sm" routerLink="/history">‹ Historia</a>
            <button class="btn sm" [class.primary]="!editing()" type="button" (click)="toggleEdit()">{{ editing() ? 'Anuluj' : 'Edytuj' }}</button>
          </div>
        </header>

        @if (!editing()) {
          <section class="card">
            <div class="grid-2 grid-md-3">
              <div class="stat"><span class="value">{{ w.durationMin }}<small> min</small></span><span class="label">czas trwania</span></div>
              <div class="stat"><span class="value">{{ w.completion === 'full' ? 'Pełny' : 'Częściowy' }}</span><span class="label">wykonanie</span></div>
              <div class="stat"><span class="value">{{ w.rpe ?? '–' }}</span><span class="label">RPE</span></div>
              <div class="stat"><span class="value">{{ w.pump ?? '–' }}<small>/10</small></span><span class="label">pompowanie</span></div>
              <div class="stat"><span class="value">{{ w.technique ?? '–' }}<small>/5</small></span><span class="label">technika</span></div>
              <div class="stat"><span class="value">{{ w.feelingAfter ?? '–' }}<small>/5</small></span><span class="label">samopoczucie po</span></div>
            </div>
            @if (w.notes) { <p><strong>Notatki:</strong> {{ w.notes }}</p> }
          </section>

          <section class="card">
            <h3>Plan tej sesji</h3>
            <ul class="presc">@for (l of presc(); track l) { <li>{{ l }}</li> }</ul>
            <h3>Wykonane ćwiczenia</h3>
            @for (e of w.exercises; track e.exerciseId) {
              @if (e.kind !== 'technique') { <div>{{ e.done ? '✓' : '✗' }} {{ e.name }}</div> }
            }
          </section>

          @if (w.hangs.length) {
            <section class="card">
              <h3>Beastmaker 2000</h3>
              @for (h of w.hangs; track h.id) {
                <p>{{ gripLabels[h.grip] }} · {{ h.edge }}@if (h.edgeSizeMm) { ({{ h.edgeSizeMm }} mm) } · {{ h.setsDone }}/{{ h.setsPlanned }} × {{ h.hangSec }} s · {{ fmtLoad(h) }} · RPE {{ h.rpe ?? '–' }}</p>
                @if (h.pain) { <p class="note bad">Zgłoszony ból lub dyskomfort.</p> }
              }
            </section>
          }

          @if (w.routes.length) {
            <section class="card">
              <h3>Drogi ({{ sent() }}/{{ w.routes.length }} ukończone)</h3>
              <table class="table">
                <thead><tr>@if (w.type === 'C') { <th>Seria</th> }<th>#</th><th>Wycena</th><th>Wynik</th><th class="num">Pompa</th>@if (w.type === 'A') { <th>Crux</th> }</tr></thead>
                <tbody>
                  @for (r of w.routes; track r.id) {
                    <tr>
                      @if (w.type === 'C') { <td>{{ r.setIndex }}</td> }
                      <td>{{ r.order }}</td><td>{{ r.grade }}</td><td>{{ r.completed ? 'ukończona' : 'odpadnięcie' }}</td><td class="num">{{ r.pump ?? '–' }}</td>
                      @if (w.type === 'A') { <td>{{ r.cruxSent ? '✓' : '–' }}</td> }
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @if (w.sets.length) {
            <section class="card">
              <h3>Serie obwodu</h3>
              @for (s of w.sets; track s.setIndex) {
                <p>Seria {{ s.setIndex }}: RPE {{ s.rpe ?? '–' }} · pompa {{ s.pump ?? '–' }}/10@if (s.notes) { · {{ s.notes }} }</p>
              }
            </section>
          }

          <section class="card">
            <h3>Ocena sesji i decyzje planu</h3>
            <div class="row wrap">@for (f of assessment().facts; track f) { <span class="tag">{{ f }}</span> }</div>
            @if (assessment().issues.length) { <p class="muted">{{ assessment().issues.join(', ') }}</p> }
            @for (e of events(); track e.id) {
              <div class="note" [class.ok]="e.kind === 'progress'" [class.warn]="e.kind === 'reduce'" [class.info]="e.kind === 'hold' || e.kind === 'deload'"><p>{{ e.reason }}</p></div>
            }
            <p class="faint">Edycja historii nie zmienia wstecz już podjętych decyzji adaptacji – są zapisane jako zdarzenia z uzasadnieniem.</p>
          </section>
        } @else if (form(); as f) {
          <section class="card">
            <h3>Edycja</h3>
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
            <h3>Ćwiczenia</h3>
            @for (e of f.exercises; track e.exerciseId) {
              @if (e.kind !== 'technique') { <label class="row"><input type="checkbox" [(ngModel)]="e.done" /> {{ e.name }}</label> }
            }
          </section>

          @if (f.hangs.length || f.type === 'B') {
            <section class="card">
              <div class="card-title"><h3>Zwisy</h3>@if (!f.hangs.length) { <button class="btn sm" type="button" (click)="addHang(f)">+ Dodaj</button> }</div>
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
                  <label class="row"><input type="checkbox" [(ngModel)]="h.pain" /> Ból / dyskomfort</label>
                </div>
                <button class="btn ghost sm" type="button" (click)="f.hangs = []">Usuń zwisy</button>
              }
            </section>
          }

          <section class="card">
            <div class="card-title"><h3>Drogi</h3><button class="btn sm" type="button" (click)="addRoute(f)">+ Droga</button></div>
            @for (r of f.routes; track r.id) {
              <div class="edit-route">
                @if (f.type === 'C') { <input type="number" min="1" [(ngModel)]="r.setIndex" aria-label="Seria" title="Seria" /> }
                <select [(ngModel)]="r.grade" aria-label="Wycena">@for (g of grades; track g) { <option [value]="g">{{ g }}</option> }</select>
                <label class="row"><input type="checkbox" [(ngModel)]="r.completed" /> ukończ.</label>
                <input type="number" min="0" max="10" [(ngModel)]="r.pump" placeholder="pompa" aria-label="Pompowanie" />
                <button class="btn ghost sm" type="button" (click)="removeRoute(f, r.id)" aria-label="Usuń drogę">✕</button>
              </div>
            } @empty { <p class="empty">Brak dróg.</p> }
          </section>

          <div class="btn-row">
            <button class="btn primary big" type="button" (click)="save(f)" [disabled]="busy()">Zapisz zmiany</button>
            <button class="btn danger" type="button" (click)="remove(w)">Usuń trening</button>
          </div>
        }
      } @else {
        <div class="card"><h2>Nie znaleziono treningu</h2><a class="btn" routerLink="/history">Historia</a></div>
      }
    </div>
  `,
  styles: `
    .presc { margin: 0; padding-left: 18px; }
    .edit-route { display: grid; grid-template-columns: 52px 1fr auto 70px auto; gap: 6px; align-items: center; }
    .edit-route:not(:has(input[title='Seria'])) { grid-template-columns: 1fr auto 70px auto; }
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

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly form = signal<CompletedWorkout | null>(null);

  protected readonly w = computed(() => this.store.completed().find((x) => x.id === this.id()) ?? null);
  protected readonly presc = computed(() => (this.w() ? prescriptionLines(this.w()!.type, this.w()!.prescription) : []));
  protected readonly assessment = computed(() => assessSession(this.w()!));
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
      routes: f.routes.map((r) => ({ ...r, pump: num(r.pump), setIndex: Number(r.setIndex) || 0 })),
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
