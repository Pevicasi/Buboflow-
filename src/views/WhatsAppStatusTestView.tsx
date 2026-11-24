import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MARKETPLACES } from '../data/initialData';
import type { Marketplace } from '../types';
import {
  listBaileysSessionsApi,
  previewWhatsAppStatusCardApi,
  sendWhatsAppStatusTestApi,
} from '../utils/apiClient';
import {
  WHATSAPP_STATUS_FONTS,
  WHATSAPP_STATUS_FORMATS,
  WHATSAPP_STATUS_THEMES,
  buildWhatsAppStatusTexts,
  formatBrlPlain,
  type WhatsAppStatusAudienceMode,
  type WhatsAppStatusFormat,
} from '../utils/whatsappStatusLab';

interface LiveWaSessionItem {
  accountId: string;
  connected: boolean;
  status: string;
  phone?: string | null;
  name?: string | null;
}

interface StatusTestLogItem {
  id: string;
  formatTitle: string;
  accountName: string;
  recipientCount: number;
  recipientPreview: string[];
  postedSteps: string[];
  sentAt: string;
  ok: boolean;
  error?: string;
}

export const WhatsAppStatusTestView: React.FC = () => {
  const { products, accounts, dispatchGroups, notify } = useApp();

  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [title, setTitle] = useState('Fritadeira Air Fryer Digital 4L Inox');
  const [platform, setPlatform] = useState<Marketplace>('Mercado Livre');
  const [originalPrice, setOriginalPrice] = useState('499.90');
  const [discountPrice, setDiscountPrice] = useState('274.90');
  const [couponCode, setCouponCode] = useState('OFERTA10');
  const [affiliateUrl, setAffiliateUrl] = useState('https://meli.la/2UuezgV');
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  const [liveSessions, setLiveSessions] = useState<LiveWaSessionItem[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [audienceMode, setAudienceMode] =
    useState<WhatsAppStatusAudienceMode>('self_and_test');
  const [testPhonesInput, setTestPhonesInput] = useState('');
  const [testGroupJid, setTestGroupJid] = useState('');

  const [themeColor, setThemeColor] = useState<string>('emerald');
  const [fontStyle, setFontStyle] = useState<number>(0);

  const [renderedCardDataUrl, setRenderedCardDataUrl] = useState<string | null>(null);
  const [renderingCard, setRenderingCard] = useState(false);
  const [imgErrorMap, setImgErrorMap] = useState<Record<string, boolean>>({});

  const [sendingFormat, setSendingFormat] = useState<WhatsAppStatusFormat | null>(null);
  const [testLogs, setTestLogs] = useState<StatusTestLogItem[]>([]);

  // Load first real catalog product automatically once products arrive
  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      const firstWithImg =
        products.find((p) => p.customImageUrl && p.affiliateUrl) || products[0];
      if (firstWithImg) {
        applyProductToDraft(firstWithImg.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const applyProductToDraft = (prodId: string) => {
    setSelectedProductId(prodId);
    const p = products.find((item) => item.id === prodId);
    if (!p) return;
    setTitle(p.title);
    setPlatform(p.platform);
    setOriginalPrice(String(p.originalPrice || ''));
    setDiscountPrice(String(p.discountPrice || ''));
    setCouponCode(p.couponCode || '');
    setAffiliateUrl(p.affiliateUrl || p.originalUrl || '');
    setImageUrl(p.customImageUrl || '');
    setImgErrorMap({});
  };

  const refreshLiveSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await listBaileysSessionsApi();
      if (res.ok && Array.isArray(res.sessions)) {
        setLiveSessions(res.sessions);
        const openFirst = res.sessions.find((s) => s.connected || s.status === 'open');
        if (
          openFirst &&
          (!selectedAccountId ||
            !res.sessions.some(
              (s) => s.accountId === selectedAccountId && (s.connected || s.status === 'open')
            ))
        ) {
          setSelectedAccountId(openFirst.accountId);
        }
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    void refreshLiveSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsedOrig = Number(String(originalPrice).replace(',', '.')) || 0;
  const parsedDisc = Number(String(discountPrice).replace(',', '.')) || 0;
  const computedPct =
    parsedOrig > parsedDisc && parsedDisc > 0
      ? Math.round(((parsedOrig - parsedDisc) / parsedOrig) * 100)
      : 0;

  const activeTheme = useMemo(
    () =>
      WHATSAPP_STATUS_THEMES.find((t) => t.id === themeColor) || WHATSAPP_STATUS_THEMES[0],
    [themeColor]
  );

  const previewTexts = useMemo(
    () =>
      buildWhatsAppStatusTexts({
        title,
        platform,
        originalPrice: parsedOrig,
        discountPrice: parsedDisc,
        discountPercent: computedPct,
        couponCode,
        affiliateUrl,
      }),
    [title, platform, parsedOrig, parsedDisc, computedPct, couponCode, affiliateUrl]
  );

  const linkDomain = useMemo(() => {
    try {
      return new URL(affiliateUrl.trim()).hostname.replace(/^www\./i, '');
    } catch {
      return platform === 'Shopee' ? 's.shopee.com.br' : 'meli.la';
    }
  }, [affiliateUrl, platform]);

  const generateRealCardPreview = async () => {
    setRenderingCard(true);
    try {
      const res = await previewWhatsAppStatusCardApi({
        title,
        platform,
        originalPrice: parsedOrig,
        discountPrice: parsedDisc,
        discountPercent: computedPct,
        couponCode,
        imageUrl,
        themeColor,
        calloutText: 'Link clicável no próximo Status ->',
      });
      if (res.ok && res.imageDataUrl) {
        setRenderedCardDataUrl(res.imageDataUrl);
      } else {
        notify('Erro ao gerar card 9:16', res.error || 'Falha na renderização.', 'error');
      }
    } catch {
      notify('Erro ao gerar prévia', 'Falha de comunicação com o servidor.', 'error');
    } finally {
      setRenderingCard(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void generateRealCardPreview();
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, platform, parsedOrig, parsedDisc, computedPct, couponCode, imageUrl, themeColor]);

  const waGroups = useMemo(
    () => dispatchGroups.filter((g) => g.channel === 'WhatsApp' && g.remoteJid),
    [dispatchGroups]
  );

  const parsedTestPhones = useMemo(
    () =>
      testPhonesInput
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [testPhonesInput]
  );

  const connectedAccounts = useMemo(() => {
    const waAccounts = accounts.filter((a) => a.channel === 'WhatsApp');
    if (liveSessions.length > 0) {
      return liveSessions.map((s) => {
        const panelAcc = waAccounts.find((a) => a.id === s.accountId);
        return {
          accountId: s.accountId,
          label:
            panelAcc?.name ||
            s.name ||
            s.phone ||
            s.accountId,
          phone: s.phone || panelAcc?.phoneOrHandle || '',
          open: s.connected || s.status === 'open',
        };
      });
    }
    return waAccounts.map((a) => ({
      accountId: a.id,
      label: a.name,
      phone: a.phoneOrHandle,
      open: a.connected,
    }));
  }, [accounts, liveSessions]);

  const openCount = connectedAccounts.filter((a) => a.open).length;

  const handleTestFormat = async (formatId: WhatsAppStatusFormat) => {
    const meta = WHATSAPP_STATUS_FORMATS.find((f) => f.id === formatId);
    if (!title.trim() || !affiliateUrl.trim()) {
      notify('Campos obrigatórios', 'Preencha o título da oferta e o link de afiliado.', 'error');
      return;
    }
    if (formatId === 'video-plus-link' && !videoUrl.trim()) {
      notify(
        'Link de vídeo necessário',
        'Para testar Vídeo + Link Clicável, cole um link do Instagram, Shopee Vídeo, TikTok ou MP4.',
        'error'
      );
      return;
    }
    if (!selectedAccountId) {
      notify('Sem conta conectada', 'Conecte uma conta do WhatsApp primeiro.', 'error');
      return;
    }

    setSendingFormat(formatId);
    try {
      const res = await sendWhatsAppStatusTestApi({
        accountId: selectedAccountId,
        format: formatId,
        audienceMode,
        testPhones: parsedTestPhones,
        testGroupJid,
        themeColor,
        fontStyle,
        title: title.trim(),
        platform,
        originalPrice: parsedOrig,
        discountPrice: parsedDisc,
        discountPercent: computedPct,
        couponCode: couponCode.trim(),
        affiliateUrl: affiliateUrl.trim(),
        imageUrl: imageUrl.trim(),
        videoUrl: videoUrl.trim(),
      });

      const logEntry: StatusTestLogItem = {
        id: `st-log-${Date.now()}`,
        formatTitle: meta?.title || formatId,
        accountName: res.accountName || selectedAccountId,
        recipientCount: res.recipientCount || 0,
        recipientPreview: res.recipientPreview || [],
        postedSteps: res.postedSteps || [],
        sentAt:
          res.sentAt ||
          new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        ok: Boolean(res.ok),
        error: res.error,
      };
      setTestLogs((prev) => [logEntry, ...prev].slice(0, 12));

      if (res.ok) {
        notify(
          'Status publicado para teste!',
          `${meta?.title} enviado via ${logEntry.accountName} para ${logEntry.recipientCount} contato(s).`
        );
      } else {
        notify('Falha ao postar Status', res.error || 'Erro desconhecido.', 'error');
      }
    } catch {
      notify('Erro de comunicação', 'Não foi possível enviar o teste ao servidor.', 'error');
    } finally {
      setSendingFormat(null);
    }
  };

  const renderStoryCardVisualPreview = (calloutOverride?: string) => {
    if (renderedCardDataUrl) {
      return (
        <img
          src={renderedCardDataUrl}
          alt={`Prévia Story 9:16 de ${title}`}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      );
    }
    return (
      <div
        className="w-full h-full flex flex-col justify-between p-3 text-white select-none"
        style={{
          background: `linear-gradient(160deg, ${activeTheme.bgHex} 0%, ${activeTheme.gradientBottomHex} 100%)`,
        }}
      >
        <div className="text-center text-[10px] font-semibold tracking-wider uppercase opacity-90 pt-1">
          {platform}
        </div>
        <div className="text-center text-xs font-bold leading-snug line-clamp-2 px-1">
          {title}
        </div>
        <div className="relative bg-white rounded-xl p-2 aspect-square flex items-center justify-center mx-2 overflow-hidden">
          {imageUrl && !imgErrorMap['card'] ? (
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
              onError={() => setImgErrorMap((m) => ({ ...m, card: true }))}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-400">
              <ImageIcon className="w-6 h-6" />
              <span className="text-[10px]">Foto do produto</span>
            </div>
          )}
          {computedPct > 0 && (
            <span className="absolute top-1.5 right-1.5 bg-orange-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              {computedPct}% OFF
            </span>
          )}
        </div>
        <div className="text-center space-y-0.5">
          {parsedOrig > parsedDisc && (
            <div className="text-[10px] text-slate-300 line-through tabular-nums">
              De: {formatBrlPlain(parsedOrig)}
            </div>
          )}
          <div className="text-base font-bold text-emerald-400 tabular-nums">
            Por {formatBrlPlain(parsedDisc)}
          </div>
          {couponCode.trim() && (
            <div className="text-[10px] font-semibold text-amber-200">
              CUPOM: {couponCode.trim().toUpperCase()}
            </div>
          )}
        </div>
        <div
          className="text-center text-[10px] font-bold py-1.5 px-2 rounded-lg text-white"
          style={{ backgroundColor: activeTheme.accentHex }}
        >
          {calloutOverride || 'Link clicável no próximo Status ->'}
        </div>
      </div>
    );
  };

  const renderRawPhotoScreenPreview = (captionText: string) => (
    <div className="w-full h-full bg-black flex flex-col justify-between text-white select-none relative">
      <div className="flex items-center justify-between px-2.5 pt-2 text-[10px] text-white/75">
        <span>Meu Status</span>
        <span>agora</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
        {imageUrl && !imgErrorMap['raw'] ? (
          <div className="w-full aspect-square bg-white rounded-lg p-2 flex items-center justify-center">
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
              onError={() => setImgErrorMap((m) => ({ ...m, raw: true }))}
              className="w-full h-full object-contain"
            />
          </div>
        ) : (
          <div className="w-full aspect-square bg-slate-900 border border-slate-800 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-400">
            <ImageIcon className="w-7 h-7" />
            <span className="text-[10px]">Foto original 800×800</span>
          </div>
        )}
      </div>
      <div className="bg-gradient-to-t from-black via-black/85 to-transparent px-2.5 py-2.5 text-[10px] leading-relaxed text-slate-100 whitespace-pre-line max-h-[42%] overflow-hidden">
        {captionText}
      </div>
    </div>
  );

  const renderClickableLinkScreenPreview = () => {
    const fontClass =
      fontStyle === 1
        ? 'font-serif'
        : fontStyle === 2
        ? 'italic font-serif'
        : fontStyle === 5
        ? 'font-extrabold tracking-tight'
        : 'font-sans';

    return (
      <div
        className={`w-full h-full flex flex-col justify-center items-center p-3 text-white select-none ${fontClass}`}
        style={{ backgroundColor: activeTheme.bgHex }}
      >
        <div className="w-full rounded-xl bg-black/35 border border-white/15 p-2 flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-md bg-white shrink-0 flex items-center justify-center overflow-hidden p-0.5">
            {imageUrl && !imgErrorMap['thumb'] ? (
              <img
                src={imageUrl}
                alt={title}
                referrerPolicy="no-referrer"
                onError={() => setImgErrorMap((m) => ({ ...m, thumb: true }))}
                className="w-full h-full object-contain"
              />
            ) : (
              <ImageIcon className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold truncate">{platform}</div>
            <div className="text-[10px] text-white/75 truncate">{linkDomain}</div>
          </div>
        </div>

        <div className="text-center space-y-1.5 text-[11px] leading-snug px-1">
          <div className="font-semibold line-clamp-3">{title}</div>
          <div className="text-emerald-300 font-bold tabular-nums">
            {parsedOrig > parsedDisc ? `De ${formatBrlPlain(parsedOrig)} por ` : 'Por apenas '}
            {formatBrlPlain(parsedDisc)}
            {computedPct > 0 ? ` (${computedPct}% OFF)` : ''}
          </div>
          {couponCode.trim() && (
            <div className="text-amber-200 font-semibold">
              Cupom: {couponCode.trim().toUpperCase()}
            </div>
          )}
          <div className="pt-1 text-sky-300 underline break-all text-[10px]">
            {affiliateUrl}
          </div>
        </div>
      </div>
    );
  };

  const renderVideoScreenPreview = () => (
    <div className="w-full h-full bg-slate-950 flex flex-col justify-between p-3 text-white select-none">
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>Status Vídeo MP4</span>
        <span>Reels / Shopee</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-2">
        <div className="w-12 h-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
          <Film className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="text-[11px] font-medium text-slate-200 line-clamp-2">
          {videoUrl.trim()
            ? 'Vídeo extraído em MP4 pronto para Status'
            : 'Cole um link de vídeo acima para testar'}
        </div>
      </div>
      <div className="bg-black/70 rounded-lg p-2 text-[10px] text-slate-200 line-clamp-3">
        {previewTexts.shortCalloutCaption}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Teste de Status do WhatsApp
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Compare o visual de cada formato e dispare testes isolados para o seu próprio número
            antes de escolher o padrão definitivo.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refreshLiveSessions()}
          disabled={loadingSessions}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loadingSessions ? 'animate-spin' : ''}`} />
          <span>Atualizar Contas ({openCount} conectada{openCount === 1 ? '' : 's'})</span>
        </button>
      </div>

      {/* Config Panel: Offer Draft + Safe Audience + Visual Theme */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                1. Oferta e Público Seguro do Teste
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Padrão de segurança ativo: envia somente para os seus números conectados e
                números de teste digitados abaixo.
              </p>
            </div>
          </div>

          {products.length > 0 && (
            <div className="flex items-center gap-2 min-w-0">
              <label
                htmlFor="status-prod-picker"
                className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
              >
                Puxar do catálogo:
              </label>
              <select
                id="status-prod-picker"
                value={selectedProductId}
                onChange={(e) => applyProductToDraft(e.target.value)}
                className="max-w-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              >
                <option value="">Selecionar produto salvo...</option>
                {products.slice(0, 40).map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.platform}] {p.title.slice(0, 48)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Column 1: Product Content */}
          <div className="space-y-3 lg:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Título da Oferta
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Loja
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as Marketplace)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                >
                  {MARKETPLACES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Preço De (R$)
                </label>
                <input
                  type="text"
                  value={originalPrice}
                  onChange={(e) => setOriginalPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Preço Por (R$)
                </label>
                <input
                  type="text"
                  value={discountPrice}
                  onChange={(e) => setDiscountPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Cupom (opcional)
                </label>
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Ex: OFERTA10"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Link de Afiliado
                </label>
                <input
                  type="text"
                  value={affiliateUrl}
                  onChange={(e) => setAffiliateUrl(e.target.value)}
                  placeholder="https://meli.la/..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  URL da Foto do Produto (usada no Card, Foto e Miniatura)
                </label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setImgErrorMap({});
                  }}
                  placeholder="https://http2.mlstatic.com/..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  URL do Vídeo (só para testar a opção Vídeo + Link)
                </label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="Link Reels, Shopee Vídeo, TikTok ou .mp4"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                />
              </div>
            </div>
          </div>

          {/* Column 2: Sending Account, Safe Recipients & Theme */}
          <div className="space-y-3 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Conta WhatsApp que vai postar
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              >
                {connectedAccounts.map((acc) => (
                  <option key={acc.accountId} value={acc.accountId}>
                    {acc.label} {acc.phone ? `(${acc.phone})` : ''} ·{' '}
                    {acc.open ? 'Conectado' : 'Desconectado'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Quem poderá ver este Status de teste
              </label>
              <select
                value={audienceMode}
                onChange={(e) =>
                  setAudienceMode(e.target.value as WhatsAppStatusAudienceMode)
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              >
                <option value="self_and_test">
                  Somente meus números conectados + números de teste (Seguro)
                </option>
                <option value="test_group">
                  Participantes de 1 grupo específico
                </option>
                <option value="all_group_contacts">
                  Todos os contatos dos meus grupos (Produção)
                </option>
              </select>
            </div>

            {audienceMode === 'test_group' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Grupo cujos membros verão o Status
                </label>
                <select
                  value={testGroupJid}
                  onChange={(e) => setTestGroupJid(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                >
                  <option value="">Selecionar grupo...</option>
                  {waGroups.map((g) => (
                    <option key={g.id} value={g.remoteJid}>
                      {g.name} ({g.membersCount} membros)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Números extras para visualizar o teste (opcional)
              </label>
              <input
                type="text"
                value={testPhonesInput}
                onChange={(e) => setTestPhonesInput(e.target.value)}
                placeholder="Ex: 87 99999-9999, 11 98888-7777"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Cor do Card / Fundo
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {WHATSAPP_STATUS_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      title={t.label}
                      onClick={() => setThemeColor(t.id)}
                      className={`w-7 h-7 rounded-lg border-2 transition-transform ${
                        themeColor === t.id
                          ? 'border-slate-900 dark:border-white scale-110'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: t.bgHex }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  Fonte (Status Link)
                </label>
                <select
                  value={fontStyle}
                  onChange={(e) => setFontStyle(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  {WHATSAPP_STATUS_FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* All 6 Separate Test Options */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              2. Escolha e teste cada formato separadamente
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cada card abaixo envia apenas o respectivo formato para o Status do WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateRealCardPreview()}
            disabled={renderingCard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            {renderingCard ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>Regerar Arte 1080×1920</span>
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {WHATSAPP_STATUS_FORMATS.map((fmt, idx) => {
            const isSending = sendingFormat === fmt.id;
            const isCombo = fmt.screensCount === 2;

            return (
              <article
                key={fmt.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  {/* Quiet Header Metadata + Title */}
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Opção 0{idx + 1}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{fmt.badge}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {fmt.screensCount} {fmt.screensCount === 1 ? 'tela' : 'telas em sequência'}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                      {fmt.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {fmt.summary}
                    </p>
                  </div>

                  {/* Live 9:16 Visual Previews */}
                  <div
                    className={`flex items-stretch justify-center gap-3 py-2 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-100 dark:border-slate-800 px-3`}
                  >
                    {fmt.id === 'combo-card-then-link' && (
                      <>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 1 · Arte 9:16
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                            {renderStoryCardVisualPreview('Link clicável no próximo Status ->')}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 2 · Link Clicável
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            {renderClickableLinkScreenPreview()}
                          </div>
                        </div>
                      </>
                    )}

                    {fmt.id === 'link-text-card' && (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Status Único · Fundo Colorido + Prévia + Link Clicável
                        </span>
                        <div className="w-[168px] h-[298px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                          {renderClickableLinkScreenPreview()}
                        </div>
                      </div>
                    )}

                    {fmt.id === 'story-card-photo' && (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Status Único · Arte 1080×1920 + Link na Legenda
                        </span>
                        <div className="w-[168px] h-[298px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900">
                          {renderStoryCardVisualPreview('Confira o link abaixo na legenda')}
                        </div>
                      </div>
                    )}

                    {fmt.id === 'raw-photo-caption' && (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Status Único · Foto Original + Legenda
                        </span>
                        <div className="w-[168px] h-[298px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                          {renderRawPhotoScreenPreview(previewTexts.fullCaption)}
                        </div>
                      </div>
                    )}

                    {fmt.id === 'combo-raw-then-link' && (
                      <>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 1 · Foto Limpa
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            {renderRawPhotoScreenPreview(previewTexts.shortCalloutCaption)}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 2 · Link Clicável
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            {renderClickableLinkScreenPreview()}
                          </div>
                        </div>
                      </>
                    )}

                    {fmt.id === 'video-plus-link' && (
                      <>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 1 · Vídeo MP4
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            {renderVideoScreenPreview()}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Status 2 · Link Clicável
                          </span>
                          <div className="w-[156px] h-[277px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                            {renderClickableLinkScreenPreview()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Specs Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                    <div className="text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        Link clicável:
                      </span>{' '}
                      {fmt.clickableLink}
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        Ponto forte:
                      </span>{' '}
                      {fmt.pros}
                    </div>
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{fmt.tradeoff}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    {isCombo ? (
                      <Layers className="w-3.5 h-3.5" />
                    ) : fmt.id === 'link-text-card' ? (
                      <Link2 className="w-3.5 h-3.5" />
                    ) : (
                      <Smartphone className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {audienceMode === 'self_and_test'
                        ? 'Teste privado (só seus números)'
                        : audienceMode === 'test_group'
                        ? 'Membros do grupo escolhido'
                        : 'Todos contatos dos grupos'}
                    </span>
                  </span>

                  <button
                    type="button"
                    disabled={Boolean(sendingFormat)}
                    onClick={() => void handleTestFormat(fmt.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>{isSending ? 'Publicando...' : 'Testar esta opção'}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Live Test History */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Histórico dos Testes Realizados Agora
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {testLogs.length} registro{testLogs.length === 1 ? '' : 's'}
          </span>
        </div>

        {testLogs.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            Clique em <strong>&ldquo;Testar esta opção&rdquo;</strong> em qualquer formato acima para
            publicar no seu WhatsApp e conferir no seu aparelho.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {testLogs.map((log) => (
              <div
                key={log.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    {log.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {log.formatTitle}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 pl-6">
                    Conta: {log.accountName} · Visível para {log.recipientCount} contato(s)
                    {log.recipientPreview.length > 0
                      ? ` (${log.recipientPreview.join(', ')})`
                      : ''}
                    {log.postedSteps.length > 0 ? ` · ${log.postedSteps.join(' + ')}` : ''}
                    {log.error ? ` · Erro: ${log.error}` : ''}
                  </div>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-400 pl-6 sm:pl-0 shrink-0 flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{log.sentAt}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
