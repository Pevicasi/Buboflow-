import { getBrazilDateKey } from './monitoringCapture.ts';
import {
  DEFAULT_SEGMENT,
  dedupeSegmentNames,
  normalizeSegmentName,
  resolveSegmentConfig,
} from './segmentScoping.ts';

export type ParsedAutomationCommand =
  | { type: 'auto_dispatch_on' }
  | { type: 'auto_dispatch_off' }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'preview'; url: string; sourceText: string }
  | { type: 'convert'; url: string; sourceText: string }
  | { type: 'video'; url: string }
  | { type: 'broadcast'; message: string }
  | {
      type: 'schedule';
      url?: string;
      messageText: string;
      scheduledAtIso: string;
      formattedBr: string;
      sourceText: string;
    }
  | { type: 'save_priority'; url: string; sourceText: string }
  | { type: 'dispatch_product'; url: string; sourceText: string }
  | { type: 'invalid'; error: string }
  | { type: 'ignore' };

export const AUTOMATION_REPLY_MARKER = '🤖';

/**
 * Prevents infinite self-reply loops when the WhatsApp account owner sends
 * commands into their own Automation Group (fromMe = true).
 */
export function isBotAutomationReplyText(rawText: string): boolean {
  const t = String(rawText || '').trim();
  if (!t) return true;
  if (
    t.startsWith('🤖') ||
    t.startsWith('✅ ') ||
    t.startsWith('⏸️ ') ||
    t.startsWith('🔗 Link convertido') ||
    t.startsWith('📨 Comunicado enviado') ||
    t.startsWith('📅 Agendado para') ||
    t.startsWith('⭐ Produto salvo') ||
    t.startsWith('📊 Status do') ||
    t.startsWith('🎬 Vídeo') ||
    t.startsWith('⚠️ ') ||
    t.startsWith('❌ ')
  ) {
    return true;
  }
  if (/Compre aqui:\s*https?:\/\//i.test(t) && /Promoção sujeita a alteração/i.test(t)) {
    return true;
  }
  return false;
}

