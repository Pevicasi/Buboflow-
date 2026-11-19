import { Marketplace } from '../types';

export interface PlatformSubcategory {
  id: string;
  name: string;
  slug?: string;
  searchTerms?: string[];
}

export interface PlatformCategory {
  id: string;
  name: string;
  slug?: string;
  searchTerms?: string[];
  subcategories: PlatformSubcategory[];
}

export const PLATFORM_CYCLE_ORDER: Marketplace[] = [
  'Mercado Livre',
  'Shopee',
  'Amazon',
  'Magalu',
  'AliExpress',
  'Netshoes',
];

export function pickStrictRoundRobinPage<T extends { platform?: string }>(
  bucketsByPlatform: Record<string, T[]>,
  cycleOrder: readonly string[],
  pageSize: number,
  startCycleIndex: number = 0
): {
  pageItems: T[];
  remainingBuckets: Record<string, T[]>;
  nextCycleIndex: number;
} {
  const remainingBuckets: Record<string, T[]> = {};
  for (const [key, list] of Object.entries(bucketsByPlatform)) {
    remainingBuckets[key] = Array.isArray(list) ? [...list] : [];
  }

  // Include any unexpected platform keys at the end of cycleOrder just in case
  const orderedKeys: string[] = [...cycleOrder];
  for (const key of Object.keys(remainingBuckets)) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  const totalKeys = orderedKeys.length;
  if (totalKeys === 0 || pageSize <= 0) {
    return { pageItems: [], remainingBuckets, nextCycleIndex: 0 };
  }

  const pageItems: T[] = [];
  let cursor = ((startCycleIndex % totalKeys) + totalKeys) % totalKeys;

  while (pageItems.length < pageSize) {
    let pickedInPass = false;
    for (let step = 0; step < totalKeys; step += 1) {
      const idx = (cursor + step) % totalKeys;
      const plat = orderedKeys[idx];
      const bucket = remainingBuckets[plat];
      if (bucket && bucket.length > 0) {
        const nextItem = bucket.shift()!;
        pageItems.push(nextItem);
        cursor = (idx + 1) % totalKeys;
        pickedInPass = true;
        break;
      }
    }
    if (!pickedInPass) break;
  }

  return {
    pageItems,
    remainingBuckets,
    nextCycleIndex: cursor,
  };
}

