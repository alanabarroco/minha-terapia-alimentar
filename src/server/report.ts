// Relatórios: monta UMA estrutura (ReportDoc) a partir de registros SELECIONADOS e a renderiza em HTML (prévia) e PDF.
// Notas internas só entram se explicitamente marcadas. Nenhum dado profissional é inventado (CRN, assinatura etc.).
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { h, Raw } from './html';
import { J, J1, Tx, isUuid } from './db';
import { ageLabel, dateTimeBR, toBR, todayISO } from '../lib/age';
import { ANAMNESE, locLabel, EXPLORATION_STEPS, PROGRESS, TERMS, REFERRALS } from './entities';
import { AREAS, AGE_BANDS, QUESTIONNAIRE_NAME, QUESTIONNAIRE_NOTE } from '../lib/questionnaire/items';
import { scoreQuestionnaire } from '../lib/questionnaire/scoring';
import { fmtNum } from './forms';

export const REPORT_TYPES: Record<string, string> = {
  avaliacao_inicial: 'Avaliação inicial', acompanhamento: 'Acompanhamento', sessoes: 'Sessões', diario: 'Diário alimentar',
  escola: 'Registros escolares', orientacoes_familia: 'Orientações à família',
};
export type Block = { t: 'kv'; pairs: [string, string][] } | { t: 'p'; text: string } | { t: 'table'; head: string[]; rows: string[][] };
export type ReportDoc = {
  type: string; title: string; patientName: string; identification: [string, string][]; period: string;
  professional: [string, string][]; service: string[]; sections: { heading: string; blocks: Block[] }[]; generatedAt: string; includesInternal: boolean;
};
export type ReportInput = { patientId: string; type: string; from: string | null; to: string | null; selected: string[]; internal: boolean };

const val = (v: any) => (v === null || v === undefined ? '' : String(v));
const pairs = (xs: [string, any][]): [string, string][] => xs.filter(([, v]) => val(v) !== '').map(([k, v]) => [k, val(v)]);
const parseTok = (selected: string[]) => {
  const by: Record<string, string[]> = {};
  for (const s of selected) { const [k, id] = s.split(':'); if (k && (id === 'all' || isUuid(id))) (by[k] ||= []).push(id); }
  return by;
};

