export function kopecksToRubles(kopecks: number): number;
export function parseRublesToKopecks(value: string, allowNegative?: boolean): number | null;
/** @deprecated Pass the original input string to parseRublesToKopecks instead. */
export function rublesToKopecks(rubles: number): number;
export function formatRubles(kopecks: number): string;
export function formatRublesShort(kopecks: number): string;
export function formatNumber(rubles: number): string;
