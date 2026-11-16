/** Skala francuska używana do porównań i wykresów */
export const GRADES = [
  '4a', '4b', '4c', '5a', '5a+', '5b', '5b+', '5c', '5c+',
  '6a', '6a+', '6b', '6b+', '6c', '6c+',
  '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a',
] as const;

/** Skala Font – wyłącznie dla protokołu Boulder 4 × 4 */
export const FONT_GRADES = [
  '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B',
] as const;

export function fontIndex(g: string | null | undefined): number {
  if (!g) return -1;
  return FONT_GRADES.indexOf(g.trim().toUpperCase() as (typeof FONT_GRADES)[number]);
}

export function shiftFont(g: string, steps: number): string {
  const i = fontIndex(g);
  if (i < 0) return g;
  return FONT_GRADES[Math.min(FONT_GRADES.length - 1, Math.max(0, i + steps))];
}

export function gradeIndex(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADES.indexOf(g.trim().toLowerCase() as (typeof GRADES)[number]);
}

export function isValidGrade(g: string): boolean {
  return gradeIndex(g) >= 0;
}

/** Przesuwa wycenę o `steps` stopni, z ograniczeniem do zakresu [min, max] */
export function shiftGrade(g: string, steps: number, min = '4a', max = '9a'): string {
  const i = gradeIndex(g);
  if (i < 0) return g;
  const lo = gradeIndex(min);
  const hi = gradeIndex(max);
  const n = Math.min(hi, Math.max(lo, i + steps));
  return GRADES[n];
}

export function maxGrade(grades: string[]): string | null {
  let best = -1;
  for (const g of grades) best = Math.max(best, gradeIndex(g));
  return best >= 0 ? GRADES[best] : null;
}
