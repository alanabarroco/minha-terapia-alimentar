// Motor de formulários: renderiza campos e lê/valida o POST (datas DD/MM/AAAA, números com vírgula).
import { h, Raw, join } from './html';
import { Ctx } from './web';
import { fromBR, toBR } from '../lib/age';
import type { ColType } from './db';

export type FieldType = 'text' | 'email' | 'textarea' | 'date' | 'time' | 'number' | 'int' | 'select' | 'bool' | 'multi';
export type Field = {
  name: string; label: string; type: FieldType; options?: [string, string][]; required?: boolean;
  hint?: string; min?: number; max?: number; list?: string[]; internal?: boolean;
};
export type Group = { title: string; fields: Field[]; hint?: string };

export const colType = (t: FieldType): ColType =>
  ({ text: 'text', email: 'text', textarea: 'text', date: 'date', time: 'time', number: 'number', int: 'int', select: 'text', bool: 'bool', multi: 'multi' } as const)[t];

export const fmtNum = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
const opt = (v: string, l: string, sel: boolean) => h`<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;

export function renderField(f: Field, values: Record<string, any>): Raw {
  const v = values[f.name];
  const req = f.required ? 'required' : '';
  const hint = f.hint ? h`<span class="hint">${f.hint}</span>` : '';
  switch (f.type) {
    case 'textarea':
      return h`<label>${f.label}${f.required ? ' *' : ''}<textarea name="${f.name}" ${req} rows="3">${v ?? ''}</textarea>${hint}</label>`;
    case 'select':
      return h`<label>${f.label}${f.required ? ' *' : ''}<select name="${f.name}" ${req}><option value="">— selecione —</option>${(f.options ?? []).map(([val, l]) => opt(val, l, val === (v ?? '')))}</select>${hint}</label>`;
    case 'bool':
      return h`<label class="check"><input type="checkbox" name="${f.name}" value="on" ${v ? 'checked' : ''}> ${f.label}</label>`;
    case 'multi': {
      const cur: string[] = Array.isArray(v) ? v : [];
      return h`<fieldset><legend>${f.label}</legend><div class="scale">${(f.options ?? []).map(([val, l]) =>
        h`<label class="check"><input type="checkbox" name="${f.name}" value="${val}" ${cur.includes(val) ? 'checked' : ''}> ${l}</label>`)}</div>${hint}</fieldset>`;
    }
    case 'date':
      return h`<label>${f.label}${f.required ? ' *' : ''}<input name="${f.name}" value="${toBR(v)}" placeholder="DD/MM/AAAA" inputmode="numeric" pattern="\\d{2}/\\d{2}/\\d{4}" data-mask="date" ${req} maxlength="10" autocomplete="off">${hint}</label>`;
    case 'time':
      return h`<label>${f.label}${f.required ? ' *' : ''}<input type="time" name="${f.name}" value="${v ? String(v).slice(0, 5) : ''}" ${req}>${hint}</label>`;
    case 'number':
      return h`<label>${f.label}${f.required ? ' *' : ''}<input name="${f.name}" value="${fmtNum(v)}" inputmode="decimal" pattern="[0-9]+([,.][0-9]+)?" ${req}>${hint}</label>`;
    case 'int':
      return h`<label>${f.label}${f.required ? ' *' : ''}<input name="${f.name}" value="${v ?? ''}" inputmode="numeric" pattern="[0-9]+" ${req}>${hint}</label>`;
    case 'email':
      return h`<label>${f.label}<input type="email" name="${f.name}" value="${v ?? ''}">${hint}</label>`;
    default: {
      const dl = f.list ? h`<datalist id="dl_${f.name}">${f.list.map((x) => h`<option value="${x}">`)}</datalist>` : '';
      return h`<label>${f.label}${f.required ? ' *' : ''}<input name="${f.name}" value="${v ?? ''}" ${req} ${f.list ? `list="dl_${f.name}"` : ''} maxlength="300" autocomplete="off">${dl}${hint}</label>`;
    }
  }
}

export function renderGroups(groups: Group[], values: Record<string, any>): Raw {
  return join(groups.map((g) => h`<fieldset class="card"><legend>${g.title}</legend>${g.hint ? h`<p class="hint">${g.hint}</p>` : ''}
    <div class="row">${g.fields.map((f) => (f.type === 'textarea' || f.type === 'multi' ? h`<div style="grid-column:1/-1">${renderField(f, values)}</div>` : renderField(f, values)))}</div></fieldset>`));
}

export type ReadResult = { values: Record<string, any>; errors: string[] };
export function readFields(c: Ctx, fields: Field[]): ReadResult {
  const values: Record<string, any> = {}; const errors: string[] = [];
  for (const f of fields) {
    if (f.type === 'multi') { values[f.name] = (c.form?.getAll(f.name) ?? []).map(String).filter(Boolean); continue; }
    if (f.type === 'bool') { values[f.name] = c.form?.get(f.name) === 'on'; continue; }
    const raw = String(c.form?.get(f.name) ?? '').trim();
    if (!raw) { values[f.name] = null; if (f.required) errors.push(`${f.label}: campo obrigatório.`); continue; }
    if (f.type === 'date') {
      const iso = fromBR(raw);
      if (!iso) errors.push(`${f.label}: data inválida (use DD/MM/AAAA).`); else values[f.name] = iso;
    } else if (f.type === 'time') {
      if (!/^\d{2}:\d{2}$/.test(raw)) errors.push(`${f.label}: horário inválido.`); else values[f.name] = raw;
    } else if (f.type === 'number') {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) errors.push(`${f.label}: número inválido.`); else values[f.name] = n;
    } else if (f.type === 'int') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) errors.push(`${f.label}: informe um número inteiro.`); else values[f.name] = n;
    } else if (f.type === 'select') {
      if (f.options && !f.options.some(([v]) => v === raw)) errors.push(`${f.label}: opção inválida.`); else values[f.name] = raw;
    } else values[f.name] = raw.slice(0, 20000);
  }
  return { values, errors };
}
export const flatFields = (groups: Group[]) => groups.flatMap((g) => g.fields);
export const colsOf = (fields: Field[]) => fields.map((f) => ({ name: f.name, type: colType(f.type) }));
