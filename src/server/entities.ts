// Definições (campos, rótulos, opções) das entidades clínicas. Os rótulos aparecem em português.
import type { Field, Group } from './forms';

const o = (...xs: string[]): [string, string][] => xs.map((x) => [x, x]);
export const MEALS = o('Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Mamada / oferta de leite', 'Outro');
export const UNITS = o('g', 'ml', 'colheres de sopa', 'colheres de chá', 'unidades', 'fatias', 'porção', 'copo', 'mamadeira');
export const FOOD_GROUPS = o('Cereais, raízes e tubérculos', 'Feijões e leguminosas', 'Hortaliças', 'Frutas', 'Carnes e ovos', 'Leite e derivados',
  'Oleaginosas', 'Doces e ultraprocessados', 'Bebidas', 'Preparações mistas', 'Outro');
export const LOCATIONS: [string, string][] = [['consultorio', 'Consultório'], ['domicilio', 'Domicílio'], ['escola', 'Escola'], ['online', 'Online'], ['externo', 'Externo']];
export const ACCEPTANCE: [string, string][] = [['aceito', 'Aceito'], ['recusado', 'Recusado'], ['em_exploracao', 'Em exploração']];
export const REFERRALS: [string, string][] = [['fonoaudiologia', 'Fonoaudiologia'], ['terapia_ocupacional', 'Terapia ocupacional'], ['psicologia', 'Psicologia'], ['medicina', 'Medicina']];
export const EXPLORATION_STEPS: [string, string][] = [['tolerou', 'Tolerou a presença'], ['interagiu', 'Interagiu'], ['tocou', 'Tocou'], ['cheirou', 'Cheirou'],
  ['aproximou', 'Aproximou da boca'], ['provou', 'Provou'], ['mastigou', 'Mastigou'], ['ingeriu', 'Ingeriu']];
export const PROGRESS: [string, string][] = [['nao_iniciada', 'Não iniciada'], ['em_andamento', 'Em andamento'], ['alcancada', 'Alcançada'], ['suspensa', 'Suspensa']];
export const TERMS: [string, string][] = [['curto', 'Curto prazo'], ['medio', 'Médio prazo'], ['longo', 'Longo prazo']];
export const STATUS_LABEL: Record<string, string> = { rascunho: 'Rascunho', final: 'Final', finalizada: 'Finalizada', finalizado: 'Finalizado', agendada: 'Agendada', ativo: 'Ativo', encerrado: 'Encerrado', arquivado: 'Arquivado' };
export const locLabel = (v: string | null) => LOCATIONS.find((l) => l[0] === v)?.[1] ?? v ?? '';

const t = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, type: 'text', ...extra });
const ta = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, type: 'textarea', ...extra });

export const PATIENT_GROUPS = (isMaster: boolean): Group[] => [
  { title: 'Identificação', fields: [
    t('full_name', 'Nome completo', { required: true }), t('preferred_name', 'Nome preferido'),
    { name: 'birth_date', label: 'Data de nascimento', type: 'date', required: true },
    { name: 'sex_growth', label: 'Sexo usado na referência de crescimento', type: 'select', options: [['F', 'Feminino'], ['M', 'Masculino']],
      hint: 'Necessário apenas para escores de crescimento.' },
    t('school_name', 'Escola', { hint: 'Deve ser igual ao nome informado ao convidar a escola, se houver.' }), t('class_name', 'Turma'),
  ] },
  { title: 'Saúde', fields: [
    ta('diagnoses', 'Diagnósticos informados e condições relevantes'), ta('allergies', 'Alergias'), ta('restrictions', 'Restrições alimentares'),
    ta('medications', 'Medicamentos'), ta('supplements', 'Suplementos'), ta('professionals', 'Profissionais envolvidos'),
    ta('reason', 'Motivo da procura'), ta('clinical_notes', 'Observações clínicas (internas)'),
  ] },
  ...(isMaster ? [{ title: 'Autorizações (somente master)', fields: [
    { name: 'school_photo_authorized', label: 'Autorizar a escola a anexar fotos de refeições deste paciente', type: 'bool' as const } ] }] : []),
];

