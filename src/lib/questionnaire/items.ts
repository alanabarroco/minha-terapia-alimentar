// Questionário de Observação Alimentar — Minha Terapia Alimentar (versão 1)
// Instrumento PRÓPRIO de acompanhamento. Sem validação diagnóstica. Itens originais.
// DIREÇÃO ÚNICA: todos os itens descrevem uma DIFICULDADE/COMPORTAMENTO a observar.
//   0 = Nunca … 4 = Sempre. Quanto maior a frequência, maior a dificuldade relatada.
// Faixas etárias têm itens distintos: não são equivalentes entre si.

export type AgeBand = 'menor_2' | '2_5' | '6_9' | '10_12' | '13_17' | '18_mais';
export type AreaId = 'A' | 'B' | 'C' | 'D';

export const QUESTIONNAIRE_NAME = 'Questionário de Observação Alimentar Minha Terapia Alimentar';
export const QUESTIONNAIRE_NOTE =
  'Questionário próprio de acompanhamento, sem validação diagnóstica. Não substitui avaliação profissional.';
export const QUESTIONNAIRE_VERSION = 'v1';

export const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: 'menor_2', label: 'Menores de 2 anos' },
  { id: '2_5', label: '2 a 5 anos' },
  { id: '6_9', label: '6 a 9 anos' },
  { id: '10_12', label: '10 a 12 anos' },
  { id: '13_17', label: '13 a 17 anos' },
  { id: '18_mais', label: '18 anos ou mais' },
];

export const AREAS: { id: AreaId; label: string; hint: string }[] = [
  { id: 'A', label: 'Habilidades orais', hint: 'Mastigação, textura e movimentos da boca' },
  { id: 'B', label: 'Respostas sensoriais', hint: 'Cheiro, temperatura, contato e aparência' },
  { id: 'C', label: 'Desenvolvimento e autonomia', hint: 'Utensílios, participação e ajuda' },
  { id: 'D', label: 'Aspectos psicoemocionais e comportamentais', hint: 'Ansiedade, flexibilidade e contexto social' },
];

export const OPTIONS: { value: number | null; label: string }[] = [
  { value: 0, label: 'Nunca' },
  { value: 1, label: 'Raramente' },
  { value: 2, label: 'Às vezes' },
  { value: 3, label: 'Frequentemente' },
  { value: 4, label: 'Sempre' },
  { value: null, label: 'Não se aplica / não foi observado' },
];

export type Item = { id: string; band: AgeBand; area: AreaId; text: string };