export async function buildReport(tx: Tx, u: { id: string; full_name: string; email: string; crn: string | null; professional_title: string | null }, inp: ReportInput): Promise<ReportDoc | null> {
  const p = await J1<any>(tx, `select * from public.patients where id = $1`, [inp.patientId]);
  if (!p || !REPORT_TYPES[inp.type]) return null;
  const by = parseTok(inp.selected);
  const sections: ReportDoc['sections'] = [];
  const internal = inp.internal;
  const inRange = (col: string) => `(${col} >= coalesce($2::date, '0001-01-01') and ${col} <= coalesce($3::date, '9999-12-31'))`;
  const args = [p.id, inp.from, inp.to];
  const ids = (k: string) => (by[k] ?? []).filter((x) => x !== 'all');

  if (by.anamneses?.length) {
    const a = await J<any>(tx, `select * from public.anamneses where patient_id = $1 and id = any($2::uuid[]) order by recorded_on`, [p.id, ids('anamneses')]);
    for (const x of a) sections.push({ heading: `Anamnese (${toBR(x.recorded_on)})`, blocks: [{ t: 'kv', pairs: pairs([...ANAMNESE.map((q) => [q.label, x.answers?.[q.key]] as [string, any]), ...(internal ? [['Notas internas', x.internal_notes] as [string, any]] : [])]) }] });
  }
  if (by.growth?.length) {
    const m = await J<any>(tx, `select * from public.growth_measurements where patient_id = $1 and ${inRange('measured_on')} order by measured_on`, args);
    sections.push({ heading: 'Crescimento — histórico de medidas', blocks: [m.length ? { t: 'table', head: ['Data', 'Idade', 'Peso (kg)', 'Altura/comprimento (cm)', 'IMC (kg/m²)'],
      rows: m.map((x) => [toBR(x.measured_on), ageLabel(p.birth_date, x.measured_on), x.weight_kg ? fmtNum(x.weight_kg) : '—', x.height_cm ? fmtNum(x.height_cm) : '—', x.bmi ? fmtNum(x.bmi) : '—']) } : { t: 'p', text: 'Nenhuma medida no período.' },
      { t: 'p', text: 'Somente o histórico de medidas registradas. Sem curvas, percentis ou escores, salvo quando a referência oficial estiver configurada no sistema.' }] });
  }
  if (by.questionnaires?.length) {
    const qs = await J<any>(tx, `select * from public.questionnaire_responses where patient_id = $1 and id = any($2::uuid[]) order by answered_on`, [p.id, ids('questionnaires')]);
    for (const q of qs) {
      const res = scoreQuestionnaire(q.age_band, q.answers);
      sections.push({ heading: `${QUESTIONNAIRE_NAME} — ${AGE_BANDS.find((b) => b.id === q.age_band)?.label} (${toBR(q.answered_on)})`, blocks: [
        { t: 'p', text: QUESTIONNAIRE_NOTE + ' Resumo descritivo: média de 0 (Nunca) a 4 (Sempre) dos itens respondidos; "não se aplica" não entra no cálculo; sem pontos de corte ou classificação.' },
        { t: 'table', head: ['Área', 'Itens respondidos', 'Média (0–4)'], rows: res.map((r) => [r.label, `${r.answered} de ${r.totalItems}`, r.mean !== null ? fmtNum(r.mean) : 'respostas insuficientes']) },
        { t: 'kv', pairs: pairs([['Raciocínio clínico', q.clinical_reasoning], ['Avaliação a considerar (decisão profissional)', (q.referral_areas ?? []).map((k: string) => REFERRALS.find((r) => r[0] === k)?.[1]).join(', ')], ['Respondente', q.interviewee], ...(internal ? [['Notas internas', q.internal_notes] as [string, any]] : [])]) }] });
    }
  }
  if (by.repertoire?.length) {
    const f = await J<any>(tx, `select * from public.food_repertoire where patient_id = $1 order by acceptance, food_name`, [p.id]);
    sections.push({ heading: 'Repertório alimentar registrado', blocks: [f.length ? { t: 'table', head: ['Alimento', 'Grupo', 'Situação', 'Observações'], rows: f.map((x) => [x.food_name, val(x.food_group), x.acceptance === 'aceito' ? 'Aceito' : x.acceptance === 'recusado' ? 'Recusado' : 'Em exploração', val(x.context_notes)]) } : { t: 'p', text: 'Nenhum alimento registrado.' },
      { t: 'p', text: 'Este registro descreve o observado e não permite concluir deficiência nutricional nem estimar ingestão.' }] });
  }
  if (by.plans?.length) {
    const pl = await J<any>(tx, `select * from public.therapeutic_plans where patient_id = $1 and id = any($2::uuid[]) order by created_at`, [p.id, ids('plans')]);
    for (const x of pl) {
      const g = await J<any>(tx, `select * from public.plan_goals where plan_id = $1 order by sort_order, created_at`, [x.id]);
      sections.push({ heading: `Planejamento: ${x.title}`, blocks: [{ t: 'kv', pairs: pairs([['Atividades previstas', x.activities], ['Alimentos e preparações', x.foods], ['Materiais', x.materials], ['Orientações à família', x.family_guidance], ['Orientações à escola', x.school_guidance], ['Revisão', toBR(x.review_date)], ...(internal ? [['Notas internas', x.internal_notes] as [string, any]] : [])]) },
        ...(g.length ? [{ t: 'table' as const, head: ['Prazo', 'Meta', 'Andamento', ...(internal ? ['Evolução'] : [])], rows: g.map((y) => [TERMS.find((t) => t[0] === y.term)?.[1] ?? y.term, y.description, PROGRESS.find((t) => t[0] === y.progress)?.[1] ?? y.progress, ...(internal ? [val(y.progress_notes)] : [])]) }] : [])] });
    }
  }
  if (by.sessions?.length) {
    const ss = await J<any>(tx, `select * from public.sessions where patient_id = $1 and id = any($2::uuid[]) order by session_date`, [p.id, ids('sessions')]);
    for (const s of ss) sections.push({ heading: `Sessão de ${toBR(s.session_date)} — ${locLabel(s.location)}`, blocks: [{ t: 'kv', pairs: pairs([['Objetivos', s.objectives], ['Alimentos e preparações', s.foods], ['Atividades', s.activities], ['Habilidades trabalhadas', s.skills], ['Apoios utilizados', s.supports], ['Respostas observadas', s.observed_responses],
      ['Exploração alimentar', (s.exploration ?? []).map((e: any) => `${e.alimento}: ${(e.etapas ?? []).map((k: string) => EXPLORATION_STEPS.find((x) => x[0] === k)?.[1]).join(', ')}`).join('\n')], ['Resultados', s.outcomes], ['Orientações', s.guidance], ['Próximos passos', s.next_steps], ...(internal ? [['Notas internas', s.internal_notes] as [string, any]] : [])]) }] });
  }
  if (by.diary?.length) {
    const d = await J<any>(tx, `select * from public.food_diary_entries where patient_id = $1 and id = any($2::uuid[]) order by entry_date, entry_time`, [p.id, ids('diary')]);
    for (const e of d) sections.push({ heading: `Diário — ${toBR(e.entry_date)} ${e.entry_time ? String(e.entry_time).slice(0, 5) : ''} ${val(e.meal)}`, blocks: [{ t: 'kv', pairs: pairs([['Local / companhia', [e.location, e.companions].filter(Boolean).join(' · ')], ['Oferecido', `${val(e.foods_served)}${e.qty_offered ? ` (${fmtNum(e.qty_offered)} ${val(e.qty_unit)})` : ''}`.trim()],
      ['Consumido', `${val(e.foods_accepted)}${e.qty_consumed ? ` (${fmtNum(e.qty_consumed)} ${val(e.qty_unit)})` : ''}`.trim()], ['Textura / temperatura', [e.texture, e.temperature].filter(Boolean).join(' · ')], ['Utensílios / ajuda', [e.utensils, e.help_needed].filter(Boolean).join(' · ')], ['Telas', e.screen_use],
      ['Duração', e.duration_min ? e.duration_min + ' min' : ''], ['Comportamento antes', e.behavior_before], ['Durante', e.behavior_during], ['Depois', e.behavior_after], ['Fome / saciedade', [e.hunger_cues, e.satiety_cues].filter(Boolean).join(' / ')], ['Recusa ou desconforto', e.refusal_events],
      ['Leite / fórmula', [e.milk_type, e.formula_name, e.milk_volume_ml ? fmtNum(e.milk_volume_ml) + ' ml' : '', e.milk_frequency, e.container, e.night_offers, e.dilution_info].filter(Boolean).join(' · ')], ['Observações', e.observations], ...(internal ? [['Notas internas', e.internal_notes] as [string, any]] : [])]) }] });
  }
  if (by.school?.length) {
    const r = await J<any>(tx, `select * from public.school_meal_records where patient_id = $1 and id = any($2::uuid[]) order by record_date`, [p.id, ids('school')]);
    for (const e of r) sections.push({ heading: `Escola — ${toBR(e.record_date)} ${val(e.meal)}`, blocks: [{ t: 'kv', pairs: pairs([['Oferecido', e.foods_offered], ['Consumido', e.foods_consumed], ['Quantidade', e.qty_offered || e.qty_consumed ? `oferecida ${fmtNum(e.qty_offered) || '—'} / consumida ${fmtNum(e.qty_consumed) || '—'} ${val(e.qty_unit)}` : ''], ['Ambiente / companhia', [e.environment, e.companions].filter(Boolean).join(' · ')], ['Duração', e.duration_min ? e.duration_min + ' min' : ''], ['Ajuda', e.help_needed], ['Comportamento', e.behavior], ['Desconfortos', e.discomfort], ['Observações', e.notes]]) }] });
  }
  if (by.guidances?.length) {
    const g = await J<any>(tx, `select * from public.guidances where patient_id = $1 and id = any($2::uuid[]) order by created_at`, [p.id, ids('guidances')]);
    for (const x of g) sections.push({ heading: `Orientação: ${x.title}`, blocks: [{ t: 'p', text: x.body }, ...(internal && x.internal_notes ? [{ t: 'kv' as const, pairs: [['Notas internas', x.internal_notes] as [string, string]] }] : [])] });
  }
  const sv = await J<any>(tx, `select value from public.app_settings where key = 'profissional'`);
  const cfg = sv[0]?.value ?? {};
  const g: any[] = Array.isArray(p.guardians) ? p.guardians : [];
  return {
    type: inp.type, title: `Relatório — ${REPORT_TYPES[inp.type]}`, patientName: p.full_name,
    identification: pairs([['Nome', p.full_name], ['Data de nascimento', toBR(p.birth_date)], ['Idade', ageLabel(p.birth_date, todayISO())], ['Escola / turma', [p.school_name, p.class_name].filter(Boolean).join(' · ')], ['Responsáveis', g.map((x) => x.nome).filter(Boolean).join(', ')], ['Motivo da procura', p.reason]]),
    period: inp.from || inp.to ? `${inp.from ? toBR(inp.from) : 'início'} a ${inp.to ? toBR(inp.to) : 'hoje'}` : 'Sem período definido',
    professional: pairs([['Profissional responsável', u.full_name || u.email], ['Título', u.professional_title], ['Registro profissional', u.crn || 'não informado (configure em Minha conta)']]),
    service: [cfg.servico_nome, cfg.contato].filter(Boolean),
    sections, generatedAt: dateTimeBR(new Date().toISOString()), includesInternal: internal,
  };
}

