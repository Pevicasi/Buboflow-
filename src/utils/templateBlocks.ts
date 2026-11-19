import { TemplateCondition } from '../types';

export interface TemplateVariableMeta {
  token: string;
  label: string;
  chipClass: string;
  buttonClass: string;
}

export const TEMPLATE_VARIABLES: TemplateVariableMeta[] = [
  {
    token: '{{nome}}',
    label: 'Nome do Produto',
    chipClass:
      'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
    buttonClass:
      'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
  },
  {
    token: '{{preco_original}}',
    label: 'Preço Original',
    chipClass:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    buttonClass:
      'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  },
  {
    token: '{{preco_desconto}}',
    label: 'Preço com Desconto',
    chipClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    buttonClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
  {
    token: '{{desconto_pct}}',
    label: 'Percentual de Desconto',
    chipClass:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    buttonClass:
      'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  },
  {
    token: '{{link}}',
    label: 'Link do Produto',
    chipClass:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    buttonClass:
      'bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  },
  {
    token: '{{cupom}}',
    label: 'Cupom por IA',
    chipClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    buttonClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
  {
    token: '{{info_extra}}',
    label: 'Informação adicional',
    chipClass:
      'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800',
    buttonClass:
      'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
  },
  {
    token: '{{cta_ia}}',
    label: 'CTA por IA',
    chipClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    buttonClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  },
];

const EXTRA_TOKEN_META: Record<string, TemplateVariableMeta> = {
  '{{link_app}}': {
    token: '{{link_app}}',
    label: 'Link App',
    chipClass:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    buttonClass:
      'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  },
};

export function getTemplateVariableMeta(token: string): TemplateVariableMeta | undefined {
  return (
    TEMPLATE_VARIABLES.find((v) => v.token === token) ||
    EXTRA_TOKEN_META[token]
  );
}

export type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'var'; token: string }
  | { type: 'dynamic'; rawToken: string; options: string[] };

const INLINE_TOKEN_REGEX = /(\{\{(?:nome|cta_ia|preco_original|preco_desconto|desconto_pct|link|link_app|cupom|info_extra)\}\}|\{\{dinamico:[^}]+\}\})/g;

export const DEFAULT_DYNAMIC_OPTIONS = [
  'Corre antes que acabe!',
  'Oferta imperdível de hoje!',
  'Preço baixou agora!',
];

export function buildDynamicToken(options: string[]): string {
  const cleaned = options
    .map((o) => o.replace(/[|}]/g, '').trim())
    .filter(Boolean);
  const finalList = cleaned.length > 0 ? cleaned : DEFAULT_DYNAMIC_OPTIONS;
  return `{{dinamico:${finalList.join('|')}}}`;
}

export function parseInlineSegments(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;

  INLINE_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: line.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('{{dinamico:') && raw.endsWith('}}')) {
      const inner = raw.slice('{{dinamico:'.length, -2);
      const options = inner
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      segments.push({ type: 'dynamic', rawToken: raw, options });
    } else {
      segments.push({ type: 'var', token: raw });
    }
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < line.length) {
    segments.push({ type: 'text', value: line.slice(lastIndex) });
  }

  // Always ensure alternating text slots around chips so users can type before/between/after any chip
  const normalized: InlineSegment[] = [];
  if (segments.length === 0) {
    return [{ type: 'text', value: '' }];
  }
  for (const seg of segments) {
    if (seg.type !== 'text') {
      if (normalized.length === 0 || normalized[normalized.length - 1].type !== 'text') {
        normalized.push({ type: 'text', value: '' });
      }
      normalized.push(seg);
    } else {
      if (normalized.length > 0 && normalized[normalized.length - 1].type === 'text') {
        const prev = normalized[normalized.length - 1] as { type: 'text'; value: string };
        prev.value += seg.value;
      } else {
        normalized.push(seg);
      }
    }
  }
  if (normalized[normalized.length - 1].type !== 'text') {
    normalized.push({ type: 'text', value: '' });
  }

  return normalized;
}

export function serializeInlineSegments(segments: InlineSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.value;
      if (seg.type === 'var') return seg.token;
      return buildDynamicToken(seg.options);
    })
    .join('');
}

export const COND_MARKER_REGEX = /\[\[cond:([a-zA-Z0-9_-]+)\]\]/;

export function hasInlineConditionMarkers(body: string): boolean {
  return COND_MARKER_REGEX.test(body);
}

export type TemplateDocNode =
  | { type: 'line'; id: string; text: string }
  | { type: 'condition'; id: string; condId: string; prefix: string; suffix: string };