export const ANAMNESE: { key: string; label: string; hint?: string }[] = [
  { key: 'historia_alimentar', label: 'História alimentar', hint: 'Como a alimentação evoluiu desde o nascimento.' },
  { key: 'introducao_alimentar', label: 'Introdução alimentar', hint: 'Idade, método, primeiras reações e dificuldades.' },
  { key: 'texturas', label: 'Texturas aceitas e recusadas' },
  { key: 'mastigacao', label: 'Mastigação e deglutição' },
  { key: 'utensilios', label: 'Utensílios usados' },
  { key: 'autonomia', label: 'Autonomia à mesa' },
  { key: 'rotina', label: 'Rotina de refeições e sono' },
  { key: 'ambiente', label: 'Ambiente das refeições', hint: 'Local, companhia, regras, clima emocional.' },
  { key: 'telas', label: 'Uso de telas nas refeições' },
  { key: 'leite_formulas', label: 'Leite e fórmulas', hint: 'Tipo, volume, frequência, recipiente, ofertas noturnas.' },
  { key: 'sintomas', label: 'Sintomas relatados', hint: 'Gastrointestinais, respiratórios, de sono, outros (conforme relato).' },
  { key: 'desenvolvimento', label: 'Desenvolvimento', hint: 'Marcos motores, linguagem, socialização.' },
  { key: 'preocupacoes', label: 'Preocupações da família' },
];

export const DIARY_GROUPS: Group[] = [
  { title: 'Refeição', fields: [
    { name: 'entry_date', label: 'Data', type: 'date', required: true }, { name: 'entry_time', label: 'Horário', type: 'time' },
    { name: 'meal', label: 'Refeição', type: 'select', options: MEALS }, t('location', 'Local', { list: ['Casa', 'Escola', 'Restaurante', 'Casa de familiares', 'Consultório'] }),
    t('companions', 'Companhia'), { name: 'duration_min', label: 'Duração (minutos)', type: 'int' },
  ] },
  { title: 'Oferecido × consumido', hint: 'O que foi SERVIDO e o que foi efetivamente ACEITO/CONSUMIDO são campos separados.', fields: [
    ta('foods_served', 'Alimentos e preparações OFERECIDOS (servidos)'), ta('foods_accepted', 'Alimentos efetivamente ACEITOS / CONSUMIDOS'),
    { name: 'qty_offered', label: 'Quantidade oferecida', type: 'number' }, { name: 'qty_consumed', label: 'Quantidade consumida', type: 'number' },
    { name: 'qty_unit', label: 'Unidade', type: 'select', options: UNITS, hint: 'Obrigatória quando houver quantidade consumida.' },
    t('brand_presentation', 'Marca e apresentação'), t('texture', 'Textura'), t('temperature', 'Temperatura'),
  ] },
  { title: 'Condições da refeição', fields: [
    t('utensils', 'Utensílios'), t('help_needed', 'Ajuda necessária'), t('screen_use', 'Uso de telas'),
    ta('behavior_before', 'Comportamento ANTES'), ta('behavior_during', 'Comportamento DURANTE'), ta('behavior_after', 'Comportamento DEPOIS'),
    ta('hunger_cues', 'Sinais de fome relatados'), ta('satiety_cues', 'Sinais de saciedade relatados'),
    ta('refusal_events', 'Recusa, desconforto ou outros eventos observados'),
  ] },
  { title: 'Leites e fórmulas', hint: 'Preencha quando pertinente.', fields: [
    t('milk_type', 'Tipo de leite', { list: ['Leite materno', 'Fórmula infantil', 'Leite de vaca', 'Bebida vegetal', 'Outro'] }), t('formula_name', 'Fórmula (nome)'),
    { name: 'milk_volume_ml', label: 'Volume por oferta (ml)', type: 'number' }, t('milk_frequency', 'Frequência'),
    t('container', 'Recipiente', { list: ['Mamadeira', 'Copo', 'Copo com bico', 'Seio', 'Canudo', 'Outro'] }), t('night_offers', 'Ofertas noturnas'),
    t('dilution_info', 'Diluição informada (quando pertinente)', { hint: 'Registre o que foi informado; o sistema não calcula diluições.' }),
  ] },
  { title: 'Observações', fields: [ta('observations', 'Observações'), ta('internal_notes', 'Notas internas (nunca compartilhadas)', { internal: true })] },
];

