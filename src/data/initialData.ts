import {
  AutoDispatchConfig,
  ChannelAccount,
  Coupon,
  DispatchGroup,
  DispatchQueue,
  Marketplace,
  MessageTemplate,
  MonitoringGroup,
  MonitoringRulesConfig,
  PlatformIntegrations,
  Product,
  ScheduledItem,
  SentLog,
  SiteCaptureConfig,
  UserProfile,
} from '../types';

export const MARKETPLACES: Marketplace[] = [
  'Shopee',
  'Amazon',
  'Mercado Livre',
  'AliExpress',
  'Netshoes',
  'Magalu',
];

export const VITRINE_CATEGORIES: string[] = [
  'Todas as Categorias',
  'Acessórios de Moda',
  'Animais Domésticos',
  'Áudio',
  'Automóveis',
  'Beleza',
  'Bolsas Femininas',
  'Bolsas Masculinas',
  'Câmeras e Drones',
  'Casa e Decoração',
  'Celulares e Dispositivos',
  'Computadores e Acessórios',
  'Eletrodomésticos',
  'Esportes e Atividades ao Ar Livre',
  'Hobbies e Coleções',
  'Jogos e Consoles',
  'Livros e Revistas',
];

export const INITIAL_SEGMENTS: string[] = ['Geral'];

export const INITIAL_ACCOUNTS: ChannelAccount[] = [
  {
    id: 'acc-wa-1',
    name: 'CONTA 01',
    channel: 'WhatsApp',
    phoneOrHandle: 'Aguardando conexão',
    connected: false,
    provider: 'baileys',
    webhookUrl: '',
    apiToken: '',
  },
];

export const INITIAL_DISPATCH_GROUPS: DispatchGroup[] = [];

export const INITIAL_MONITORING_GROUPS: MonitoringGroup[] = [];

export const INITIAL_PRODUCTS: Product[] = [];

export const DEFAULT_TEMPLATE_CONDITIONS = [
  {
    id: 'cond-1',
    variable: 'cta_ia' as const,
    operator: 'existe' as const,
    thenText: '{{cta_ia}}',
    elseText: '{{nome}}',
  },
  {
    id: 'cond-2',
    variable: 'desconto_pct' as const,
    operator: 'maior_que' as const,
    compareValue: 0,
    thenText: 'De: ~{{preco_original}}~ ❌',
    elseText: '',
  },
  {
    id: 'cond-3',
    variable: 'desconto_pct' as const,
    operator: 'maior_que' as const,
    compareValue: 0,
    thenText: '{{desconto_pct}}% OFF',
    elseText: '',
  },
];

const DEFAULT_STANDARD_BODY =
  '💥 [[cond:cond-1]]\n\n[[cond:cond-2]]\n*💸 Por: {{preco_desconto}} 🔥*\n[[cond:cond-3]]\n\n🔗 Compre aqui: {{link}}\n\n{{cupom}}\n\n⚠️ Promoção sujeita a alteração a qualquer momento.';

const DEFAULT_SHOPEE_BODY =
  '💥 [[cond:cond-1]]\n\n[[cond:cond-2]]\n*💸 Por: {{preco_desconto}} 🔥*\n[[cond:cond-3]]\n\n🔗 Compre aqui: {{link}}\n\n{{cupom}}\n\n🎟️ Resgate Cupons:\nhttps://s.shopee.com.br/8AXZEODUrk\n\n⚠️ Promoção sujeita a alteração a qualquer momento.';

