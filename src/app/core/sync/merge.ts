import { AppData, AdaptationEvent, CompletedWorkout, PlannedWorkout, ReadinessCheck, TestResult, TrainingCycle, UserProfile } from '../models/models';
import { Assessment } from '../models/assessment';
import { WriteOp } from '../data/db';

/** Stan konta pobrany z Neon, już w modelu aplikacji */
export interface RemoteSnapshot {
  profile: UserProfile | null;
  cycles: TrainingCycle[];
  planned: PlannedWorkout[];
  completed: CompletedWorkout[];
  assessments: Assessment[];
  tests: TestResult[];
  readiness: ReadinessCheck[];
  events: AdaptationEvent[];
}

type ListStore = Exclude<keyof RemoteSnapshot, 'profile'>;
const LIST_STORES: ListStore[] = ['cycles', 'planned', 'completed', 'assessments', 'tests', 'readiness', 'events'];

/**
 * Operacje scalające serwer → lokalnie. Serwer jest źródłem prawdy dla rekordów bez oczekujących
 * zmian lokalnych: nowe/zmienione rekordy są zapisywane, a rekordy usunięte na innym urządzeniu – usuwane.
 * Rekordy z wpisem w kolejce (`pending`, klucz `store:id`) zostają nietknięte.
 */
export function buildMergeOps(remote: RemoteSnapshot, local: AppData, pending: Set<string>): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const s of LIST_STORES) {
    const items = remote[s] as { id: string }[];
    const remoteIds = new Set(items.map((x) => x.id));
    const put = items.filter((x) => !pending.has(`${s}:${x.id}`));
    const del = ((local[s] ?? []) as { id: string }[]).map((x) => x.id).filter((id) => !remoteIds.has(id) && !pending.has(`${s}:${id}`));
    if (put.length || del.length) ops.push({ store: s, put, del });
  }
  if (remote.profile && !pending.has('profile:me')) ops.push({ store: 'profile', put: [{ ...remote.profile, id: 'me' }] });
  return ops;
}