const RAW: Record<AgeBand, Record<AreaId, string[]>> = {
  menor_2: {
    A: [
      'Engasga ou ânsia com texturas adequadas para a idade.',
      'Mantém o alimento na boca sem mastigar ou engolir.',
      'Perde muito alimento pela boca durante a refeição.',
      'Tem dificuldade para passar para texturas mais espessas ou sólidas.',
    ],
    B: [
      'Reage com incômodo ao cheiro ou à temperatura do alimento.',
      'Afasta o rosto ou as mãos ao tocar em alimentos úmidos ou pegajosos.',
      'Aceita apenas uma marca ou apresentação de leite ou papinha.',
      'Recusa alimentos novos ao ver a cor ou a aparência.',
    ],
    C: [
      'Precisa de ajuda total para ser alimentado(a), apesar de já ter habilidade para participar.',
      'Não leva alimentos à boca com as mãos, quando já seria esperado para a idade.',
      'Tem dificuldade para sentar com apoio durante a refeição.',
      'Mostra pouco interesse em explorar o alimento com as mãos.',
    ],
    D: [
      'Chora ou se irrita quando o alimento é oferecido.',
      'Só aceita comer com distração (tela, brinquedo ou música).',
      'Demora muito para aceitar mudanças na rotina das refeições.',
      'Tem dificuldade para sinalizar fome ou saciedade de forma clara.',
    ],
  },
  '2_5': {
    A: [
      'Mastiga de forma muito lenta ou cansa durante a refeição.',
      'Acumula alimento nas bochechas ou demora para engolir.',
      'Evita alimentos que exigem mastigação mais firme.',
      'Engasga ou faz ânsia com alimentos de textura mista.',
      'Tem dificuldade para aceitar alimentos duros ou crocantes.',
    ],
    B: [
      'Incomoda-se com o cheiro de alimentos servidos à mesa.',
      'Recusa alimentos que se tocam ou se misturam no prato.',
      'Recusa alimentos quentes ou frios demais, mesmo em temperatura segura.',
      'Tem preferência rígida por marca ou embalagem específica.',
      'Evita sujar as mãos ou o rosto durante a refeição.',
    ],
    C: [
      'Precisa que um adulto coloque o alimento na boca.',
      'Tem dificuldade para usar colher ou garfo, para a idade.',
      'Não participa da organização da refeição (por exemplo, ajudar a servir).',
      'Comunica com dificuldade o que quer ou não quer comer.',
    ],
    D: [
      'Faz birra ou reage com muita intensidade diante de alimentos novos.',
      'Demonstra medo ou tensão antes da refeição.',
      'Tem dificuldade em aceitar mudanças no prato ou na rotina.',
      'Recusa-se a comer em casa de outras pessoas ou em festas.',
    ],
  },
  '6_9': {
    A: [
      'Cansa ou desiste de comer por esforço de mastigação.',
      'Evita carnes ou alimentos fibrosos por dificuldade para mastigar.',
      'Engole alimentos sem mastigar o suficiente.',
      'Tem dificuldade para misturar texturas na boca.',
    ],
    B: [
      'Reclama do cheiro ou do sabor de alimentos que outras pessoas aceitam.',
      'Recusa alimentos pela textura (por exemplo, pedaços, grumos ou pele).',
      'Percebe diferenças mínimas de marca ou preparo e recusa o alimento.',
      'Evita alimentos pela temperatura.',
    ],
    C: [
      'Depende de ajuda para cortar ou servir os alimentos.',
      'Tem dificuldade para usar talheres com autonomia.',
      'Não escolhe ou não participa da escolha do que vai comer.',
      'Tem dificuldade para comer no mesmo ritmo do grupo (escola, família).',
    ],
    D: [
      'Sente ansiedade antes de refeições com alimentos desconhecidos.',
      'Fica tenso(a) ou irritado(a) quando o cardápio muda.',
      'Evita comer na escola ou em eventos sociais.',
      'Fala de si ou dos alimentos com vergonha, medo ou nojo intensos.',
    ],
  },
  '10_12': {
    A: [
      'Evita alimentos que exigem mastigação trabalhosa.',
      'Tem desconforto ao engolir certos alimentos.',
      'Come muito rápido ou muito devagar em comparação ao grupo.',
      'Mantém alimentos na boca por muito tempo antes de engolir.',
    ],
    B: [
      'Recusa alimentos pelo cheiro, mesmo sem experimentar.',
      'Recusa alimentos pela aparência, cor ou textura.',
      'Exige marca, embalagem ou forma de preparo específicas.',
      'Evita alimentos pela temperatura ou pelo contato com as mãos.',
    ],
    C: [
      'Depende de adultos para decidir o que comer.',
      'Tem dificuldade para preparar um lanche simples sozinho(a).',
      'Evita participar de refeições em grupo.',
      'Tem dificuldade em dizer o que sente quando algo na refeição o(a) incomoda.',
    ],
    D: [
      'Sente preocupação antecipada com refeições fora de casa.',
      'Reage com irritação ou choro quando é pressionado(a) a experimentar.',
      'Mostra preocupação intensa com o corpo, o peso ou a forma ao comer.',
      'Evita convites por causa de refeições.',
    ],
  },
  '13_17': {
    A: [
      'Evita alimentos por dificuldade ou desconforto ao mastigar.',
      'Tem desconforto ao engolir certos alimentos ou líquidos.',
      'Come muito rápido sem perceber a mastigação.',
      'Relata cansaço ou desconforto na boca ao comer.',
    ],
    B: [
      'Evita alimentos pelo cheiro, textura ou aparência.',
      'Só come marcas ou preparações específicas.',
      'Evita ambientes de refeição com cheiros ou ruídos fortes.',
      'Evita alimentos misturados ou com texturas variadas.',
    ],
    C: [
      'Tem dificuldade para planejar ou organizar as próprias refeições.',
      'Tem dificuldade para preparar alimentos com segurança e autonomia.',
      'Evita comer na frente de outras pessoas.',
      'Tem dificuldade para comunicar suas necessidades alimentares a outras pessoas.',
    ],
    D: [
      'Sente ansiedade intensa antes ou durante as refeições.',
      'Evita atividades sociais que envolvem comida.',
      'Mostra insatisfação ou pensamentos negativos intensos sobre o corpo ao se alimentar.',
      'Tem dificuldade para lidar com mudanças nos hábitos alimentares da casa.',
      'Relata culpa, vergonha ou medo depois de comer.',
    ],
  },
  '18_mais': {
    A: [
      'Evita alimentos por dificuldade ou desconforto ao mastigar.',
      'Tem desconforto ao engolir certos alimentos ou líquidos.',
      'Come muito rápido, sem perceber a mastigação.',
      'Relata cansaço ou desconforto na boca ao comer.',
    ],
    B: [
      'Evita alimentos pelo cheiro, textura ou aparência.',
      'Só come marcas ou preparações específicas.',
      'Evita locais de refeição por cheiros, ruídos ou iluminação.',
      'Evita alimentos misturados ou com texturas variadas.',
    ],
    C: [
      'Tem dificuldade para planejar compras e refeições.',
      'Tem dificuldade para preparar alimentos com autonomia.',
      'Evita comer na frente de outras pessoas.',
      'Tem dificuldade para comunicar necessidades alimentares em contextos sociais ou de trabalho.',
    ],
    D: [
      'Sente ansiedade intensa antes ou durante as refeições.',
      'Evita encontros ou viagens por causa da alimentação.',
      'Tem pensamentos negativos intensos sobre o corpo ao se alimentar.',
      'Tem dificuldade para lidar com mudanças de rotina ou de cardápio.',
      'Relata culpa, vergonha ou medo depois de comer.',
    ],
  },
};

export const ITEMS: Item[] = (Object.keys(RAW) as AgeBand[]).flatMap((band) =>
  (Object.keys(RAW[band]) as AreaId[]).flatMap((area) =>
    RAW[band][area].map((text, i) => ({ id: `${band}.${area}.${i + 1}`, band, area, text })),
  ),
);

export function itemsFor(band: AgeBand): Item[] {
  return ITEMS.filter((i) => i.band === band);
}
export function itemsForArea(band: AgeBand, area: AreaId): Item[] {
  return ITEMS.filter((i) => i.band === band && i.area === area);
}
export function versionKey(band: AgeBand): string {
  return `${band}-${QUESTIONNAIRE_VERSION}`;
}