let nodeCounter = 1;
export function nextDocNodeId(prefix = 'node'): string {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter}`;
}

export function parseTemplateDocument(
  body: string,
  conditions: TemplateCondition[]
): { nodes: TemplateDocNode[]; conditions: TemplateCondition[] } {
  const normalizedBody = (body || '').replace(/\r\n/g, '\n');
  const condList = Array.isArray(conditions) ? conditions.map((c) => ({ ...c })) : [];
  const condById = new Map(condList.map((c) => [c.id, c]));

  if (hasInlineConditionMarkers(normalizedBody)) {
    const rawLines = normalizedBody.split('\n');
    const nodes: TemplateDocNode[] = [];
    const usedIds = new Set<string>();

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      const match = rawLine.match(COND_MARKER_REGEX);
      if (match && condById.has(match[1])) {
        const condId = match[1];
        const markerIdx = match.index ?? 0;
        const prefix = rawLine.slice(0, markerIdx);
        const suffix = rawLine.slice(markerIdx + match[0].length);
        usedIds.add(condId);
        nodes.push({
          type: 'condition',
          id: `doc-cond-${condId}-${i}`,
          condId,
          prefix,
          suffix,
        });
      } else {
        nodes.push({
          type: 'line',
          id: `doc-line-${i}`,
          text: rawLine,
        });
      }
    }

    // Append any non-spacer conditions that weren't referenced yet
    for (const cond of condList) {
      if (cond.variable === 'espaco' || usedIds.has(cond.id)) continue;
      nodes.push({
        type: 'condition',
        id: `doc-cond-orphan-${cond.id}`,
        condId: cond.id,
        prefix: '',
        suffix: '',
      });
      usedIds.add(cond.id);
    }

    const filteredConditions = condList.filter(
      (c) => c.variable !== 'espaco' && usedIds.has(c.id)
    );
    return {
      nodes: nodes.length > 0 ? nodes : [{ type: 'line', id: 'doc-line-0', text: '' }],
      conditions: filteredConditions,
    };
  }

  // Legacy migration: convert top conditions + spacer blocks + body into unified inline nodes
  const nodes: TemplateDocNode[] = [];
  const activeConditions: TemplateCondition[] = [];

  for (let i = 0; i < condList.length; i++) {
    const cond = condList[i];
    if (cond.variable === 'espaco') {
      nodes.push({ type: 'line', id: `doc-legacy-space-${i}`, text: '' });
      continue;
    }
    activeConditions.push(cond);
    nodes.push({
      type: 'condition',
      id: `doc-legacy-cond-${cond.id}`,
      condId: cond.id,
      prefix: '',
      suffix: '',
    });
  }

  const bodyLines = normalizedBody.split('\n');
  bodyLines.forEach((line, idx) => {
    nodes.push({
      type: 'line',
      id: `doc-legacy-line-${idx}`,
      text: line,
    });
  });

  return {
    nodes: nodes.length > 0 ? nodes : [{ type: 'line', id: 'doc-line-0', text: '' }],
    conditions: activeConditions,
  };
}

export function serializeTemplateDocument(
  nodes: TemplateDocNode[],
  conditions: TemplateCondition[]
): { body: string; conditions: TemplateCondition[] } {
  const condById = new Map(conditions.map((c) => [c.id, c]));
  const orderedConditions: TemplateCondition[] = [];
  const seenCondIds = new Set<string>();

  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === 'line') {
      lines.push(node.text);
    } else {
      const cond = condById.get(node.condId);
      if (!cond) continue;
      if (!seenCondIds.has(cond.id)) {
        orderedConditions.push(cond);
        seenCondIds.add(cond.id);
      }
      lines.push(`${node.prefix}[[cond:${cond.id}]]${node.suffix}`);
    }
  }

  return {
    body: lines.join('\n'),
    conditions: orderedConditions,
  };
}

export interface ConditionEvalContext {
  styledCta: string;
  hasRealDiscount: boolean;
  discountPercent: number;
  couponCode?: string;
  extraInfo?: string;
}

export function evaluateTemplateCondition(
  cond: TemplateCondition,
  ctx: ConditionEvalContext
): boolean {
  if (cond.variable === 'espaco' || cond.operator === 'sempre') {
    return true;
  }

  if (cond.variable === 'desconto_pct') {
    const pct = ctx.hasRealDiscount ? Math.max(0, Math.round(ctx.discountPercent || 0)) : 0;
    const threshold = Number.isFinite(cond.compareValue) ? Number(cond.compareValue) : 0;
    switch (cond.operator) {
      case 'maior_que':
        return ctx.hasRealDiscount && pct > threshold;
      case 'menor_que':
        return pct < threshold;
      case 'igual_a':
        return pct === threshold;
      case 'nao_existe':
        return !ctx.hasRealDiscount || pct <= 0;
      case 'existe':
      default:
        return ctx.hasRealDiscount && pct > 0;
    }
  }

  let exists = false;
  if (cond.variable === 'cta_ia') {
    exists = Boolean(ctx.styledCta && ctx.styledCta.trim().length > 0);
  } else if (cond.variable === 'cupom') {
    exists = Boolean(ctx.couponCode && ctx.couponCode.trim().length > 0);
  } else if (cond.variable === 'info_extra') {
    exists = Boolean(ctx.extraInfo && ctx.extraInfo.trim().length > 0);
  }

  if (cond.operator === 'nao_existe') {
    return !exists;
  }
  return exists;
}

export function resolveDynamicTokens(text: string, seedText = ''): string {
  return text.replace(/\{\{dinamico:([^}]+)\}\}/g, (_match, inner: string) => {
    const options = inner
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length === 0) return '';
    let hash = 0;
    for (let i = 0; i < seedText.length; i++) {
      hash = (hash * 31 + seedText.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % options.length;
    return options[idx];
  });
}
