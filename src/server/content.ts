// Renderização do conteúdo PUBLICADO (instantâneo imutável). Nunca lê tabelas clínicas.
import { h, Raw } from './html';
import { toBR } from '../lib/age';
import { locLabel, PROGRESS, TERMS } from './entities';
import { fmtNum } from './forms';

const LABELS: Record<string, string> = {
  titulo: 'Título', texto: 'Orientação', data: 'Data', local: 'Local', objetivos: 'Objetivos', alimentos: 'Alimentos e preparações', atividades: 'Atividades',
  habilidades: 'Habilidades trabalhadas', resultados: 'Resultados', orientacoes: 'Orientações', proximos_passos: 'Próximos passos', materiais: 'Materiais',
  orientacoes_familia: 'Orientações à família', orientacoes_escola: 'Orientações à escola', revisao: 'Data de revisão',
};
export function renderContent(content: any, kind: string): Raw {
  if (!content || typeof content !== 'object') return h``;
  if (kind === 'crescimento') {
    const ms: any[] = content.medidas ?? [];
    return ms.length ? h`<div class="tablewrap"><table><thead><tr><th>Data</th><th>Peso (kg)</th><th>Altura/comprimento (cm)</th><th>Observações</th></tr></thead><tbody>
${ms.map((m) => h`<tr><td>${toBR(m.data)}</td><td>${m.peso_kg != null ? fmtNum(m.peso_kg) : '—'}</td><td>${m.altura_cm != null ? fmtNum(m.altura_cm) : '—'}</td><td>${m.observacoes ?? ''}</td></tr>`)}</tbody></table></div>` : h`<p class="muted">Sem medidas.</p>`;
  }
  const pairs = Object.entries(content).filter(([k, v]) => k !== 'metas' && v !== null && v !== '');
  return h`<dl class="kv">${pairs.map(([k, v]) => h`<dt>${LABELS[k] ?? k}</dt><dd>${k === 'data' || k === 'revisao' ? toBR(String(v)) : k === 'local' ? locLabel(String(v)) : String(v)}</dd>`)}</dl>
${Array.isArray(content.metas) && content.metas.length ? h`<h3>Metas</h3><ul>${content.metas.map((g: any) => h`<li><strong>${TERMS.find((t) => t[0] === g.prazo)?.[1] ?? g.prazo}:</strong> ${g.descricao} — <em>${PROGRESS.find((p) => p[0] === g.andamento)?.[1] ?? g.andamento}</em></li>`)}</ul>` : ''}`;
}
export const KIND_LABEL: Record<string, string> = { orientacao: 'Orientação', evolucao: 'Evolução', planejamento: 'Planejamento', crescimento: 'Crescimento', documento: 'Documento' };
