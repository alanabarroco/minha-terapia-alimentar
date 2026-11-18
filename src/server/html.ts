// Montagem de HTML com escape automático (proteção contra XSS).
export class Raw { constructor(public s: string) {} toString() { return this.s; } }
export const raw = (s: string) => new Raw(s);
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
/** Template com escape automático; use raw() para HTML já confiável e arrays para listas. */
export function h(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += render(vals[i]);
  });
  return new Raw(out);
}
function render(v: unknown): string {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
export const join = (xs: unknown[], sep = '') => new Raw(xs.map(render).join(sep));
