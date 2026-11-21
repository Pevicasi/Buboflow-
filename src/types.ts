export type Marketplace =
  | 'Shopee'
  | 'Mercado Livre'
  | 'Amazon'
  | 'Magalu'
  | 'Netshoes'
  | 'AliExpress';

export type NavRoute =
  | 'dashboard'
  | 'whatsapp'
  | 'telegram'
  | 'enviar-mensagens'
  | 'produtos'
  | 'produtos-favoritos'
  | 'vitrine-ofertas'
  | 'cupons'
  | 'grupos-envio'
  | 'grupos-monitoramento'
  | 'agendamentos'
  | 'filas-disparo'
  | 'download-videos'
  | 'conversao-link'
  | 'comissao'
  | 'envios'
  | 'monitor-membros'
  | 'configuracoes'
  | 'config-disparo-automatico'
  | 'config-grupo-automacao'
  | 'config-site'
  | 'config-templates'
  | 'config-plataformas'
  | 'config-monitoramento'
  | 'config-avancadas'
  | 'indicacoes'
  | 'perfil'
  | 'segmentos';

export type ProductArtworkKey =
  | 'flipflops'
  | 'shorts'
  | 'mug'
  | 'sneaker'
  | 'cap'
  | 'earbuds'
  | 'speaker'
  | 'airfryer';

export interface Product {
  id: string;
  title: string;
  ctaHighlight?: string;
  platform: Marketplace;
  category: string;
  originalPrice: number;
  discountPrice: number;
  discountPercent: number;
  commissionPercent: number;
  commissionValue: number;
  affiliateUrl: string;
  originalUrl: string;
  couponCode?: string;
  extraInfo?: string;
  artworkKey: ProductArtworkKey;
  customImageUrl?: string;
  isFavorite: boolean;
  isPrioritized: boolean;
  salesRank: number;
  segment: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discountText: string;
  minSpend?: number;
  platform: Marketplace;
  active: boolean;
  isAutomatic: boolean;
  isSiteWide?: boolean;
  isShowcase?: boolean;
  expiresAt: string;
  link?: string;
  segment?: string;
}

export interface ChannelAccount {
  id: string;
  name: string;
  channel: 'WhatsApp' | 'Telegram';
  phoneOrHandle: string;
  connected: boolean;
  /** When false on a WhatsApp account, this number stays connected but will not send offers. Defaults to true. */
  activeForDispatch?: boolean;
  provider?: 'baileys' | 'evolution' | 'zapi' | 'webhook' | 'telegram-bot';
  baseUrl?: string;
  instanceName?: string;
  webhookUrl?: string;
  apiToken?: string;
  clientToken?: string;
}

export interface DispatchGroup {
  id: string;
  name: string;
  channel: 'WhatsApp' | 'Telegram';
  accountId: string;
  accountName: string;
  remoteJid?: string;
  username?: string;
  isChannel?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  isOwnerOrAdmin?: boolean;
  canPostMessages?: boolean;
  activeForOffers: boolean;
  activeSegments?: string[];
  membersCount: number;
  maxCapacity: number;
  inviteUrl: string;
  isPriorityCapture?: boolean;
  segment: string;
}

export interface MonitoringGroup {
  id: string;
  name: string;
  channel: 'WhatsApp' | 'Telegram';
  accountId: string;
  accountName: string;
  remoteJid?: string;
  monitored: boolean;
  monitoredSegments?: string[];
  capturedToday: number;
  useGroupImage?: boolean;
  allowedMarketplaces?: Marketplace[];
}

export interface SavedGroupPreference {
  activeForOffers?: boolean;
  activeSegments?: string[];
  monitored?: boolean;
  monitoredSegments?: string[];
  useGroupImage?: boolean;
  allowedMarketplaces?: Marketplace[];
  segment?: string;
  inviteUrl?: string;
  isChannel?: boolean;
  isPriorityCapture?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  isOwnerOrAdmin?: boolean;
  canPostMessages?: boolean;
}

export interface ScheduledItem {
  id: string;
  title: string;
  message: string;
  groupIds: string[];
  scheduledAt: string;
  recurrence: 'Único' | 'Recorrente';
  status: 'Pendente' | 'Enviado';
  platform?: Marketplace;
  imageUrl?: string;
  segment?: string;
}

export interface DispatchQueue {
  id: string;
  name: string;
  sentCount: number;
  totalCount: number;
  active: boolean;
  productIds: string[];
  intervalMinutes: number;
  segment: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface TemplateCondition {
  id: string;
  variable: 'cta_ia' | 'desconto_pct' | 'cupom' | 'info_extra' | 'espaco';
  operator: 'existe' | 'nao_existe' | 'maior_que' | 'menor_que' | 'igual_a' | 'sempre';
  compareValue?: number;
  thenText: string;
  elseText?: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  platform: Marketplace;
  body: string;
  ctaStyle: 'Padrão' | 'Urgência' | 'Direto' | 'Descontraído';
  enableLinkPreview: boolean;
  includeLinkPreviewDetails?: boolean;
  conditions: TemplateCondition[];
}

export interface SentLog {
  id: string;
  title: string;
  message: string;
  platform: Marketplace;
  groupsNames: string[];
  sentAt: string;
  sentAtIso?: string;
  artworkKey?: ProductArtworkKey;
  customImageUrl?: string;
  affiliateUrl?: string;
  segment?: string;
}

export interface ConvertedLinkItem {
  id: string;
  originalUrl: string;
  affiliateUrl: string;
  platform: Marketplace;
  createdAt: string;
}

export interface AutoDispatchConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  minProductsPerRun: number;
  maxProductsPerRun: number;
  distribution: Record<Marketplace, number>;
  sendOrder: 'Aleatório' | 'Mais Recentes' | 'Priorizados Primeiro' | 'Maior Comissão';
  mlCouponMaxAgeHours?: number;
  prioritizeCouponProducts?: boolean;
}

export interface SiteCaptureConfig {
  slug: string;
  brandColor: string;
  logoDataUrl?: string;
  randomRedirect: boolean;
  selectedGroupIds: string[];
  pageTitle: string;
  pageDescription: string;
  extraDescription: string;
  buttonText: string;
  advantages: string[];
  metaPixelId: string;
  pixelDebug: boolean;
}

export interface PlatformIntegrations {
  shopee: {
    appId: string;
    apiSecret: string;
    subIds: string[];
    isManagedPartner: boolean;
  };
  amazon: {
    associateTag: string;
    accessKey: string;
    secretKey: string;
    autoShorten: boolean;
  };
  mercadoLivre: {
    extensionKey: string;
    extensionCreatedAt: string;
    etiqueta: string;
    authCode: string;
  };
  netshoes: {
    clientId: string;
    clientSecret: string;
    accountSid: string;
    nominalCoupon: string;
    blockedCoupons: string[];
  };
  magalu: {
    partnerStore: string;
    affiliateId: string;
  };
  aliexpress: {
    appKey: string;
    appSecret: string;
    trackingId: string;
  };
}

export interface MonitoringRulesConfig {
  enabled: boolean;
  avoidDuplicateHours: number;
  restrictedWords: string[];
  allowedWords: string[];
  automationGroupId: string;
  compareLowerPrice?: boolean;
  compareMinSavingsPercent?: number;
}

export interface UserProfile {
  fullName: string;
  cpf: string;
  email: string;
  phone: string;
  companyName: string;
  cnpj: string;
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  asaasWalletId: string;
  referralActive: boolean;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'info' | 'error';
}