function extractUrls(text: string, extraUrls?: string[]): string[] {
  const fromText = (text.match(/https?:\/\/[^\s<>"')\]}]+/gi) || []).map((u) =>
    u.replace(/[.,;!?]+$/, '')
  );
  const all = [...fromText, ...(Array.isArray(extraUrls) ? extraUrls : [])]
    .map((u) => String(u || '').trim().replace(/[.,;!?]+$/, ''))
    .filter((u) => /^https?:\/\//i.test(u));
  return Array.from(new Set(all));
}

/**
 * Parses a Brazilian schedule time like "19:00", "20/11 19:30", "21/11/2026 09:15"
 * relative to Brazil timezone (America/Sao_Paulo, UTC-3).
 */
export function parseScheduleDateTimeBrazil(
  rawText: string,
  now: Date = new Date()
): { scheduledAtIso: string; formattedBr: string; strippedText: string } | null {
  // Match optional DD/MM(/YYYY)? + HH:MM (or HHhMM)
  const fullMatch = rawText.match(
    /(?:^|\s)(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+)?([01]?\d|2[0-3])[:h]([0-5]\d)(?=\s|$)/i
  );
  if (!fullMatch) return null;

  const [, rawDay, rawMonth, rawYear, rawHour, rawMinute] = fullMatch;
  const hour = Number(rawHour);
  const minute = Number(rawMinute);

  const todayKey = getBrazilDateKey(now); // YYYY-MM-DD in America/Sao_Paulo
  const [curYearStr, curMonthStr, curDayStr] = todayKey.split('-');
  let year = Number(curYearStr);
  let month = Number(curMonthStr);
  let day = Number(curDayStr);

  if (rawDay && rawMonth) {
    day = Number(rawDay);
    month = Number(rawMonth);
    if (rawYear) {
      year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  // America/Sao_Paulo has no DST since 2019 (fixed UTC-03:00)
  let isoWithOffset = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`;
  let targetDate = new Date(isoWithOffset);
  if (Number.isNaN(targetDate.getTime())) return null;

  // If user only specified HH:MM (no date) and it already passed today in BRT, schedule for tomorrow
  if (!rawDay && targetDate.getTime() <= now.getTime() + 30_000) {
    const tomorrow = new Date(targetDate.getTime() + 86_400_000);
    const tomorrowKey = getBrazilDateKey(tomorrow);
    const [ty, tm, td] = tomorrowKey.split('-');
    isoWithOffset = `${ty}-${tm}-${td}T${pad(hour)}:${pad(minute)}:00-03:00`;
    targetDate = new Date(isoWithOffset);
    day = Number(td);
    month = Number(tm);
    year = Number(ty);
  }

  const strippedText = rawText.replace(fullMatch[0], ' ').replace(/\s+/g, ' ').trim();
  const formattedBr = `${pad(day)}/${pad(month)} às ${pad(hour)}:${pad(minute)}`;
  return {
    scheduledAtIso: targetDate.toISOString(),
    formattedBr,
    strippedText,
  };
}

/**
 * Parses any command sent inside the WhatsApp Automation Group or the Panel tester.
 */
export function parseAutomationCommand(
  rawText: string,
  extractedUrls?: string[],
  now: Date = new Date()
): ParsedAutomationCommand {
  const text = String(rawText || '').trim();
  if (!text) return { type: 'ignore' };
  if (isBotAutomationReplyText(text)) return { type: 'ignore' };

  const lower = text.toLowerCase();
  const urls = extractUrls(text, extractedUrls);

  // 1. Toggle Auto-Dispatch ON / OFF
  if (
    /^\/?envio[_\s-]?automatico[_\s-]?on$/i.test(lower) ||
    /^\/?(?:ativar|ligar)[_\s-]?envio(?:[_\s-]?automatico)?$/i.test(lower)
  ) {
    return { type: 'auto_dispatch_on' };
  }
  if (
    /^\/?envio[_\s-]?automatico[_\s-]?off$/i.test(lower) ||
    /^\/?(?:desativar|pausar|desligar)[_\s-]?envio(?:[_\s-]?automatico)?$/i.test(lower)
  ) {
    return { type: 'auto_dispatch_off' };
  }

  // 2. Status / Help
  if (/^\/?status$/i.test(lower)) {
    return { type: 'status' };
  }
  if (/^\/?(?:ajuda|comandos|help)$/i.test(lower)) {
    return { type: 'help' };
  }

  // 3. preview: <link>
  if (/^\/?preview(?::|\s)/i.test(text)) {
    const body = text.replace(/^\/?preview:?\s*/i, '').trim();
    const url = extractUrls(body, extractedUrls)[0];
    if (!url) {
      return {
        type: 'invalid',
        error: 'Informe um link após preview:. Exemplo: preview: https://meli.la/...',
      };
    }
    return { type: 'preview', url, sourceText: body };
  }

  // 4. converter: <link>
  if (/^\/?converter(?::|\s)/i.test(text)) {
    const body = text.replace(/^\/?converter:?\s*/i, '').trim();
    const url = extractUrls(body, extractedUrls)[0];
    if (!url) {
      return {
        type: 'invalid',
        error: 'Informe um link após converter:. Exemplo: converter: https://shopee.com.br/...',
      };
    }
    return { type: 'convert', url, sourceText: body };
  }

  // 5. video: <link>
  if (/^\/?v[ií]deo(?::|\s)/i.test(text)) {
    const body = text.replace(/^\/?v[ií]deo:?\s*/i, '').trim();
    const url = extractUrls(body, extractedUrls)[0];
    if (!url) {
      return {
        type: 'invalid',
        error: 'Informe um link de vídeo após video:. Exemplo: video: https://sv.shopee.com.br/...',
      };
    }
    return { type: 'video', url };
  }

  // 6. salvar_prioridade: <link>
  if (/^\/?(?:salvar[_\s-]?prioridade|prioridade)(?::|\s)/i.test(text)) {
    const body = text.replace(/^\/?(?:salvar[_\s-]?prioridade|prioridade):?\s*/i, '').trim();
    const url = extractUrls(body, extractedUrls)[0];
    if (!url) {
      return {
        type: 'invalid',
        error: 'Informe o link do produto após salvar_prioridade:.',
      };
    }
    return { type: 'save_priority', url, sourceText: body };
  }

  // 7. agendar: <link ou mensagem> <HH:MM>
  if (/^\/?agendar(?::|\s)/i.test(text)) {
    const body = text.replace(/^\/?agendar:?\s*/i, '').trim();
    const parsedTime = parseScheduleDateTimeBrazil(body, now);
    if (!parsedTime) {
      return {
        type: 'invalid',
        error:
          'Informe o horário no formato HH:MM (ex: agendar: https://... 19:00 ou agendar: Aviso 21/11 10:30).',
      };
    }
    const url = extractUrls(parsedTime.strippedText, extractedUrls)[0];
    const messageText = parsedTime.strippedText;
    if (!url && !messageText) {
      return {
        type: 'invalid',
        error: 'Informe um link de produto ou texto para agendar junto com o horário.',
      };
    }
    return {
      type: 'schedule',
      url,
      messageText,
      scheduledAtIso: parsedTime.scheduledAtIso,
      formattedBr: parsedTime.formattedBr,
      sourceText: body,
    };
  }

  // 8. envio: <mensagem>
  if (/^\/?envio:/i.test(text)) {
    const message = text.replace(/^\/?envio:\s*/i, '').trim();
    if (!message) {
      return {
        type: 'invalid',
        error: 'Digite a mensagem após envio:. Exemplo: envio: Oferta relâmpago liberada!',
      };
    }
    return { type: 'broadcast', message };
  }

  // 9. Direct product link / promo post -> dispatch immediately
  if (urls.length > 0) {
    return {
      type: 'dispatch_product',
      url: urls[0],
      sourceText: text,
    };
  }

  return { type: 'ignore' };
}

function normalizeJidSimple(raw: unknown): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) return s;
  return s;
}

/**
 * Resolves the WhatsApp remoteJid for a configured automationGroupId
 * (which may be a MonitoringGroup.id, DispatchGroup.id, or raw remoteJid).
 */
export function resolveAutomationGroupJidFromId(
  automationGroupId: string | undefined,
  state: Record<string, any> | null | undefined
): string {
  const cleanId = String(automationGroupId || '').trim();
  if (!cleanId) return '';
  if (cleanId.includes('@g.us')) {
    return normalizeJidSimple(cleanId);
  }
  const monList = Array.isArray(state?.monitoringGroups) ? state.monitoringGroups : [];
  const monMatch = monList.find((g: any) => g?.id === cleanId);
  if (monMatch?.remoteJid) {
    return normalizeJidSimple(monMatch.remoteJid);
  }
  const dispList = Array.isArray(state?.dispatchGroups) ? state.dispatchGroups : [];
  const dispMatch = dispList.find((g: any) => g?.id === cleanId);
  if (dispMatch?.remoteJid) {
    return normalizeJidSimple(dispMatch.remoteJid);
  }
  // Fallback for canonical ID format: mon-wa-120363430908374507gus -> 120363430908374507@g.us
  const syntheticMatch = cleanId.match(/^(?:mon|grp)-wa-(\d+)gus$/i);
  if (syntheticMatch) {
    return `${syntheticMatch[1]}@g.us`;
  }
  return '';
}

/**
 * Returns all segment names that have configured the incoming WhatsApp group JID
 * as their Remote Control Automation Group.
 */
export function resolveAutomationSegmentsForGroupJid(
  groupJid: string,
  state: Record<string, any> | null | undefined,
  fallbackRules: any = { enabled: true, avoidDuplicateHours: 12, restrictedWords: [], allowedWords: [], automationGroupId: '' }
): string[] {
  const norm = normalizeJidSimple(groupJid);
  if (!norm || !state) return [];

  const allSegments = dedupeSegmentNames([
    DEFAULT_SEGMENT,
    ...(Array.isArray(state.segments) ? state.segments : []),
    ...Object.keys(state.monitoringRulesBySegment || {}),
  ]);

  const matched: string[] = [];
  for (const seg of allSegments) {
    const segRules = resolveSegmentConfig(
      state.monitoringRulesBySegment,
      state.monitoringRules || fallbackRules,
      seg,
      () => ({ ...fallbackRules })
    );
    const configuredJid = resolveAutomationGroupJidFromId(segRules?.automationGroupId, state);
    if (configuredJid && configuredJid === norm) {
      matched.push(normalizeSegmentName(seg));
    }
  }
  return dedupeSegmentNames(matched);
}

/**
 * Builds the WhatsApp group subject in the format "<SEGMENTO> - GRUPO DE AUTOMAÇÃO",
 * respecting WhatsApp's 100-character group subject limit.
 */
export function buildAutomationGroupName(segment?: string): string {
  const cleanSeg = normalizeSegmentName(segment);
  const suffix = ' - GRUPO DE AUTOMAÇÃO';
  const maxSegLen = Math.max(1, 100 - suffix.length);
  const clippedSeg = cleanSeg.length > maxSegLen ? cleanSeg.slice(0, maxSegLen).trim() : cleanSeg;
  return `${clippedSeg}${suffix}`;
}

/**
 * Builds the explanatory WhatsApp group description for a segment's Automation Group.
 */
export function buildAutomationGroupDescription(segment?: string): string {
  const cleanSeg = normalizeSegmentName(segment);
  return [
    `Grupo privado de Automação (Controle Remoto) do segmento "${cleanSeg}".`,
    '',
    `Use este grupo para controlar e disparar ofertas do segmento "${cleanSeg}" diretamente pelo WhatsApp:`,
    '• Link direto → dispara a oferta para os grupos ativos',
    '• preview: <link> → gera prévia com foto só neste grupo',
    '• converter: <link> → converte para seu link de afiliado',
    '• video: <link> → extrai/limpa vídeo de oferta',
    '• salvar_prioridade: <link> → salva no topo da fila',
    '• agendar: <link ou texto> HH:MM → agenda disparo (Brasília)',
    '• envio: <mensagem> → envia comunicado aos grupos ativos',
    '• envio_automatico_on / envio_automatico_off → liga ou pausa o envio automático',
    '• status / ajuda → resumo e lista de comandos',
  ].join('\n');
}