export function reportHtml(d: ReportDoc): Raw {
  const block = (b: Block): Raw => b.t === 'p' ? h`<p style="white-space:pre-wrap">${b.text}</p>`
    : b.t === 'kv' ? h`<dl class="kv">${b.pairs.map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`
    : h`<div class="tablewrap"><table><thead><tr>${b.head.map((x) => h`<th>${x}</th>`)}</tr></thead><tbody>${b.rows.map((r) => h`<tr>${r.map((x) => h`<td>${x}</td>`)}</tr>`)}</tbody></table></div>`;
  return h`<div class="preview"><h2>${d.title}</h2>${d.service.length ? h`<p class="muted">${d.service.join(' · ')}</p>` : ''}
<h3>Identificação</h3>${block({ t: 'kv', pairs: d.identification })}<p><strong>Período:</strong> ${d.period}</p>
<h3>Profissional responsável</h3>${block({ t: 'kv', pairs: d.professional })}
${d.sections.length ? d.sections.map((s) => h`<h3>${s.heading}</h3>${s.blocks.map(block)}`) : h`<p class="muted">Nenhum registro selecionado.</p>`}
<p class="small muted">Gerado em ${d.generatedAt}. ${d.includesInternal ? 'ATENÇÃO: inclui notas internas — não compartilhar com família ou escola.' : 'Não inclui notas internas.'}</p></div>`;
}