export const SESSION_GROUPS = (staff: [string, string][]): Group[] => [
  { title: 'Sessão', fields: [
    { name: 'session_date', label: 'Data', type: 'date', required: true }, { name: 'start_time', label: 'Horário', type: 'time' },
    { name: 'location', label: 'Local', type: 'select', options: LOCATIONS }, { name: 'professional_id', label: 'Profissional responsável', type: 'select', options: staff },
  ] },
  { title: 'Registro', fields: [
    ta('objectives', 'Objetivos'), ta('foods', 'Alimentos e preparações'), ta('activities', 'Atividades'), ta('skills', 'Habilidades trabalhadas'),
    ta('supports', 'Apoios utilizados'), ta('observed_responses', 'Respostas observadas'), ta('outcomes', 'Resultados'),
    ta('guidance', 'Orientações'), ta('next_steps', 'Próximos passos'),
  ] },
  { title: 'Notas internas', fields: [ta('internal_notes', 'Notas internas (nunca compartilhadas)', { internal: true })] },
];

export const PLAN_FIELDS: Field[] = [
  t('title', 'Título do planejamento', { required: true }),
  { name: 'status', label: 'Situação', type: 'select', options: [['rascunho', 'Rascunho'], ['ativo', 'Ativo'], ['encerrado', 'Encerrado']], required: true },
  { name: 'review_date', label: 'Data de revisão', type: 'date' },
  ta('activities', 'Atividades previstas'), ta('foods', 'Alimentos e preparações'), ta('materials', 'Materiais necessários'),
  ta('family_guidance', 'Orientações à família'), ta('school_guidance', 'Orientações à escola'),
  ta('internal_notes', 'Notas internas (nunca compartilhadas)', { internal: true }),
];
export const GUIDANCE_FIELDS: Field[] = [
  { name: 'audience', label: 'Destinada a', type: 'select', options: [['familia', 'Família'], ['escola', 'Escola']], required: true },
  t('title', 'Título', { required: true }), ta('body', 'Orientação', { required: true }),
  ta('internal_notes', 'Notas internas (nunca compartilhadas)', { internal: true }),
];
export const GROWTH_FIELDS: Field[] = [
  { name: 'measured_on', label: 'Data da aferição', type: 'date', required: true },
  { name: 'weight_kg', label: 'Peso (kg)', type: 'number' }, { name: 'height_cm', label: 'Comprimento/altura (cm)', type: 'number' },
  { name: 'measure_type', label: 'Tipo de medida', type: 'select', options: [['comprimento', 'Comprimento (deitado)'], ['altura', 'Altura (em pé)']] },
  ta('notes', 'Observações'), ta('internal_notes', 'Notas internas (nunca compartilhadas)', { internal: true }),
];
export const REPERTOIRE_FIELDS: Field[] = [
  t('food_name', 'Alimento', { required: true }), { name: 'food_group', label: 'Grupo alimentar', type: 'select', options: FOOD_GROUPS },
  { name: 'acceptance', label: 'Situação', type: 'select', options: ACCEPTANCE, required: true },
  t('textures', 'Texturas'), t('temperatures', 'Temperaturas'), t('brands', 'Marcas'), t('preparations', 'Preparações'),
  ta('context_notes', 'Contextos em que a aceitação muda'), { name: 'last_observed_on', label: 'Última observação', type: 'date' },
  ta('internal_notes', 'Notas internas', { internal: true }),
];
export const SCHOOL_FIELDS: Field[] = [
  { name: 'record_date', label: 'Data', type: 'date', required: true }, { name: 'record_time', label: 'Horário', type: 'time' },
  { name: 'meal', label: 'Refeição', type: 'select', options: MEALS },
  ta('foods_offered', 'O que foi OFERECIDO'), ta('foods_consumed', 'O que foi CONSUMIDO'),
  { name: 'qty_offered', label: 'Quantidade oferecida', type: 'number' }, { name: 'qty_consumed', label: 'Quantidade consumida', type: 'number' },
  { name: 'qty_unit', label: 'Unidade', type: 'select', options: UNITS },
  t('environment', 'Ambiente', { list: ['Refeitório', 'Sala de aula', 'Pátio', 'Outro'] }), t('companions', 'Companhia'),
  { name: 'duration_min', label: 'Duração (minutos)', type: 'int' }, t('help_needed', 'Ajuda necessária'),
  ta('behavior', 'Comportamento'), ta('discomfort', 'Desconfortos observados'), ta('notes', 'Observações'),
];