export const INITIAL_TEMPLATES: MessageTemplate[] = [
  {
    id: 'tpl-amazon',
    name: 'Amazon Template Padrão',
    platform: 'Amazon',
    body: DEFAULT_STANDARD_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'tpl-netshoes',
    name: 'Netshoes Template Padrão',
    platform: 'Netshoes',
    body: DEFAULT_STANDARD_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'tpl-magalu',
    name: 'Magalu Template Padrão',
    platform: 'Magalu',
    body: DEFAULT_STANDARD_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'tpl-aliexpress',
    name: 'AliExpress Template Padrão',
    platform: 'AliExpress',
    body: DEFAULT_STANDARD_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'tpl-ml',
    name: 'Mercado Livre Template Padrão',
    platform: 'Mercado Livre',
    body: DEFAULT_STANDARD_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'tpl-shopee',
    name: 'Shopee Template Padrão',
    platform: 'Shopee',
    body: DEFAULT_SHOPEE_BODY,
    ctaStyle: 'Padrão',
    enableLinkPreview: true,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
];

export const TEMPLATE_PRESETS = [
  {
    id: 'preset-classic',
    title: 'Oferta clássica',
    tags: ['Condição', 'Alta conversão'],
    description: 'O modelo padrão: completo e de alta conversão, com desconto e cupom.',
    body: DEFAULT_STANDARD_BODY,
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'preset-flash',
    title: 'Relâmpago',
    tags: ['Conteúdo dinâmico', 'Condição'],
    description: 'Excelente escolha para datas duplas, com frases de alta conversão a cada envio.',
    body: '⚡ *{{dinamico:CORRE QUE É RELÂMPAGO!|OFERTA POR TEMPO LIMITADO!|PREÇO BAIXOU AGORA!}}* ⚡\n💥 [[cond:cond-1]]\n\n[[cond:cond-2]]\n*💸 Só {{preco_desconto}} 🔥*\n[[cond:cond-3]]\n\n👉 Garanta o seu agora: {{link}}\n\n{{cupom}}',
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'preset-direct',
    title: 'Direto ao ponto',
    tags: ['Condição'],
    description: 'Curto e objetivo: nome do produto, preço com o percentual de desconto e link.',
    body: '💥 [[cond:cond-1]]\n\n*Por {{preco_desconto}}*\n[[cond:cond-3]]\n🔗 {{link}}',
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
  {
    id: 'preset-extra',
    title: 'Com informação extra',
    tags: ['Condição', 'Informação adicional'],
    description: 'Para quando o produto tem uma informação extra, como tamanho, frete ou unidade.',
    body: '💥 [[cond:cond-1]]\n\n[[cond:cond-2]]\n*💸 Por: {{preco_desconto}} 🔥*\n[[cond:cond-3]]\n📌 {{info_extra}}\n\n🔗 Compre aqui: {{link}}\n\n{{cupom}}',
    conditions: DEFAULT_TEMPLATE_CONDITIONS,
  },
];

export const INITIAL_COUPONS: Coupon[] = [
  {
    id: 'cup-showcase-1',
    code: 'FRETEGRATIS',
    description: 'Frete grátis em lojas oficiais selecionadas acima de R$ 19',
    discountText: 'Frete Grátis',
    minSpend: 19,
    platform: 'Shopee',
    active: true,
    isAutomatic: true,
    isShowcase: true,
    expiresAt: '2026-12-31',
    link: 'https://s.shopee.com.br/8AXZEODUrk',
  },
  {
    id: 'cup-showcase-2',
    code: 'MELI30OFF',
    description: 'R$ 30 OFF em compras acima de R$ 299 no Mercado Livre',
    discountText: 'R$ 30 OFF',
    minSpend: 299,
    platform: 'Mercado Livre',
    active: true,
    isAutomatic: false,
    isShowcase: true,
    expiresAt: '2026-11-30',
    link: 'https://meli.la/cupons',
  },
  {
    id: 'cup-showcase-3',
    code: 'TENIS20',
    description: '20% OFF adicional em calçados esportivos selecionados',
    discountText: '20% OFF',
    minSpend: 150,
    platform: 'Netshoes',
    active: true,
    isAutomatic: false,
    isShowcase: true,
    expiresAt: '2026-12-15',
  },
];

export const INITIAL_QUEUES: DispatchQueue[] = [];

export const INITIAL_SCHEDULES: ScheduledItem[] = [];

export const INITIAL_SENT_LOGS: SentLog[] = [];

export const INITIAL_AUTO_DISPATCH: AutoDispatchConfig = {
  enabled: true,
  startTime: '07:00',
  endTime: '22:00',
  minIntervalMinutes: 2,
  maxIntervalMinutes: 6,
  minProductsPerRun: 1,
  maxProductsPerRun: 1,
  distribution: {
    Shopee: 50,
    'Mercado Livre': 50,
    Amazon: 0,
    Magalu: 0,
    Netshoes: 0,
    AliExpress: 0,
  },
  sendOrder: 'Aleatório',
};

export const INITIAL_SITE_CAPTURE: SiteCaptureConfig = {
  slug: 'grupo-vip-ofertas',
  brandColor: '#15803d',
  randomRedirect: false,
  selectedGroupIds: [],
  pageTitle: 'GRUPO VIP DE OFERTAS',
  pageDescription:
    'Entre gratuitamente no nosso grupo VIP e receba todos os dias os melhores achadinhos, promoções relâmpago e cupons exclusivos da Shopee, Mercado Livre e Amazon.',
  extraDescription: '⭐ Receba ofertas verificadas em tempo real direto no seu WhatsApp',
  buttonText: 'Entrar no Grupo VIP Agora',
  advantages: [
    '✅ Cupons exclusivos todos os dias',
    '🔥 Ofertas verificadas com desconto real',
    '🔒 Grupo silencioso (apenas administradores enviam)',
  ],
  metaPixelId: '',
  pixelDebug: false,
};

export const INITIAL_INTEGRATIONS: PlatformIntegrations = {
  shopee: {
    appId: '18392019482',
    apiSecret: 'shp_live_98a7f6d5e4c3b2a1',
    subIds: ['whatsappvip'],
    isManagedPartner: false,
  },
  amazon: {
    associateTag: '',
    accessKey: '',
    secretKey: '',
    autoShorten: false,
  },
  mercadoLivre: {
    extensionKey: 'bbf_HZLwGn92KpQv71Xz',
    extensionCreatedAt: '07/11/2026, 16:47:17',
    etiqueta: 'vipe6350064',
    authCode: 'ml_sess_8923748923749823',
  },
  netshoes: {
    clientId: '',
    clientSecret: '',
    accountSid: '',
    nominalCoupon: '',
    blockedCoupons: [],
  },
  magalu: {
    partnerStore: '',
    affiliateId: '',
  },
  aliexpress: {
    appKey: '',
    appSecret: '',
    trackingId: '',
  },
};

export const INITIAL_MONITORING_RULES: MonitoringRulesConfig = {
  enabled: true,
  avoidDuplicateHours: 12,
  restrictedWords: [],
  allowedWords: [],
  automationGroupId: '',
};

export const INITIAL_PROFILE: UserProfile = {
  fullName: 'PETRONIO VIEIRA CAMPOS SILVA',
  cpf: '055.439.374-31',
  email: 'pevicasi@gmail.com',
  phone: '(87) 9 9611-2503',
  companyName: 'PETRONIO VIEIRA CAMPOS SILVA',
  cnpj: '',
  cep: '56640-000',
  street: 'Av Dr Manoel Borba',
  number: '202',
  neighborhood: 'Centro',
  asaasWalletId: '',
  referralActive: false,
};
