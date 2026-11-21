export interface ComparableOfferLike {
  title: string;
  platform: string;
  discountPrice: number;
  originalPrice?: number;
  discountPercent?: number;
  originalUrl?: string;
  affiliateUrl?: string;
  imageUrl?: string;
  customImageUrl?: string;
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'por', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'e', 'ou', 'a', 'o', 'as', 'os', 'que', 'sem', 'ate', 'via', 'mais',
  'oferta', 'promocao', 'promo', 'desconto', 'cupom', 'frete', 'gratis', 'envio',
  'imediato', 'original', 'novo', 'nova', 'lancamento', 'oficial', 'brasil', 'nf',
  'nota', 'fiscal', 'garantia', 'cor', 'preto', 'branco', 'azul', 'rosa', 'cinza',
  'prata', 'dourado', 'vermelho', 'verde', 'amarelo', 'bege', 'marrom',
]);

const ACCESSORY_KEYWORDS = new Set([
  'capa', 'capinha', 'pelicula', 'peliculas', 'case', 'cabo', 'carregador', 'fonte',
  'adaptador', 'suporte', 'controle', 'bateria', 'peca', 'pecas', 'reposicao',
  'refil', 'escova', 'borracha', 'tampa', 'visor', 'tela', 'display', 'pulseira',
  'correia', 'manual', 'adesivo', 'protetor', 'kit', 'acessorio', 'acessorios',
]);

function normalizeText(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSignificantTokens(title: string): string[] {
  const norm = normalizeText(title);
  if (!norm) return [];
  const raw = norm.split(' ').filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t) && t.length <= 2) continue; // ignore stray small numbers like "10"
    if (!seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  return tokens;
}

/**
 * Extracts capacity/voltage/size spec tokens (e.g. "128gb", "256gb", "110v", "220v", "55", "5l")
 * so the comparator never swaps a 256GB phone for a 128GB phone or 220V for 110V.
 */
export function extractSpecTokens(title: string): string[] {
  const norm = normalizeText(title);
  const matches = norm.match(/\b\d+(?:gb|tb|mb|mah|w|v|l|ml|kg|g|cm|mm|pol|hz|btus?)\b/g) || [];
  return Array.from(new Set(matches));
}

/**
 * Builds a concise, high-signal marketplace search query from a captured product title.
 */
export function buildProductSearchQuery(title: string): string {
  const cleaned = String(title || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/R\$\s*[\d.,]+/gi, ' ');
  const tokens = extractSignificantTokens(cleaned);
  return tokens.slice(0, 6).join(' ').trim();
}

/**
 * Computes how likely `candidateTitle` refers to the exact same product as `originalTitle`.
 * Rejects accessory mismatches (e.g. phone -> phone case) and conflicting spec tokens (128GB vs 256GB).
 */
export function computeProductMatchScore(originalTitle: string, candidateTitle: string): number {
  const origTokens = extractSignificantTokens(originalTitle);
  const candTokens = extractSignificantTokens(candidateTitle);
  if (origTokens.length === 0 || candTokens.length === 0) return 0;

  const origSet = new Set(origTokens);
  const candSet = new Set(candTokens);

  // Guard 1: reject candidate that introduces an accessory word absent from the original title
  for (const w of ACCESSORY_KEYWORDS) {
    if (candSet.has(w) && !origSet.has(w)) {
      return 0;
    }
  }

  // Guard 2: reject conflicting storage/voltage/capacity specs
  const origSpecs = extractSpecTokens(originalTitle);
  const candSpecs = extractSpecTokens(candidateTitle);
  if (origSpecs.length > 0 && candSpecs.length > 0) {
    const unitOf = (spec: string) => spec.replace(/^\d+/, '');
    for (const os of origSpecs) {
      const unit = unitOf(os);
      const sameUnitInCand = candSpecs.filter((cs) => unitOf(cs) === unit);
      if (sameUnitInCand.length > 0 && !sameUnitInCand.includes(os)) {
        return 0;
      }
    }
  }

  // Guard 3: require matching alphanumeric model codes (e.g. "a55", "s24", "520bt", "xr10")
  const modelCodeRegex = /^(?:[a-z]+\d+[a-z0-9]*|\d+[a-z]+[a-z0-9]*)$/;
  const origModelCodes = origTokens.filter(
    (t) => modelCodeRegex.test(t) && !/^\d+(?:gb|tb|mb|mah|w|v|l|ml|kg|g|cm|mm|pol|hz)$/.test(t)
  );
  if (origModelCodes.length > 0) {
    const matchedModels = origModelCodes.filter((code) => candSet.has(code));
    if (matchedModels.length === 0) {
      return 0;
    }
  }

  // Weighted overlap (favor matching original's core tokens)
  let shared = 0;
  for (const t of origSet) {
    if (candSet.has(t)) shared += 1;
  }
  const recall = shared / Math.min(origSet.size, 6);
  const jaccard = shared / (origSet.size + candSet.size - shared);
  return Number((recall * 0.65 + jaccard * 0.35).toFixed(3));
}

export interface CheaperOfferSelection<T extends ComparableOfferLike> {
  winner: T;
  savingsAmount: number;
  savingsPercent: number;
  matchScore: number;
}

/**
 * Selects the cheapest verified matching offer among candidates.
 * Protects against false positives (accessories/parts priced < 45% of original, mismatched specs/models).
 */
export function selectBestCheaperOffer<T extends ComparableOfferLike>(
  original: ComparableOfferLike,
  candidates: T[],
  options?: {
    minSavingsPercent?: number;
    minMatchScore?: number;
  }
): CheaperOfferSelection<T> | null {
  const origPrice = Number(original.discountPrice) || 0;
  if (origPrice <= 0 || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const minSavingsPct = Math.max(1, Math.min(80, Number(options?.minSavingsPercent ?? 5) || 5));
  const minMatchScore = options?.minMatchScore ?? 0.55;
  const maxAllowedPrice = origPrice * (1 - minSavingsPct / 100);
  // Prices below 45% of the captured item are almost always accessories, empty boxes, or replacement parts
  const minPlausiblePrice = origPrice * 0.45;

  const origCleanUrl = String(original.originalUrl || '').split('?')[0].toLowerCase();

  let best: CheaperOfferSelection<T> | null = null;

  for (const cand of candidates) {
    const candPrice = Number(cand.discountPrice) || 0;
    if (candPrice <= 0) continue;
    if (candPrice > maxAllowedPrice) continue;
    if (candPrice < minPlausiblePrice) continue;

    const candCleanUrl = String(cand.originalUrl || cand.affiliateUrl || '').split('?')[0].toLowerCase();
    if (origCleanUrl && candCleanUrl && candCleanUrl === origCleanUrl) continue;

    const score = computeProductMatchScore(original.title, cand.title);
    if (score < minMatchScore) continue;

    const savingsAmount = Number((origPrice - candPrice).toFixed(2));
    const savingsPercent = Math.round(((origPrice - candPrice) / origPrice) * 100);

    if (
      !best ||
      candPrice < best.winner.discountPrice ||
      (candPrice === best.winner.discountPrice && score > best.matchScore)
    ) {
      best = {
        winner: cand,
        savingsAmount,
        savingsPercent,
        matchScore: score,
      };
    }
  }

  return best;
}