// ---------- PDF ----------
export async function reportPdf(d: ReportDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 54, LW = W - 2 * M;
  const ok = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/→/g, '->').replace(/[–—]/g, '-').replace(/\r/g, '')).map((ch) => (ch === '\n' || ok.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  let page = pdf.addPage([W, H]); let y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (n: number) => { if (y - n < M + 20) newPage(); };
  const wrap = (text: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) <= width) line = t;
        else { if (line) out.push(line); line = w; while (f.widthOfTextAtSize(line, size) > width) { let k = line.length - 1; while (k > 1 && f.widthOfTextAtSize(line.slice(0, k), size) > width) k--; out.push(line.slice(0, k)); line = line.slice(k); } }
      }
      out.push(line);
    }
    return out;
  };
  const text = (t: string, o: { size?: number; f?: PDFFont; x?: number; width?: number; color?: [number, number, number]; gap?: number } = {}) => {
    const size = o.size ?? 10.5, f = o.f ?? font, x = o.x ?? M, width = o.width ?? LW;
    for (const ln of wrap(t, f, size, width)) { need(size + 4); page.drawText(ln, { x, y: y - size, size, font: f, color: rgb(...(o.color ?? [0.11, 0.17, 0.14])) }); y -= size + 4; }
    y -= o.gap ?? 0;
  };
  const heading = (t: string) => { need(40); y -= 8; page.drawRectangle({ x: M, y: y - 18, width: LW, height: 20, color: rgb(0.9, 0.94, 0.92) }); page.drawText(clean(t).slice(0, 95), { x: M + 6, y: y - 13, size: 11, font: bold, color: rgb(0.17, 0.31, 0.22) }); y -= 28; };
  const kvs = (ps: [string, string][]) => { for (const [k, v] of ps) { const lines = wrap(v, font, 10.5, LW - 150); need(15); page.drawText(clean(k) + ':', { x: M, y: y - 10.5, size: 9.5, font: bold, color: rgb(0.34, 0.4, 0.37) });
    lines.forEach((ln, i) => { need(15); page.drawText(ln, { x: M + 150, y: y - 10.5, size: 10.5, font, color: rgb(0.11, 0.17, 0.14) }); y -= 14.5; if (i === lines.length - 1) y -= 2; }); } };
  const tbl = (head: string[], rows: string[][]) => {
    const cw = LW / head.length;
    const row = (cells: string[], f: PDFFont, bg?: [number, number, number]) => {
      const wr = cells.map((c) => wrap(c, f, 9, cw - 8)); const hgt = Math.max(...wr.map((x) => x.length)) * 12 + 6; need(hgt);
      if (bg) page.drawRectangle({ x: M, y: y - hgt, width: LW, height: hgt, color: rgb(...bg) });
      wr.forEach((ls, i) => ls.forEach((ln, j) => page.drawText(ln, { x: M + i * cw + 4, y: y - 12 - j * 12, size: 9, font: f, color: rgb(0.11, 0.17, 0.14) })));
      page.drawLine({ start: { x: M, y: y - hgt }, end: { x: M + LW, y: y - hgt }, thickness: 0.5, color: rgb(0.8, 0.85, 0.82) }); y -= hgt;
    };
    row(head, bold, [0.9, 0.94, 0.92]); rows.forEach((r) => row(r, font)); y -= 6;
  };
  text('Minha Terapia Alimentar', { size: 10, f: bold, color: [0.23, 0.42, 0.31] });
  if (d.service.length) text(d.service.join(' · '), { size: 9, color: [0.34, 0.4, 0.37] });
  text(d.title, { size: 18, f: bold, gap: 4 });
  heading('Identificação'); kvs(d.identification); kvs([['Período', d.period]]);
  heading('Profissional responsável'); kvs(d.professional);
  if (!d.sections.length) text('Nenhum registro selecionado.');
  for (const s of d.sections) {
    heading(s.heading);
    for (const b of s.blocks) { if (b.t === 'p') text(b.text, { gap: 4 }); else if (b.t === 'kv') kvs(b.pairs); else tbl(b.head, b.rows); }
  }
  need(70); y -= 24; page.drawLine({ start: { x: M, y }, end: { x: M + 230, y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.3) }); y -= 12;
  text('Assinatura do(a) profissional', { size: 9, color: [0.34, 0.4, 0.37] });
  text(`Gerado em ${d.generatedAt}. ${d.includesInternal ? 'Contém notas internas: uso restrito à equipe.' : 'Não inclui notas internas.'}`, { size: 8.5, color: [0.34, 0.4, 0.37] });
  const pages = pdf.getPages();
  pages.forEach((pg, i) => pg.drawText(`Página ${i + 1} de ${pages.length} — documento confidencial`, { x: M, y: 28, size: 8, font, color: rgb(0.4, 0.45, 0.42) }));
  pdf.setTitle(clean(d.title)); pdf.setProducer('Minha Terapia Alimentar'); pdf.setCreationDate(new Date());
  return pdf.save();
}
