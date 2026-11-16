import { Component, computed, input } from '@angular/core';
import { AbilityKey, AbilityReport } from '../../core/models/models';
import { ABILITY_LABELS, ABILITY_PL, STATUS_LABELS, STATUS_ORDER } from '../../core/logic/adaptive/abilities';
import { PE_PROTOCOLS, FINGER_PROTOCOL_LABELS } from '../../core/logic/adaptive/protocols';

/**
 * Profil zdolności po Baseline Test: trzy niezależne statusy (bez jednego ogólnego poziomu),
 * najmocniejsza strona, ograniczenia, priorytet i dobrany protokół – zawsze z uzasadnieniem.
 */
@Component({
  selector: 'app-ability-report',
  template: `
    @let r = report();
    <div class="profiles">
      @for (k of keys; track k) {
        @let p = r.profiles[k];
        <details class="ab" [class.main]="k === r.mainLimitation && !balanced()" [class.top]="k === r.strongest && !balanced()">
          <summary>
            <span class="ab-name">{{ labels[k] }}</span>
            <span class="ab-tag mono">
              @if (balanced()) {
                @if (k === r.strongest) { względnie najmocniejsza } @else if (k === r.mainLimitation) { względnie najsłabsza }
              } @else {
                @if (k === r.strongest) { najmocniejsza strona } @else if (k === r.mainLimitation) { główne ograniczenie } @else if (k === r.secondaryLimitation) { drugie ograniczenie }
              }
            </span>
            <span class="scale" [attr.aria-label]="'Status: ' + status[p.status]">
              @for (s of order; track s; let i = $index) { <i [class.on]="i <= rank(p.status)"></i> }
            </span>
            <strong class="ab-status">{{ status[p.status] }}</strong>
            <span class="conf mono">pewność: {{ conf[p.confidence] }}</span>
          </summary>
          <ul class="ev">
            @for (e of p.evidence; track e) { <li>{{ e }}</li> }
            @if (p.missing.length) { <li class="faint">Brak danych: {{ p.missing.join(', ') }}</li> }
          </ul>
        </details>
      }
    </div>
    <dl class="sum">
      <div><dt>Najmocniejsza strona</dt><dd>{{ pl[r.strongest] }}</dd></div>
      <div><dt>{{ balanced() ? 'Względnie najsłabsza' : 'Główne ograniczenie' }}</dt><dd>{{ pl[r.mainLimitation] }}</dd></div>
      <div><dt>{{ balanced() ? 'Następna w kolejności' : 'Drugie ograniczenie' }}</dt><dd>{{ pl[r.secondaryLimitation] }}</dd></div>
      <div><dt>Protokół C</dt><dd>{{ protocols[r.recommendedProtocol].name }}</dd></div>
      <div><dt>Palce</dt><dd>{{ finger[r.fingerProtocol] }}</dd></div>
    </dl>
    <p class="priority"><span class="eyebrow">Priorytet treningowy</span>{{ r.priority }}</p>
    @if (showReasons()) {
      <details class="why">
        <summary class="eyebrow">Dlaczego taki plan</summary>
        <ul>@for (x of r.reasons; track x) { <li>{{ x }}</li> }</ul>
      </details>
    }
    <p class="faint disclaimer">Statusy to wewnętrzna klasyfikacja programu do doboru treningu – nie oficjalna ocena sportowa. Nie wynikają z punktów 9c.</p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s3); }
    .profiles { display: flex; flex-direction: column; border-top: 1px solid var(--color-border); }
    .ab { border-bottom: 1px solid var(--color-border); }
    .ab summary {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name status' 'tag scale' 'conf conf';
      gap: 2px 12px; align-items: center; padding: 12px 0; cursor: pointer; list-style: none;
    }
    .ab summary::-webkit-details-marker { display: none; }
    @media (min-width: 640px) {
      .ab summary { grid-template-columns: 180px minmax(0, 1fr) auto auto; grid-template-areas: 'name tag scale status' 'conf conf conf conf'; }
    }
    .ab-name { grid-area: name; font: 600 0.95rem var(--font-heading); }
    .ab-tag { grid-area: tag; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-secondary); }
    .ab.main .ab-tag { color: var(--color-warning); }
    .ab.top .ab-tag { color: var(--color-primary-strong); }
    .ab-status { grid-area: status; font-size: 0.88rem; text-align: right; }
    .conf { grid-area: conf; font-size: 0.7rem; color: var(--color-text-muted); }
    .scale { grid-area: scale; display: inline-flex; gap: 3px; justify-self: end; }
    .scale i { width: 18px; height: 6px; border-radius: 1px; background: var(--color-surface-elevated); }
    .scale i.on { background: var(--color-primary); }
    .ab.main .scale i.on { background: var(--color-warning); }
    .ev { margin: 0 0 12px; padding-left: 18px; font-size: 0.85rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 4px; }
    .sum { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin: 0; }
    @media (min-width: 640px) { .sum { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
    .sum dt { font: 500 0.68rem var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-secondary); }
    .sum dd { margin: 2px 0 0; font-weight: 600; }
    .priority { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-left: 3px solid var(--color-primary); background: var(--color-surface); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-weight: 600; }
    .why ul { margin: 8px 0 0; padding-left: 18px; font-size: 0.85rem; color: var(--color-text-secondary); display: flex; flex-direction: column; gap: 4px; }
    .why summary { cursor: pointer; }
    .disclaimer { font-size: 0.75rem; }
  `,
})
export class AbilityReportView {
  readonly report = input.required<AbilityReport>();
  readonly showReasons = input(true);
  protected readonly balanced = computed(() => new Set(this.keys.map((k) => this.report().profiles[k].status)).size === 1);
  protected readonly keys: AbilityKey[] = ['finger', 'powerEndurance', 'aerobic'];
  protected readonly labels = ABILITY_LABELS;
  protected readonly pl = ABILITY_PL;
  protected readonly status = STATUS_LABELS;
  protected readonly order = STATUS_ORDER;
  protected readonly protocols = PE_PROTOCOLS;
  protected readonly finger = FINGER_PROTOCOL_LABELS;
  protected readonly conf = { low: 'niska', medium: 'średnia', high: 'wysoka' } as const;
  protected readonly rank = (s: (typeof STATUS_ORDER)[number]) => STATUS_ORDER.indexOf(s);
}