function normalizePt(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const PT_STOPWORDS = new Set([
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'para',
  'pra',
  'com',
  'sem',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'ou',
  'por',
  'ao',
  'aos',
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'outros',
  'outras',
  'geral',
  'acessorios',
  'artigos',
  'itens',
  'produtos',
  'mais',
  'todas',
  'todos',
  'categorias',
  'subcategorias',
  'aces',
  'air',
]);

function singularizePtWord(word: string): string {
  const w = normalizePt(word);
  if (w.length <= 3) return w;
  if (w === 'tenis' || w === 'oculos' || w === 'lapis' || w === 'onibus') return w;
  if (w.endsWith('oes')) return `${w.slice(0, -3)}ao`;
  if (w.endsWith('aes')) return `${w.slice(0, -3)}ao`;
  if (w.endsWith('eis')) return `${w.slice(0, -3)}el`;
  if (w.endsWith('is') && w.length > 4) return `${w.slice(0, -2)}il`;
  if (w.endsWith('res') || w.endsWith('zes') || w.endsWith('nes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const DOMAIN_KEYWORD_SYNONYMS: Array<{
  pattern: RegExp;
  terms: string[];
  promobitSlugs: string[];
}> = [
  {
    pattern: /celular|smartphone|telefon|iphone|android|capa|pelicula|carregador/,
    terms: ['smartphone', 'celular', 'iphone', 'galaxy', 'carregador', 'fone'],
    promobitSlugs: ['smartphones-tablets-e-telefones'],
  },
  {
    pattern: /informatica|computador|notebook|pc|hardware|monitor|teclado|mouse|impressor|armazenamento|ssd|rede|roteador|tablet/,
    terms: ['notebook', 'monitor', 'ssd', 'teclado', 'mouse', 'tablet', 'roteador'],
    promobitSlugs: ['informatica'],
  },
  {
    pattern: /eletronic|audio|video|tv|televisor|fone|som|caixa de som|soundbar|projetor|alexa|echo|fire tv/,
    terms: ['fone', 'smart tv', 'caixa de som', 'bluetooth', 'soundbar', 'echo'],
    promobitSlugs: ['eletronicos-audio-e-video'],
  },
  {
    pattern: /camera|drone|filmadora|fotograf|gopro|cftv|seguranca/,
    terms: ['camera', 'drone', 'webcam', 'gopro', 'camera seguranca'],
    promobitSlugs: ['cameras-filmadoras-e-drones'],
  },
  {
    pattern: /game|console|playstation|xbox|nintendo|controle|headset|gamer/,
    terms: ['playstation', 'xbox', 'nintendo', 'controle', 'headset', 'gamer', 'jogo'],
    promobitSlugs: ['games'],
  },
  {
    pattern: /eletroportat|air\s?fryer|fritadeira|cafeteira|liquidificador|aspirador|batedeira|ferro de passar/,
    terms: ['air fryer', 'fritadeira', 'cafeteira', 'liquidificador', 'aspirador'],
    promobitSlugs: ['eletroportateis'],
  },
  {
    pattern: /eletrodomest|geladeira|refrigerador|fogao|lavadora|maquina de lavar|micro-?ondas|ar.?condicionado|ventilador|climatiz|purificador/,
    terms: ['geladeira', 'lavadora', 'micro-ondas', 'ar condicionado', 'ventilador', 'fogao'],
    promobitSlugs: ['eletrodomesticos', 'eletroportateis'],
  },
  {
    pattern: /cama.*mesa.*banho|edredom|cobertor|lencol|toalha|travesseiro/,
    terms: ['lencol', 'edredom', 'toalha', 'travesseiro', 'cobertor'],
    promobitSlugs: ['cama-mesa-e-banho'],
  },
  {
    pattern: /movel|moveis|decoracao|colchao|sofa|cadeira|estante|iluminacao|led|tapete|cortina/,
    terms: ['cadeira', 'sofa', 'colchao', 'luminaria', 'mesa', 'tapete'],
    promobitSlugs: ['moveis-e-decoracao'],
  },
  {
    pattern: /cozinha|utilidade|utensilio|panela|talher|garrafa|copo|organizador|limpeza/,
    terms: ['panela', 'garrafa termica', 'copo', 'jogo panelas', 'organizador'],
    promobitSlugs: ['utensilios-domesticos'],
  },
  {
    pattern: /casa.*construcao|construcao|ferramenta|furadeira|parafusadeira|serra|jardim|compressor|encanamento|eletricidade/,
    terms: ['furadeira', 'parafusadeira', 'ferramenta', 'chave', 'serra', 'jardim'],
    promobitSlugs: ['ferramentas-e-jardim', 'casa-e-construcao'],
  },
  {
    pattern: /roupa.*feminin|moda.*feminin|vestido|blusa|saia|lingerie|plus size/,
    terms: ['vestido', 'blusa', 'calca', 'jaqueta', 'feminino'],
    promobitSlugs: ['moda-e-calcados-femininos'],
  },
  {
    pattern: /roupa.*masculin|moda.*masculin|camiseta|camisa|bermuda|moletom|cueca/,
    terms: ['camiseta', 'camisa', 'bermuda', 'moletom', 'jaqueta', 'cueca'],
    promobitSlugs: ['moda-e-calcados-masculinos'],
  },
  {
    pattern: /calcado|sapato|tenis|chuteira|bota|sandalia|chinelo|sapatenis|sapatilha/,
    terms: ['tenis', 'chinelo', 'bota', 'sandalia', 'chuteira', 'sapato'],
    promobitSlugs: ['moda-e-calcados-masculinos', 'moda-e-calcados-femininos'],
  },
  {
    pattern: /bolsa|mochila|mala|bagagem|carteira|pochete|necessaire/,
    terms: ['mochila', 'mala', 'bolsa', 'carteira'],
    promobitSlugs: ['mochilas-e-malas'],
  },
  {
    pattern: /relogio|joia|bijuteria|smartwatch|anel|brinco|colar|oculos|bone|cinto|acessorios de moda/,
    terms: ['relogio', 'smartwatch', 'oculos', 'bone', 'colar'],
    promobitSlugs: ['relogios-e-joias', 'moda-e-calcados-masculinos'],
  },
  {
    pattern: /beleza|perfum|maquiagem|cabelo|skincare|pele|barbear|chapinha|secador|cuidado pessoal/,
    terms: ['perfume', 'shampoo', 'protetor solar', 'hidratante', 'maquiagem', 'secador'],
    promobitSlugs: ['perfumes-e-beleza', 'saude-e-higiene'],
  },
  {
    pattern: /saude|higiene|escova|desodorante|vitamina|massagem|medico|primeiros socorros/,
    terms: ['escova eletrica', 'desodorante', 'vitamina', 'sabonete', 'higiene'],
    promobitSlugs: ['saude-e-higiene', 'perfumes-e-beleza'],
  },
  {
    pattern: /suplemento|whey|creatina|pre-?treino|bcaa|nutricao|academia|musculacao|fitness/,
    terms: ['whey', 'creatina', 'suplemento', 'haltere', 'academia'],
    promobitSlugs: ['suplementos-e-fitness', 'esporte-e-lazer'],
  },
  {
    pattern: /esporte|lazer|futebol|corrida|bicicleta|ciclismo|camping|pesca|basquete|natacao|beach tennis|artes marciais/,
    terms: ['tenis corrida', 'bicicleta', 'camisa time', 'chuteira', 'bola', 'camping'],
    promobitSlugs: ['esporte-e-lazer', 'suplementos-e-fitness'],
  },
  {
    pattern: /bebe|infantil|fralda|carrinho|berco|amamentacao|maternidade|crianca/,
    terms: ['fralda', 'carrinho bebe', 'mamadeira', 'cadeirinha', 'infantil'],
    promobitSlugs: ['bebes-e-criancas'],
  },
  {
    pattern: /brinquedo|hobbie|boneca|lego|tabuleiro|funko|colecion/,
    terms: ['lego', 'brinquedo', 'boneca', 'jogo tabuleiro', 'carrinho'],
    promobitSlugs: ['brinquedos-e-hobbies'],
  },
  {
    pattern: /pet|animal|animais|cao|caes|gato|racao|aquario|ave/,
    terms: ['racao', 'pet', 'cachorro', 'gato', 'areia gato', 'antipulgas'],
    promobitSlugs: ['petshop'],
  },
  {
    pattern: /alimento|bebida|supermercado|mercearia|cerveja|vinho|cafe|chocolate|snack/,
    terms: ['cafe', 'cerveja', 'vinho', 'chocolate', 'azeite', 'sabao'],
    promobitSlugs: ['supermercado-e-delivery', 'bebidas'],
  },
  {
    pattern: /veiculo|automotiv|carro|moto|pneu|capacete|som automotivo|multimidia/,
    terms: ['pneu', 'capacete', 'oleo motor', 'som automotivo', 'carro', 'moto'],
    promobitSlugs: ['pecas-e-acessorios-para-automoveis'],
  },
  {
    pattern: /livro|ebook|ereader|kindle|hq|manga|revista|comic/,
    terms: ['livro', 'kindle', 'hq', 'manga', 'box livros'],
    promobitSlugs: ['livros-ebooks-e-ereaders'],
  },
  {
    pattern: /papelaria|escolar|escritorio|caderno|caneta|mochila escolar|armarinho|arte/,
    terms: ['caderno', 'caneta', 'mochila', 'pilha', 'escritorio'],
    promobitSlugs: ['papelaria-e-material-de-escritorio'],
  },
  {
    pattern: /instrumento|musical|violao|guitarra|teclado musical|microfone|bateria/,
    terms: ['violao', 'microfone', 'teclado musical', 'guitarra', 'fone estudio'],
    promobitSlugs: ['eletronicos-audio-e-video', 'brinquedos-e-hobbies'],
  },
  {
    pattern: /festa|lembrancinha|descartav|embalag/,
    terms: ['balao', 'decoracao festa', 'copo descartavel', 'festa'],
    promobitSlugs: ['utensilios-domesticos'],
  },
  {
    pattern: /agro|industria|comercio/,
    terms: ['ferramenta', 'balanca', 'impressora termica', 'maquininha', 'epi'],
    promobitSlugs: ['ferramentas-e-jardim', 'informatica'],
  },
];

export interface CategorySearchPlan {
  isUnfiltered: boolean;
  strictSubcategory: boolean;
  primaryTerms: string[];
  deepQueryTerms: string[];
  parentTerms: string[];
  matchTokens: string[];
  requiredAnyTokens: string[];
  parentMatchTokens: string[];
  excludedPatterns: RegExp[];
  minRealisticPrice?: number;
  shopeeCatId?: number;
  promobitSlugs: string[];
  promobitSubcategorySlugs: string[];
}

interface StrictProductIntentRule {
  /** Matches subcategory/manual label for a PRIMARY hardware/product (not accessories) */
  labelPattern: RegExp;
  /** Rich, precision-targeted query terms for deep multi-page Shopee/ML/Promobit discovery */
  deepQueryTerms: string[];
  /** Offer title MUST contain at least one of these normalized terms */
  requiredAnyTokens: string[];
  /** Rejects accessories, parts, toys, stationery, or irrelevant products */
  excludedPatterns: RegExp[];
  /** Minimum realistic BRL price when price > 0 to eliminate R$ 10 accessories/toys */
  minRealisticPrice?: number;
  /** Optional Shopee Affiliate global L1 productCatId */
  shopeeCatId?: number;
  /** Real Promobit /subcategories/{slug}/offers slugs for deep paginated discovery */
  promobitSubcategorySlugs?: string[];
}

/**
 * Distinguishes PURE accessory/parts subcategories (where accessories SHOULD appear, e.g.
 * "Acessórios para Celulares", "Acessórios para TV", "Capas e Películas", "Peças para TV",
 * "Malas de Notebook") from PRIMARY product subcategories whose Mercado Livre / Shopee taxonomy
 * name happens to end in "e Acessórios" (e.g. "Smartwatches e Acessórios", "TVs e Acessórios",
 * "Tablets e Acessórios", "Monitores e Acessórios", "Portáteis e Acessórios", "Drones e Acessórios").
 */
export function isPureAccessorySubcategory(label: string): boolean {
  const norm = normalizePt(label);
  if (!norm) return false;
  // Starts with an accessory/parts/bag/peripheral noun
  if (
    /^(?:acessorios?|aces\.?|pecas?|capas?|capinhas?|peliculas?|carregador(?:es)?|cabos?|suportes?|controles?\s*remotos?|bolsas?|malas?|mochilas?|pastas?|componentes?|perifericos?|pilhas?|baterias?|power\s*bank|teclados?|mouses?|armazenamento|conectividade|redes|adaptadores?|hubs?|fontes?|pulseiras?|tripes?|lentes?)\b/i.test(
      norm
    )
  ) {
    return true;
  }
  // Explicitly asks for accessories/parts/bags OF a product (e.g. "Mala de Notebook", "Capas para Celular")
  if (
    /\b(acessorios?\s+(?:para|de)|pecas?\s+(?:para|de)|capas?\s+(?:para|de)|capinhas?|peliculas?|mala\s*de\s*notebook|malas\s*de\s*notebook|mochila\s*(?:para|de)\s*notebook|suporte\s*(?:para|de)\s*tv|controle\s*remoto|componentes\s*de\s*computadores)\b/i.test(
      norm
    )
  ) {
    return true;
  }
  return false;
}

const STRICT_PRODUCT_INTENT_RULES: StrictProductIntentRule[] = [
  {
    labelPattern: /\b(notebook|notebooks|laptop|laptops|macbook|ultrabook|portateis)\b/i,
    deepQueryTerms: [
      'notebook ssd',
      'notebook intel',
      'notebook ryzen',
      'notebook lenovo',
      'notebook samsung',
      'notebook acer',
      'notebook dell',
      'notebook asus',
      'notebook hp',
      'notebook gamer',
      'macbook',
      'notebook positivo',
    ],
    requiredAnyTokens: [
      'notebook',
      'laptop',
      'macbook',
      'chromebook',
      'ultrabook',
      'ideapad',
      'thinkpad',
      'vivobook',
      'zenbook',
      'inspiron',
      'galaxy book',
      'aspire',
      'vaio',
    ],
    excludedPatterns: [
      /\b(capa|capinha|case|sleeve|luva|bolsa|mochila|pasta|maleta)\b/i,
      /\b(suporte|mesa|mesinha|base\s*cooler|cooler|ventoinha|refrigerador)\b/i,
      /\b(carregador|fonte\s*(?:para|de|notebook|carregador)|cabo|bateria\s*(?:para|de|notebook)|adaptador|hub\s*usb|dock)\b/i,
      /\b(adesivo|etiqueta|rotulo|skin|pelicula|protetor|limpa\s*tela)\b/i,
      /\b(caderno|agenda|diario|bloco\s*de\s*notas|caneta|papelaria|folha|fichario)\b/i,
      /\b(teclado\s*(?:para|de|notebook|usb|sem\s*fio)|mouse\s*(?:para|sem\s*fio|gamer)|webcam|headset|fone)\b/i,
      /\b(tela\s*(?:display|lcd|led|reposicao|para)|dobradica|conector|placa\s*mae|memoria\s*ram|ssd\s*nvme|hd\s*externo)\b/i,
      /\b(boneco|mini\s*jesus|pote|tampa|tubete|taca|copo|caneca|brinquedo)\b/i,
    ],
    minRealisticPrice: 550,
    promobitSubcategorySlugs: [
      'notebooks',
      'notebook-gamer',
      'notebook-lenovo',
      'notebook-samsung',
      'notebook-dell',
      'notebook-acer',
      'notebook-asus',
    ],
  },
  {
    labelPattern: /\b(smartphone|smartphones|celular|celulares|iphone|android)\b/i,
    deepQueryTerms: [
      'smartphone',
      'celular',
      'smartphone samsung',
      'smartphone motorola',
      'smartphone xiaomi',
      'iphone',
      'smartphone realme',
      'smartphone poco',
      'smartphone 5g',
      'smartphone 256gb',
      'celular samsung galaxy',
      'celular xiaomi redmi',
    ],
    requiredAnyTokens: [
      'smartphone',
      'celular',
      'iphone',
      'galaxy',
      'redmi',
      'poco',
      'moto g',
      'moto e',
      'edge',
      'realme',
      'xiaomi',
      'infinix',
      'tecno',
      'zenfone',
      'rog phone',
      'pixel',
    ],
    excludedPatterns: [
      /\b(capa|capinha|case|bumper|bolsa|pochete|bra[cç]adeira|impermeavel\s*para\s*celular)\b/i,
      /\b(pelicula|vidro\s*temperado|protetor\s*(?:de\s*tela|de\s*lente|camera))\b/i,
      /\b(carregador|cabo|fonte|adaptador|power\s*bank|powerbank|carregamento|inducao)\b/i,
      /\b(suporte|tripe|bastao|pau\s*de\s*selfie|ring\s*light|gimbal|estabilizador)\b/i,
      /\b(lupa|ampliador|amplificador\s*de\s*tela|projetor|lente\s*3d)\b/i,
      /\b(adesivo|popsocket|pop\s*socket|cordao|alca|chaveiro|pingente|cordinha)\b/i,
      /\b(fone|headset|earbuds|airpods|microfone|caixa\s*de\s*som|buds)\b/i,
      /\b(brinquedo|infantil|musical|educativo|dummy|decorativo|miniatura)\b/i,
      /\b(tela\s*(?:frontal|lcd|touch|display|reposicao)|display\s*lcd|touch\s*screen|conector\s*de\s*carga|gaveta\s*chip|bateria\s*(?:para|de|reposicao)|kit\s*ferramentas)\b/i,
      /\b(smart\s*tag|airtag|rastreador|cortina|cooler\s*(?:para|magnetico|celular)|dedeira|luva\s*gamer|controle\s*bluetooth|gamepad)\b/i,
      /\b(smartwatch|smartband|smart\s*band|relogio|galaxy\s*watch|galaxy\s*fit|apple\s*watch|redmi\s*watch|mi\s*band|amazfit|garmin|haylou|tablet|galaxy\s*tab|ipad|redmi\s*pad)\b/i,
    ],
    minRealisticPrice: 280,
    shopeeCatId: 100013,
    promobitSubcategorySlugs: [
      'celular-samsung',
      'celular-motorola',
      'celular-xiaomi',
      'celular-realme',
      'iphone',
    ],
  },
  {
    labelPattern: /\b(smart\s*tv|smart\s*tvs|televisor|televisores|tvs|tv\s*4k|tv\s*32|tv\s*50)\b/i,
    deepQueryTerms: [
      'smart tv',
      'smart tv 4k',
      'smart tv 50',
      'smart tv 55',
      'smart tv 43',
      'smart tv 32',
      'smart tv samsung',
      'smart tv lg',
      'smart tv tcl',
      'smart tv philips',
      'smart tv philco',
      'smart tv qled',
      'smart tv 65',
    ],
    requiredAnyTokens: [
      'smart tv',
      'televisor',
      'tv led',
      'tv qled',
      'tv oled',
      'tv 4k',
      'tv uhd',
      'tv hd',
      'tv full hd',
      'tv 32',
      'tv 40',
      'tv 42',
      'tv 43',
      'tv 50',
      'tv 55',
      'tv 58',
      'tv 65',
      'tv 70',
      'tv 75',
      'tv 85',
      'nanocell',
      'qled',
      'crystal uhd',
      'roku tv',
      'google tv',
    ],
    excludedPatterns: [
      /\b(suporte|painel|rack|estante|pedestal|pe\s*base|base\s*para\s*tv|mesa)\b/i,
      /\b(controle\s*remoto|controle\s*para\s*tv|teclado\s*para\s*tv|air\s*mouse)\b/i,
      /\b(cabo\s*hdmi|cabo\s*para|antena|conversor|tv\s*box|tvbox|fire\s*tv|chromecast|roku\s*express|mi\s*tv\s*stick|stick\s*4k|receptor)\b/i,
      /\b(fita\s*led|led\s*para\s*tv|barra\s*de\s*led|kit\s*barra|capa|protetor|pelicula|limpa\s*tela)\b/i,
      /\b(placa\s*(?:principal|fonte|t-?con)|fonte\s*para\s*tv|alto\s*falante|soundbar|home\s*theater|projetor|adaptador)\b/i,
    ],
    minRealisticPrice: 500,
    promobitSubcategorySlugs: [
      'tv',
      'tv-50',
      'tv-55',
      'tv-43',
      'tv-32',
      'tv-65',
      'tv-samsung',
      'tv-lg',
      'tv-tcl',
    ],
  },
  {
    labelPattern: /\b(tablet|tablets|ipad)\b/i,
    deepQueryTerms: [
      'tablet',
      'tablet samsung',
      'tablet galaxy tab',
      'tablet xiaomi',
      'tablet lenovo',
      'apple ipad',
      'tablet vaio',
      'tablet 128gb',
      'tablet 64gb',
      'tablet multilaser',
      'tablet positivo',
    ],
    requiredAnyTokens: ['tablet', 'ipad', 'galaxy tab', 'redmi pad', 'mi pad', 'tab a', 'tab s'],
    excludedPatterns: [
      /\b(capa|capinha|case|bolsa|mochila|sleeve|pelicula|vidro\s*temperado)\b/i,
      /\b(caneta|stylus|teclado\s*(?:para|bluetooth)|suporte|tripe|carregador|cabo|adaptador)\b/i,
      /\b(lousa\s*magica|mesa\s*digitalizadora|tela\s*touch|display\s*lcd|bateria\s*para)\b/i,
    ],
    minRealisticPrice: 220,
    promobitSubcategorySlugs: ['tablet'],
  },
  {
    labelPattern: /\b(monitor|monitores)\b/i,
    deepQueryTerms: [
      'monitor',
      'monitor gamer',
      'monitor samsung',
      'monitor lg',
      'monitor 24 polegadas',
      'monitor 27 polegadas',
      'monitor 144hz',
      'monitor aoc',
      'monitor dell',
      'monitor ultrawide',
      'monitor full hd',
    ],
    requiredAnyTokens: ['monitor'],
    excludedPatterns: [
      /\b(suporte|braco\s*articulado|base\s*elevadora|riser|cabo|adaptador|pelicula|filtro|capa|luminaria|light\s*bar|limpa\s*tela)\b/i,
      /\b(pressao|arterial|cardiaco|glicemia|baba\s*eletronica|baby|oximetro|fetal|estacionamento|re)\b/i,
    ],
    minRealisticPrice: 250,
    promobitSubcategorySlugs: ['monitor-gamer', 'monitor'],
  },
  {
    labelPattern: /\b(console|consoles|playstation|ps5|xbox|nintendo\s*switch)\b/i,
    deepQueryTerms: [
      'console ps5',
      'playstation 5',
      'xbox series',
      'nintendo switch',
      'console ps5 slim',
      'console ps4',
      'console portatil',
      'nintendo switch oled',
      'nintendo switch lite',
    ],
    requiredAnyTokens: ['playstation', 'ps5', 'ps4', 'xbox', 'nintendo switch', 'console', 'steam deck', 'rog ally'],
    excludedPatterns: [
      /\b(capa|capinha|case|skin|adesivo|pelicula|bolsa|mochila|suporte|base\s*carregadora|cooler|cabo|fonte|adaptador)\b/i,
      /\b(grip|borracha|analogico|gift\s*card|cartao\s*presente|assinatura|jogo\s*midia|headset|fone)\b/i,
      /\b(controle\s*(?:sem\s*fio|dualsense|xbox|para\s*ps|compat))\b/i,
    ],
    minRealisticPrice: 550,
    promobitSubcategorySlugs: ['console-ps5', 'console-xbox', 'nintendo-switch'],
  },
  {
    labelPattern: /\b(smartwatch|smartwatches|relogio\s*inteligente|aparelhos\s*vestiveis|smartband)\b/i,
    deepQueryTerms: [
      'smartwatch',
      'galaxy watch',
      'apple watch',
      'amazfit',
      'redmi watch',
      'smartwatch xiaomi',
      'smartwatch samsung',
      'smartwatch huawei',
      'garmin',
      'mi band',
      'smartwatch gps',
      'smartwatch haylou',
    ],
    requiredAnyTokens: [
      'smartwatch',
      'smartband',
      'smart band',
      'galaxy watch',
      'galaxy fit',
      'apple watch',
      'redmi watch',
      'amazfit',
      'mi band',
      'huawei watch',
      'huawei band',
      'garmin',
      'haylou',
      'relogio inteligente',
      'watch',
    ],
    excludedPatterns: [
      /\b(pulseira|pelicula|capa|capinha|case|carregador|cabo|suporte|protetor|correa|bracelete|kit\s*pulseira|bateria\s*para)\b/i,
    ],
    minRealisticPrice: 45,
    promobitSubcategorySlugs: [
      'smartwatch-smartband',
      'smartwatch-samsung',
      'smartwatch-apple',
      'smartwatch-xiaomi',
      'smartwatch-huawei',
    ],
  },
  {
    labelPattern: /\b(air\s*fryer|airfryer|fritadeira|fritadeiras)\b/i,
    deepQueryTerms: [
      'air fryer',
      'fritadeira air fryer',
      'air fryer mondial',
      'air fryer philips walita',
      'air fryer arno',
      'air fryer britania',
      'air fryer oster',
      'air fryer oven',
      'air fryer midea',
    ],
    requiredAnyTokens: ['air fryer', 'airfryer', 'fritadeira'],
    excludedPatterns: [
      /\b(forma|papel\s*manteiga|forro|tapete|silicone|cesto\s*avulso|grelha|capa|kit\s*acessorios|pincel|pegador|spray|borrifador|descartavel|protetor)\b/i,
    ],
    minRealisticPrice: 120,
    promobitSubcategorySlugs: ['air-fryer'],
  },
  {
    labelPattern: /\b(geladeira|geladeiras|refrigerador|refrigeradores|refrigeracao|lavadora|lavadoras|lavadores|maquina\s*de\s*lavar|ar-?condicionado|fogao|fogoes|micro-?ondas)\b/i,
    deepQueryTerms: [],
    requiredAnyTokens: [],
    excludedPatterns: [
      /\b(capa|protetor|adesivo|envelopamento|iman|suporte|base\s*com\s*rodinha|mangueira|filtro\s*(?:para|avulso|refil)|controle\s*remoto|defletor|prato\s*giratorio|borracha|gaxeta|peca|kit\s*instalacao|tampa)\b/i,
    ],
    minRealisticPrice: 400,
    promobitSubcategorySlugs: ['geladeira'],
  },
  {
    labelPattern: /\b(cadeira\s*gamer|cadeiras\s*gamer)\b/i,
    deepQueryTerms: [
      'cadeira gamer',
      'cadeira gamer ergonomica',
      'cadeira gamer reclinavel',
      'cadeira gamer pichau',
      'cadeira gamer dt3',
      'cadeira gamer thunderx3',
      'cadeira gamer elementos',
      'cadeira escritorio ergonomica',
    ],
    requiredAnyTokens: ['cadeira'],
    excludedPatterns: [
      /\b(capa|almofada|rodinha|rodizio|pistao|base\s*estrela|braco\s*para|apoio\s*de\s*pe|tapete)\b/i,
    ],
    minRealisticPrice: 220,
  },
  {
    labelPattern: /\b(camera|cameras|drone|drones)\b/i,
    deepQueryTerms: [
      'camera seguranca wifi',
      'drone',
      'drone com camera 4k',
      'drone dji',
      'camera gopro',
      'camera instantanea instax',
      'camera digital canon',
      'camera vigilancia',
      'camera acao 4k',
    ],
    requiredAnyTokens: ['camera', 'drone', 'gopro', 'instax', 'webcam', 'filmadora', 'canon', 'nikon', 'sony alpha', 'dji'],
    excludedPatterns: [
      /\b(tripe|bolsa|mochila|case|capa|pelicula|bateria\s*para|carregador|helice|protetor\s*de\s*helice|cartao\s*(?:de\s*memoria|sd)|alca|suporte|filtro|tampa\s*de\s*lente|ring\s*light|brinquedo)\b/i,
    ],
    minRealisticPrice: 60,
  },
];

function extractCleanTokensFromLabel(label: string): string[] {
  const norm = normalizePt(label);
  if (!norm) return [];
  const rawWords = norm
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PT_STOPWORDS.has(w));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of rawWords) {
    for (const variant of [w, singularizePtWord(w)]) {
      if (variant.length >= 3 && !PT_STOPWORDS.has(variant) && !seen.has(variant)) {
        seen.add(variant);
        out.push(variant);
      }
    }
  }
  return out;
}

function buildSearchTermsFromLabel(label: string): string[] {
  const clean = String(label || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  // Split compound category names like "Celulares e Smartphones" or "Botas, Tênis e Chinelos"
  const segments = clean
    .split(/[,/•|]+|\s+e\s+/i)
    .map((s) =>
      s
        .replace(/^(?:aces\.?|acessórios|artigos|itens|outros)\s+(?:de|para|da|do)\s+/i, '')
        .trim()
    )
    .filter((s) => s.length >= 3 && !/^outr[oa]s?$/i.test(s));

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const trimmed = t.trim();
    const key = normalizePt(trimmed);
    if (key.length >= 3 && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  };

  // Prefer singular concise 1–2 word segments first so Shopee/ML/Promobit APIs match reliably
  for (const seg of segments) {
    const words = seg.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      add(singularizePtWord(words[0]));
      add(seg);
    } else if (words.length === 2) {
      add(seg);
      const sing = words.map((w) => singularizePtWord(w)).join(' ');
      add(sing);
    } else {
      const meaningful = words.filter((w) => !PT_STOPWORDS.has(normalizePt(w)));
      if (meaningful.length >= 1) {
        add(meaningful.slice(0, 2).join(' '));
        add(singularizePtWord(meaningful[0]));
      }
    }
  }

  return out;
}

export function resolveCategorySearchPlan(params: {
  manualQuery?: string;
  category?: string;
  subcategory?: string;
}): CategorySearchPlan {
  const manual = String(params.manualQuery || '').trim();
  const cat =
    params.category && params.category !== 'Todas as Categorias'
      ? String(params.category).trim()
      : '';
  const sub =
    params.subcategory && params.subcategory !== 'Todas as Subcategorias'
      ? String(params.subcategory).trim()
      : '';

  const isDefaultManual =
    !manual ||
    /^(?:ofertas|ofertas do dia|promocoes|promoções|todas as categorias)$/i.test(manual);

  if (isDefaultManual && !cat && !sub) {
    return {
      isUnfiltered: true,
      strictSubcategory: false,
      primaryTerms: [],
      deepQueryTerms: [],
      parentTerms: [],
      matchTokens: [],
      requiredAnyTokens: [],
      parentMatchTokens: [],
      excludedPatterns: [],
      promobitSlugs: [],
      promobitSubcategorySlugs: [],
    };
  }

  const primaryTerms: string[] = [];
  const deepQueryTerms: string[] = [];
  const parentTerms: string[] = [];
  const matchTokens: string[] = [];
  const requiredAnyTokens: string[] = [];
  const parentMatchTokens: string[] = [];
  const excludedPatterns: RegExp[] = [];
  const promobitSlugs: string[] = [];
  const promobitSubcategorySlugs: string[] = [];
  let minRealisticPrice: number | undefined;
  let shopeeCatId: number | undefined;

  const pushUnique = (arr: string[], items: string[]) => {
    const seen = new Set(arr.map((x) => normalizePt(x)));
    for (const item of items) {
      const clean = item.trim();
      const key = normalizePt(clean);
      if (key && !seen.has(key)) {
        seen.add(key);
        arr.push(clean);
      }
    }
  };

  if (!isDefaultManual) {
    pushUnique(primaryTerms, [manual]);
    pushUnique(deepQueryTerms, [manual]);
    pushUnique(matchTokens, extractCleanTokensFromLabel(manual));
  }

  const activeLabel = sub || cat;
  const intentCheckLabel = normalizePt(!isDefaultManual ? `${manual} ${sub}` : activeLabel);
  const isAccessoryIntent = isPureAccessorySubcategory(
    !isDefaultManual ? `${manual} ${sub}` : activeLabel
  );

  // Match strict product intent rules ONLY when the user is NOT explicitly asking for pure accessories
  if (!isAccessoryIntent && intentCheckLabel) {
    for (const rule of STRICT_PRODUCT_INTENT_RULES) {
      if (rule.labelPattern.test(intentCheckLabel)) {
        if (rule.deepQueryTerms.length > 0) {
          pushUnique(deepQueryTerms, rule.deepQueryTerms);
          pushUnique(primaryTerms, rule.deepQueryTerms.slice(0, 4));
        }
        if (rule.requiredAnyTokens.length > 0) {
          pushUnique(requiredAnyTokens, rule.requiredAnyTokens);
          pushUnique(matchTokens, rule.requiredAnyTokens);
        }
        if (rule.promobitSubcategorySlugs && rule.promobitSubcategorySlugs.length > 0) {
          pushUnique(promobitSubcategorySlugs, rule.promobitSubcategorySlugs);
        }
        for (const rx of rule.excludedPatterns) {
          excludedPatterns.push(rx);
        }
        if (rule.minRealisticPrice && (!minRealisticPrice || rule.minRealisticPrice > minRealisticPrice)) {
          minRealisticPrice = rule.minRealisticPrice;
        }
        if (rule.shopeeCatId && !shopeeCatId) {
          shopeeCatId = rule.shopeeCatId;
        }
      }
    }
  }

  if (activeLabel) {
    const builtTerms = buildSearchTermsFromLabel(activeLabel);
    pushUnique(primaryTerms, builtTerms);
    pushUnique(deepQueryTerms, builtTerms);
    pushUnique(matchTokens, extractCleanTokensFromLabel(activeLabel));
    const normActive = normalizePt(activeLabel);
    if (normActive.includes('air fryer') || normActive.includes('airfryer')) {
      pushUnique(primaryTerms, ['air fryer', 'airfryer', 'fritadeira']);
      pushUnique(deepQueryTerms, ['air fryer', 'fritadeira eletrica', 'air fryer mondial', 'air fryer arno']);
      pushUnique(matchTokens, ['air fryer', 'airfryer', 'fritadeira']);
    }
    if (!isAccessoryIntent && (normActive.includes('smartphone') || normActive.includes('celular'))) {
      pushUnique(matchTokens, ['smartphone', 'celular', 'iphone', 'galaxy', 'motorola', 'xiaomi', 'realme', 'redmi', 'poco']);
    }
    if (normActive.includes('capa') || normActive.includes('pelicula')) {
      pushUnique(matchTokens, ['capa', 'capinha', 'case', 'pelicula', 'vidro temperado', 'protetor']);
      pushUnique(deepQueryTerms, ['capinha celular', 'pelicula 3d celular', 'capa silicone iphone', 'capa samsung']);
    }
  }

  if (cat) {
    pushUnique(parentTerms, buildSearchTermsFromLabel(cat));
    pushUnique(parentMatchTokens, extractCleanTokensFromLabel(cat));
  }

  // Enrich with domain synonyms + mapped Promobit category slugs.
  // When a specific subcategory is chosen, keep matchTokens tight to the subcategory
  // and put broader domain terms in parentTerms/parentMatchTokens ONLY for category-level browsing.
  const checkTextCat = normalizePt(`${cat} ${sub} ${manual}`);
  for (const rule of DOMAIN_KEYWORD_SYNONYMS) {
    if (checkTextCat && rule.pattern.test(checkTextCat)) {
      pushUnique(promobitSlugs, rule.promobitSlugs);
      pushUnique(parentTerms, rule.terms);
      pushUnique(parentMatchTokens, rule.terms.flatMap((t) => extractCleanTokensFromLabel(t)));
      if (!sub && !hasManual(manual, isDefaultManual)) {
        pushUnique(primaryTerms, rule.terms);
        pushUnique(deepQueryTerms, rule.terms);
        pushUnique(matchTokens, rule.terms.flatMap((t) => extractCleanTokensFromLabel(t)));
      }
    }
  }

  // Build extra deep query variations for any generic subcategory (e.g. "Vestidos" -> "vestido feminino", "vestido midi", "vestido longo")
  if (deepQueryTerms.length < 4 && primaryTerms.length > 0) {
    const base = primaryTerms[0];
    pushUnique(deepQueryTerms, [
      base,
      `${base} original`,
      `${base} promocao`,
      `${base} oferta`,
      ...primaryTerms.slice(1),
    ]);
  }

  const strictSubcategory = Boolean(sub) || hasManual(manual, isDefaultManual);

  return {
    isUnfiltered: false,
    strictSubcategory,
    primaryTerms: primaryTerms.slice(0, 8),
    deepQueryTerms: deepQueryTerms.slice(0, 14),
    parentTerms: parentTerms.slice(0, 8),
    matchTokens: matchTokens.slice(0, 24),
    requiredAnyTokens: requiredAnyTokens.slice(0, 24),
    parentMatchTokens: parentMatchTokens.slice(0, 20),
    excludedPatterns,
    minRealisticPrice,
    shopeeCatId,
    promobitSlugs: promobitSlugs.slice(0, 3),
    promobitSubcategorySlugs: promobitSubcategorySlugs.slice(0, 10),
  };
}

function hasManual(manual: string, isDefaultManual: boolean): boolean {
  return Boolean(manual) && !isDefaultManual;
}

export function offerMatchesTokens(
  offer: { title?: string; category?: string; extraInfo?: string },
  tokens: string[]
): boolean {
  if (!tokens || tokens.length === 0) return true;
  const haystack = normalizePt(
    `${offer.title || ''} ${offer.category || ''} ${offer.extraInfo || ''}`
  );
  if (!haystack) return false;
  return tokens.some((tok) => {
    const clean = normalizePt(tok);
    return clean.length >= 3 && haystack.includes(clean);
  });
}

/**
 * Strict subcategory relevance + anti-accessory filter applied uniformly across
 * Shopee, Mercado Livre, Amazon, Magalu, AliExpress, and Netshoes.
 */
export function offerMatchesSearchPlan(
  offer: { title?: string; category?: string; extraInfo?: string; discountPrice?: number },
  plan: CategorySearchPlan
): boolean {
  if (!plan || plan.isUnfiltered) return true;

  const titleNorm = normalizePt(offer.title || '');
  const fullHaystack = normalizePt(
    `${offer.title || ''} ${offer.category || ''} ${offer.extraInfo || ''}`
  );
  if (!titleNorm) return false;

  // 1. Reject accessories, parts, stationery, or toys when browsing a primary product subcategory
  if (plan.excludedPatterns.length > 0) {
    for (const rx of plan.excludedPatterns) {
      if (rx.test(titleNorm)) return false;
    }
  }

  // 2. Reject unrealistically cheap accessories/toys (e.g. R$ 12 sticker inside Notebooks or R$ 10 phone stand inside Smartphones)
  if (
    plan.minRealisticPrice &&
    typeof offer.discountPrice === 'number' &&
    offer.discountPrice > 0 &&
    offer.discountPrice < plan.minRealisticPrice
  ) {
    return false;
  }

  // 3. When strict required tokens exist (e.g. Notebooks, Smartphones, Smart TVs), check title directly
  // so categoryLabel injected by our own fetcher never causes a false positive!
  if (plan.requiredAnyTokens.length > 0) {
    const matchedTitle = plan.requiredAnyTokens.some((tok) => {
      const clean = normalizePt(tok);
      return clean.length >= 2 && titleNorm.includes(clean);
    });
    if (!matchedTitle) return false;
    return true;
  }

  // 4. For all other subcategories/queries, match against title (and fallback to full haystack if needed)
  if (plan.matchTokens.length > 0) {
    const matchedTitle = plan.matchTokens.some((tok) => {
      const clean = normalizePt(tok);
      return clean.length >= 3 && titleNorm.includes(clean);
    });
    if (matchedTitle) return true;
    // Only check category/extraInfo when NOT in strict subcategory mode (prevents injected category labels from passing random items)
    if (!plan.strictSubcategory) {
      return plan.matchTokens.some((tok) => {
        const clean = normalizePt(tok);
        return clean.length >= 3 && fullHaystack.includes(clean);
      });
    }
    return false;
  }

  return true;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const NON_ECOMMERCE_ML_CATEGORIES = new Set([
  'imoveis',
  'carros, motos e outros',
  'servicos',
  'ingressos',
  'mais categorias',
]);

export function parseMercadoLivreCategoriesHtml(html: string): PlatformCategory[] {
  if (!html) return [];
  const blocks = html.split(/class="categories__container"/i).slice(1);
  const categories: PlatformCategory[] = [];
  const seenCat = new Set<string>();

  for (const block of blocks) {
    const rawName = block.match(/<h2[^>]*class="categories__title"[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    if (!rawName) continue;
    const name = decodeBasicEntities(rawName.replace(/<[^>]+>/g, ''));
    const normName = normalizePt(name);
    if (!name || seenCat.has(normName) || NON_ECOMMERCE_ML_CATEGORIES.has(normName)) continue;
    seenCat.add(normName);

    const slug = block.match(/href="https?:\/\/[^"]*\/c\/([^"/?#]+)"/i)?.[1] || normName.replace(/\s+/g, '-');
    const subMatches = Array.from(
      block.matchAll(/<h3[^>]*class="categories__subtitle-title"[^>]*>([\s\S]*?)<\/h3>/gi)
    );
    const subs: PlatformSubcategory[] = [];
    const seenSub = new Set<string>();
    for (const sm of subMatches) {
      const subName = decodeBasicEntities(sm[1].replace(/<[^>]+>/g, ''));
      const normSub = normalizePt(subName);
      if (!subName || normSub === 'outros' || seenSub.has(normSub)) continue;
      seenSub.add(normSub);
      subs.push({
        id: `ml-${slug}-${subs.length + 1}`,
        name: subName,
      });
    }

    categories.push({
      id: `ml-${slug}`,
      name,
      slug,
      subcategories: subs,
    });
  }

  return categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function parseShopeeCategoryTreeJson(json: any): PlatformCategory[] {
  const list = json?.data?.category_list;
  if (!Array.isArray(list)) return [];
  const categories: PlatformCategory[] = [];
  const seenCat = new Set<string>();

  for (const c of list) {
    const name = String(c?.display_name || c?.name || '').trim();
    const norm = normalizePt(name);
    if (!name || norm === 'outros' || seenCat.has(norm)) continue;
    seenCat.add(norm);

    const rawChildren = Array.isArray(c?.children) ? c.children : [];
    const subs: PlatformSubcategory[] = [];
    const seenSub = new Set<string>();
    for (const ch of rawChildren) {
      const subName = String(ch?.display_name || ch?.name || '').trim();
      const normSub = normalizePt(subName);
      if (!subName || normSub === 'outros' || seenSub.has(normSub)) continue;
      seenSub.add(normSub);
      subs.push({
        id: String(ch?.catid || `shp-${c.catid}-${subs.length + 1}`),
        name: subName,
      });
    }

    categories.push({
      id: String(c?.catid || `shp-${categories.length + 1}`),
      name,
      subcategories: subs,
    });
  }

  return categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

const SKIP_PROMOBIT_CATEGORIES = new Set([
  'outros',
  'viagem, pacotes e passagens',
  'aplicativos e software',
]);

export function parsePromobitCategoriesJson(json: any): PlatformCategory[] {
  const list = json?.categories;
  if (!Array.isArray(list)) return [];
  const categories: PlatformCategory[] = [];
  const seenCat = new Set<string>();

  for (const c of list) {
    const name = String(c?.category_name || '').trim();
    const norm = normalizePt(name);
    if (!name || SKIP_PROMOBIT_CATEGORIES.has(norm) || seenCat.has(norm)) continue;
    seenCat.add(norm);

    const rawSubs = Array.isArray(c?.subcategories) ? c.subcategories : [];
    const subs: PlatformSubcategory[] = [];
    const seenSub = new Set<string>();
    for (const s of rawSubs) {
      const subName = String(s?.subcategory_name || '').trim();
      const normSub = normalizePt(subName);
      if (!subName || seenSub.has(normSub)) continue;
      seenSub.add(normSub);
      subs.push({
        id: String(s?.subcategory_id || `pb-${c.category_id}-${subs.length + 1}`),
        name: subName,
        slug: String(s?.subcategory_param || ''),
      });
    }

    categories.push({
      id: String(c?.category_id || `pb-${categories.length + 1}`),
      name,
      slug: String(c?.category_url || ''),
      subcategories: subs,
    });
  }

  return categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function makeStaticCategories(
  prefix: string,
  entries: Array<[string, string[]]>
): PlatformCategory[] {
  return entries.map(([catName, subNames], idx) => ({
    id: `${prefix}-cat-${idx + 1}`,
    name: catName,
    subcategories: subNames.map((subName, sIdx) => ({
      id: `${prefix}-sub-${idx + 1}-${sIdx + 1}`,
      name: subName,
    })),
  }));
}

export const FALLBACK_PLATFORM_CATEGORIES: Record<string, PlatformCategory[]> = {
  'Todas as Plataformas': makeStaticCategories('all', [
    ['Bebês e Crianças', ['Fraldas', 'Carrinho de Bebê', 'Cadeirinha para Auto', 'Mamadeiras e Alimentação', 'Roupas Infantis', 'Berço']],
    ['Beleza e Perfumaria', ['Perfumes', 'Maquiagem', 'Skincare e Protetor Solar', 'Cuidados com o Cabelo', 'Secadores e Chapinhas', 'Barbeadores']],
    ['Brinquedos e Hobbies', ['Lego e Blocos de Montar', 'Bonecas e Bonecos', 'Jogos de Tabuleiro', 'Carrinhos e Pistas', 'Funko Pop', 'Instrumentos Musicais']],
    ['Casa, Móveis e Decoração', ['Cama, Mesa e Banho', 'Móveis e Cadeiras', 'Iluminação e LED', 'Decoração', 'Utilidades de Cozinha', 'Panelas e Talheres']],
    ['Celulares e Smartphones', ['Smartphones Android', 'iPhone', 'Capas e Películas', 'Carregadores e Power Banks', 'Smartwatches', 'Fones Bluetooth']],
    ['Eletrodomésticos', ['Geladeiras e Refrigeradores', 'Lavadoras de Roupas', 'Micro-ondas', 'Fogões e Cooktops', 'Ar-Condicionado', 'Ventiladores']],
    ['Eletroportáteis', ['Air Fryer e Fritadeiras', 'Cafeteiras', 'Aspiradores de Pó', 'Liquidificadores', 'Batedeiras', 'Ferros de Passar']],
    ['Eletrônicos, Áudio e Vídeo', ['Smart TVs', 'Fones de Ouvido', 'Caixas de Som Bluetooth', 'Soundbars', 'Projetores', 'Câmeras e Drones']],
    ['Esporte, Fitness e Suplementos', ['Tênis de Corrida', 'Whey Protein', 'Creatina', 'Bicicletas e Ciclismo', 'Futebol e Chuteiras', 'Camping e Trilha']],
    ['Ferramentas e Construção', ['Furadeiras e Parafusadeiras', 'Ferramentas Manuais', 'Serras e Lixadeiras', 'Casa Inteligente', 'Jardim e Lavadoras de Alta Pressão']],
    ['Games e Consoles', ['PlayStation 5', 'Xbox Series', 'Nintendo Switch', 'Controles e Acessórios', 'Headsets Gamer', 'Jogos']],
    ['Informática', ['Notebooks', 'Monitores', 'Cadeiras Gamer', 'SSD e Armazenamento', 'Teclados e Mouses', 'Tablets', 'Roteadores e Wi-Fi']],
    ['Livros e Papelaria', ['Livros', 'Kindle e eReaders', 'HQs e Mangás', 'Material Escolar', 'Cadernos e Canetas']],
    ['Moda e Calçados', ['Tênis', 'Camisetas e Camisas', 'Vestidos e Blusas', 'Jaquetas e Moletons', 'Chinelos e Sandálias', 'Bolsas e Mochilas', 'Relógios e Óculos']],
    ['Peças e Acessórios Automotivos', ['Pneus', 'Capacetes', 'Som Automotivo e Multimídia', 'Acessórios para Carros', 'Acessórios para Motos']],
    ['Pet Shop', ['Ração para Cães', 'Ração para Gatos', 'Antipulgas e Higiene Pet', 'Areia para Gatos', 'Camas e Brinquedos Pet']],
    ['Supermercado e Bebidas', ['Café e Chá', 'Cervejas e Vinhos', 'Chocolates e Snacks', 'Limpeza e Lavanderia', 'Higiene Pessoal']],
  ]),
  'Mercado Livre': makeStaticCategories('ml', [
    ['Acessórios para Veículos', ['Aces. de Carros e Caminhonetes', 'Aces. de Motos e Quadriciclos', 'Pneus e Acessórios', 'Som Automotivo', 'Capacetes e Equipamentos']],
    ['Alimentos e Bebidas', ['Bebidas', 'Mercearia', 'Café, Chá e Mate', 'Chocolates e Doces', 'Suplementos Alimentares']],
    ['Bebês', ['Alimentação e Amamentação', 'Carrinhos e Cadeirinhas', 'Fraldas e Higiene', 'Quarto do Bebê', 'Roupas de Bebê']],
    ['Beleza e Cuidado Pessoal', ['Perfumes', 'Maquiagem', 'Cuidados com a Pele', 'Cuidados com o Cabelo', 'Barbearia', 'Artefatos para Cabelo']],
    ['Brinquedos e Hobbies', ['Bonecos e Bonecas', 'Jogos de Tabuleiro e Cartas', 'Blocos de Montar', 'Veículos de Brinquedo', 'Ar Livre e Playground']],
    ['Calçados, Roupas e Bolsas', ['Tênis', 'Camisetas', 'Vestidos', 'Calças e Jeans', 'Agasalhos e Jaquetas', 'Bolsas e Mochilas', 'Chinelos e Sandálias']],
    ['Câmeras e Acessórios', ['Câmeras Digitais', 'Drones e Acessórios', 'Câmeras de Segurança', 'Lentes e Filtros', 'Tripés e Iluminação']],
    ['Casa, Móveis e Decoração', ['Cozinha', 'Cama, Mesa e Banho', 'Móveis para Casa', 'Iluminação Residencial', 'Enfeites e Decoração', 'Cuidado da Casa e Lavanderia']],
    ['Celulares e Telefones', ['Celulares e Smartphones', 'Acessórios para Celulares', 'Smartwatches e Acessórios', 'Carregadores e Power Banks', 'Capas e Películas']],
    ['Construção', ['Materiais de Obra', 'Encanamento', 'Energia e Elétrica', 'Pintura', 'Segurança Residencial']],
    ['Eletrodomésticos', ['Pequenos Eletrodomésticos', 'Ar e Ventilação', 'Refrigeração', 'Lavagem', 'Fornos e Fogões', 'Bebedouros e Purificadores']],
    ['Eletrônicos, Áudio e Vídeo', ['Televisores', 'Fones de Ouvido', 'Áudio e Caixas de Som', 'Projetores e Telas', 'Acessórios para TV']],
    ['Esportes e Fitness', ['Fitness e Musculação', 'Suplementos e Shakers', 'Futebol', 'Ciclismo', 'Camping, Caça e Pesca', 'Corrida']],
    ['Ferramentas', ['Ferramentas Elétricas', 'Ferramentas Manuais', 'Caixas e Organizadores', 'Medições e Instrumentação', 'Acessórios para Ferramentas']],
    ['Games', ['Consoles', 'Videogames e Jogos', 'Acessórios para Consoles', 'Acessórios para PC Gaming']],
    ['Informática', ['Notebooks e Portáteis', 'Monitores e Acessórios', 'Componentes para PC', 'Armazenamento e SSD', 'Periféricos de PC', 'Tablets e Acessórios', 'Conectividade e Redes']],
    ['Joias e Relógios', ['Relógios de Pulso', 'Smartwatches', 'Joias e Bijuterias', 'Óculos']],
    ['Livros, Revistas e Comics', ['Livros Físicos', 'HQs e Mangás', 'Livros Infantis', 'Livros Técnicos']],
    ['Pet Shop', ['Cães', 'Gatos', 'Rações', 'Higiene e Limpeza Pet', 'Brinquedos e Acessórios']],
    ['Saúde', ['Cuidado da Saúde', 'Higiene Bucal', 'Massagem', 'Equipamento Médico', 'Suplementos']],
  ]),
  Shopee: makeStaticCategories('shp', [
    ['Acessórios de Moda', ['Óculos', 'Bonés e Chapéus', 'Cintos', 'Anéis', 'Colares', 'Brincos', 'Pulseiras']],
    ['Alimentos e Bebidas', ['Snacks e Petiscos', 'Café e Chás', 'Chocolates e Doces', 'Bebidas', 'Mercearia']],
    ['Animais Domésticos', ['Ração e Petiscos', 'Brinquedos para Pets', 'Camas e Casas', 'Higiene e Cuidados', 'Coleiras e Guias']],
    ['Áudio', ['Fones de Ouvido Bluetooth', 'Caixas de Som', 'Microfones', 'Headsets', 'Amplificadores e Soundbars']],
    ['Beleza', ['Maquiagem', 'Cuidados com a Pele', 'Cuidados com o Cabelo', 'Perfumes e Fragrâncias', 'Cuidados Pessoais', 'Ferramentas de Beleza']],
    ['Bolsas Femininas', ['Bolsas de Ombro', 'Bolsas Transversais', 'Mochilas Femininas', 'Carteiras', 'Necessaires']],
    ['Bolsas Masculinas', ['Mochilas Masculinas', 'Carteiras', 'Pochetes', 'Pastas para Notebook']],
    ['Brinquedos e Hobbies', ['Bonecas e Pelúcias', 'Blocos de Montar', 'Jogos de Tabuleiro', 'Brinquedos Educativos', 'Colecionáveis']],
    ['Câmeras e Drones', ['Câmeras de Segurança', 'Drones', 'Câmeras de Ação', 'Webcams', 'Tripés e Ring Lights']],
    ['Casa e Construção', ['Decoração', 'Artigos de Cozinha', 'Roupas de Cama', 'Banho', 'Organizadores', 'Iluminação', 'Ferramentas']],
    ['Celulares e Dispositivos', ['Smartphones', 'Capas e Películas', 'Carregadores e Cabos', 'Power Banks', 'Suportes e Acessórios']],
    ['Computadores e Acessórios', ['Notebooks', 'Teclados e Mouses', 'Monitores', 'SSD e Armazenamento', 'Redes e Wi-Fi', 'Cadeiras Gamer']],
    ['Eletrodomésticos', ['Air Fryer e Fritadeiras', 'Cafeteiras e Chaleiras', 'Aspiradores', 'Liquidificadores e Mixers', 'Ventiladores e Climatizadores']],
    ['Esportes e Lazer', ['Roupas Esportivas', 'Equipamentos de Academia', 'Ciclismo', 'Camping e Trilha', 'Futebol']],
    ['Jogos e Consoles', ['Consoles', 'Controles', 'Jogos', 'Acessórios Gamer']],
    ['Mãe e Bebê', ['Fraldas', 'Alimentação Infantil', 'Carrinhos e Passeio', 'Brinquedos para Bebês', 'Roupas de Bebê']],
    ['Moda Infantil', ['Roupas de Meninas', 'Roupas de Meninos', 'Calçados Infantis', 'Acessórios Infantis']],
    ['Papelaria', ['Cadernos e Agendas', 'Canetas e Marcadores', 'Material Escolar', 'Organização de Escritório']],
    ['Relógios', ['Smartwatches', 'Relógios Masculinos', 'Relógios Femininos', 'Pulseiras e Acessórios']],
    ['Roupas Femininas', ['Vestidos', 'Blusas', 'Calças e Leggings', 'Shorts e Saias', 'Lingerie e Pijamas', 'Jaquetas e Casacos']],
    ['Roupas Masculinas', ['Camisetas', 'Camisas', 'Calças', 'Bermudas e Shorts', 'Moletons e Suéteres', 'Jaquetas e Casacos', 'Cuecas e Meias']],
    ['Sapatos Femininos', ['Tênis', 'Sandálias', 'Botas', 'Saltos e Tamancos', 'Sapatilhas e Rasteirinhas']],
    ['Sapatos Masculinos', ['Tênis', 'Botas', 'Sandálias e Chinelos', 'Sapatos Sociais e Mocassins']],
    ['Saúde', ['Vitaminas e Suplementos', 'Cuidados Bucais', 'Massageadores', 'Equipamentos de Saúde']],
    ['Acessórios para Veículos', ['Acessórios para Carros', 'Acessórios para Motos', 'Capacetes', 'Som Automotivo', 'Ferramentas Automotivas']],
  ]),
  Amazon: makeStaticCategories('amz', [
    ['Dispositivos Amazon', ['Echo e Alexa', 'Fire TV Stick', 'Kindle e eReaders', 'Câmeras Ring e Blink']],
    ['Eletrônicos e Tecnologia', ['Celulares e Smartphones', 'TVs e Home Theater', 'Fones de Ouvido e Áudio', 'Câmeras e Drones', 'Smartwatches', 'Carregadores e Power Banks']],
    ['Informática e Acessórios', ['Notebooks', 'Monitores', 'Tablets', 'SSD, HDs e Memórias', 'Teclados e Mouses', 'Impressoras', 'Roteadores e Redes']],
    ['Games e Consoles', ['PlayStation 5', 'Xbox', 'Nintendo Switch', 'Controles e Acessórios', 'Jogos', 'Headsets Gamer']],
    ['Casa, Cozinha e Eletroportáteis', ['Air Fryer e Fritadeiras', 'Cafeteiras', 'Aspiradores de Pó', 'Panelas e Utensílios', 'Cama, Mesa e Banho', 'Móveis e Decoração', 'Iluminação']],
    ['Eletrodomésticos', ['Geladeiras e Freezers', 'Lavadoras de Roupas', 'Micro-ondas', 'Ar-Condicionado e Ventiladores', 'Fogões e Cooktops']],
    ['Livros e Papelaria', ['Livros Mais Vendidos', 'Ficção e Literatura', 'Negócios e Finanças', 'HQs e Mangás', 'Infantil', 'Papelaria e Escritório']],
    ['Beleza e Cuidados Pessoais', ['Skincare e Protetor Solar', 'Cuidados com o Cabelo', 'Perfumes', 'Maquiagem', 'Barbeadores e Depiladores', 'Higiene Bucal']],
    ['Saúde e Suplementos', ['Whey Protein', 'Creatina', 'Vitaminas e Minerais', 'Cuidados Pessoais', 'Equipamentos de Saúde']],
    ['Moda e Calçados', ['Tênis e Calçados', 'Roupas Masculinas', 'Roupas Femininas', 'Relógios', 'Bolsas e Mochilas', 'Óculos']],
    ['Esportes e Aventura', ['Academia e Musculação', 'Corrida e Caminhada', 'Ciclismo', 'Camping e Trilha', 'Futebol']],
    ['Brinquedos e Jogos', ['Lego e Montar', 'Jogos de Tabuleiro', 'Bonecas e Bonecos', 'Brinquedos Educativos', 'Bebês e Fraldas']],
    ['Ferramentas e Construção', ['Furadeiras e Parafusadeiras', 'Ferramentas Manuais', 'Casa Inteligente', 'Jardim e Piscina']],
    ['Alimentos, Bebidas e Mercado', ['Café e Cápsulas', 'Cervejas, Vinhos e Destilados', 'Chocolates e Mercearia', 'Limpeza e Lavanderia']],
    ['Pet Shop', ['Ração para Cães', 'Ração para Gatos', 'Antipulgas e Higiene', 'Brinquedos e Acessórios Pet']],
    ['Automotivo', ['Pneus', 'Acessórios para Carros', 'Capacetes e Motos', 'Limpeza Automotiva']],
  ]),
  Magalu: makeStaticCategories('mgl', [
    ['Celulares e Smartphones', ['Smartphones Samsung', 'iPhone', 'Smartphones Motorola e Xiaomi', 'Smartwatches', 'Carregadores e Capas', 'Fones Bluetooth']],
    ['Eletrodomésticos', ['Geladeiras e Refrigeradores', 'Máquinas de Lavar', 'Fogões e Cooktops', 'Micro-ondas', 'Ar-Condicionado', 'Ventiladores']],
    ['Eletroportáteis', ['Air Fryer e Fritadeiras', 'Cafeteiras', 'Liquidificadores', 'Aspiradores de Pó', 'Batedeiras', 'Ferros e Passadeiras']],
    ['TV e Vídeo', ['Smart TVs 4K', 'Smart TVs 32 a 43"', 'Soundbars e Home Theater', 'Projetores', 'Suportes e Acessórios']],
    ['Informática', ['Notebooks', 'Monitores', 'Tablets', 'Impressoras', 'Teclados, Mouses e Webcams', 'SSD e Armazenamento', 'Cadeiras Gamer']],
    ['Móveis e Decoração', ['Sofás e Estofados', 'Camas e Colchões', 'Guarda-Roupas', 'Mesas e Cadeiras', 'Armários de Cozinha', 'Decoração e Iluminação']],
    ['Utilidades Domésticas', ['Jogos de Panelas', 'Cama, Mesa e Banho', 'Garrafas e Copos Térmicos', 'Organização e Limpeza', 'Aparelhos de Jantar']],
    ['Games', ['Consoles PS5, Xbox e Switch', 'Controles', 'Jogos', 'Headsets e Acessórios Gamer']],
    ['Moda e Calçados', ['Tênis', 'Roupas Masculinas', 'Roupas Femininas', 'Chinelos e Sandálias', 'Mochilas e Malas']],
    ['Beleza e Perfumaria', ['Perfumes', 'Secadores e Chapinhas', 'Barbeadores', 'Cuidados com o Cabelo', 'Skincare e Maquiagem']],
    ['Esporte e Lazer', ['Bicicletas', 'Equipamentos de Academia', 'Suplementos', 'Camping e Lazer']],
    ['Ferramentas e Construção', ['Furadeiras e Parafusadeiras', 'Lavadoras de Alta Pressão', 'Ferramentas Manuais', 'Elétrica e Iluminação']],
    ['Bebês e Brinquedos', ['Fraldas', 'Carrinhos e Cadeirinhas', 'Brinquedos', 'Lego e Jogos']],
    ['Automotivo e Pet Shop', ['Pneus', 'Som Automotivo', 'Capacetes', 'Rações e Acessórios Pet']],
  ]),
  AliExpress: makeStaticCategories('ali', [
    ['Eletrônicos de Consumo', ['Fones de Ouvido Bluetooth', 'Smartwatches e Pulseiras', 'Caixas de Som', 'Drones e Câmeras de Ação', 'Projetores Portáteis', 'Câmeras de Segurança']],
    ['Celulares e Acessórios', ['Smartphones', 'Carregadores GaN e Cabos', 'Power Banks', 'Capas e Películas', 'Suportes e Estabilizadores']],
    ['Informática e Gaming', ['Teclados Mecânicos', 'Mouses Gamer', 'SSD e Pen Drives', 'Controles Gamer', 'Headsets e Microfones', 'Hubs USB e Adaptadores', 'Tablets']],
    ['Casa, Cozinha e Jardim', ['Iluminação LED e Casa Inteligente', 'Organizadores Domésticos', 'Utensílios de Cozinha', 'Aspiradores Robô', 'Decoração']],
    ['Ferramentas e Manutenção', ['Parafusadeiras e Furadeiras', 'Multímetros e Medidores', 'Kits de Chaves', 'Solda e Eletrônica']],
    ['Moda e Acessórios', ['Roupas Masculinas', 'Roupas Femininas', 'Tênis e Calçados', 'Bolsas e Mochilas', 'Óculos de Sol', 'Relógios e Joias']],
    ['Esportes e Lazer', ['Ciclismo e Acessórios Bike', 'Camping e Lanternas', 'Pesca', 'Fitness e Academia']],
    ['Automóveis e Motocicletas', ['Centrais Multimídia e CarPlay', 'Câmeras de Ré e Dashcams', 'Iluminação Automotiva LED', 'Acessórios para Motos', 'Scanners OBD2']],
    ['Brinquedos, Hobbies e Pets', ['Blocos de Montar', 'Brinquedos de Controle Remoto', 'Acessórios para Cães e Gatos', 'Papelaria Criativa']],
    ['Beleza e Saúde', ['Massageadores', 'Aparadores e Barbeadores', 'Cuidados com a Pele', 'Escovas Elétricas']],
  ]),
  Netshoes: makeStaticCategories('net', [
    ['Calçados', ['Tênis de Corrida', 'Tênis Casual', 'Tênis de Treino e Academia', 'Chuteiras Campo, Society e Futsal', 'Sandálias e Chinelos', 'Botas e Sapatênis']],
    ['Roupas Masculinas', ['Camisetas', 'Bermudas e Shorts', 'Calças e Agasalhos', 'Jaquetas e Moletons', 'Regatas', 'Cuecas e Meias']],
    ['Roupas Femininas', ['Leggings e Calças', 'Tops e Regatas', 'Camisetas e Blusas', 'Shorts e Bermudas', 'Jaquetas e Moletons']],
    ['Camisas de Time e Futebol', ['Camisas de Clubes Brasileiros', 'Camisas Internacionais', 'Bolas de Futebol', 'Luvas de Goleiro', 'Caneleiras e Meiões']],
    ['Esportes e Modalidades', ['Corrida e Caminhada', 'Treino e Academia', 'Basquete', 'Ciclismo e Bicicletas', 'Natação', 'Artes Marciais e Boxe', 'Beach Tennis e Tênis']],
    ['Acessórios Esportivos', ['Mochilas e Sacolas', 'Malas de Viagem', 'Bonés e Viseiras', 'Garrafas e Squeezes', 'Relógios e Smartwatches', 'Óculos Esportivos']],
    ['Suplementos e Nutrição', ['Whey Protein', 'Creatina', 'Pré-Treino', 'BCAA e Aminoácidos', 'Hipercalóricos e Barras', 'Vitaminas e Coqueteleiras']],
    ['Equipamentos de Treino', ['Halteres e Anilhas', 'Colchonetes e Elásticos', 'Cordas e Acessórios Funcional', 'Balanças']],
  ]),
};
