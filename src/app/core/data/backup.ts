import { AppData, ExportFile } from '../models/models';
import { STORES } from './db';

export const EXPORT_VERSION = 2;

export function buildExport(data: AppData, ts: string): ExportFile {
  return { app: 'ClimbProgress', version: EXPORT_VERSION, exportedAt: ts, data };
}

/** Walidacja pliku kopii zapasowej. Rzuca błąd z polskim komunikatem. */
export function parseImport(text: string): AppData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Plik nie jest poprawnym plikiem JSON.');
  }
  const f = raw as Partial<ExportFile>;
  if (!f || f.app !== 'ClimbProgress' || typeof f.data !== 'object' || f.data == null) {
    throw new Error('To nie jest kopia zapasowa ClimbProgress.');
  }
  if (typeof f.version !== 'number' || f.version > EXPORT_VERSION) {
    throw new Error(`Nieobsługiwana wersja kopii (${f.version}).`);
  }
  const data = {} as Record<string, unknown[]>;
  for (const s of STORES) {
    const v = (f.data as unknown as Record<string, unknown>)[s];
    if (v == null) {
      data[s] = [];
      continue;
    }
    if (!Array.isArray(v)) throw new Error(`Nieprawidłowa sekcja „${s}”.`);
    for (const item of v) {
      if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') {
        throw new Error(`Rekord bez identyfikatora w sekcji „${s}”.`);
      }
    }
    data[s] = v;
  }
  return data as unknown as AppData;
}
