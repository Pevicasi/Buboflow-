import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Link2,
  DollarSign,
  FileText,
  BarChart3,
  Search,
  CheckCircle2,
  Info,
  Copy,
  Send,
  RefreshCw,
  Users,
  UserPlus,
  TrendingUp,
  ShoppingBag,
  Image as ImageIcon,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Film,
  Calendar,
  Clock,
  XCircle,
  Wallet,
  ShoppingCart,
  Target,
  Share2,
  Trophy,
  Tag,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { normalizeGroupJid, useApp } from '../context/AppContext';
import { MARKETPLACES } from '../data/initialData';
import {
  buildAffiliateLink,
  detectMarketplaceFromUrl,
  formatBRL,
} from '../utils/templateEngine';
import { ProductArtwork } from '../components/ProductArtwork';
import {
  BaileysMemberEvent,
  ExtractedVideoResponse,
  buildVideoDownloadUrl,
  convertLinkApi,
  extractVideoApi,
  fetchShopeeCommissionsApi,
  getBaileysLiveStatsApi,
} from '../utils/apiClient';
import {
  MEMBER_MONITOR_PERIODS,
  MemberMonitorPeriod,
  computeMemberMonitorSummary,
  formatLocalDateKey,
  truncateGroupOptionLabel,
} from '../utils/memberMonitorAnalytics';
import { MemberMonitorCharts } from '../components/MemberMonitorCharts';
import {
  DEFAULT_SEGMENT,
  isOwnerGroupInSegment,
  matchesSegment,
} from '../utils/segmentScoping';
import type { DispatchGroup } from '../types';
import {
  buildShopeeCommissionAnalytics,
  type ResolvedDateRange,
  type ShopeeCommissionItem,
  type ShopeeCommissionPeriod,
} from '../utils/shopeeCommissions';
import { ShopeeCommissionCharts } from '../components/ShopeeCommissionCharts';

/* ============================================================================
 * 1. DOWNLOAD DE VÍDEOS (Telas 43–44)
 * ========================================================================== */
function formatVideoFileSize(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const VideoDownloaderView: React.FC = () => {
  const { notify } = useApp();
  const [videoUrl, setVideoUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedVideoResponse | null>(null);

  const handleExtractVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = videoUrl.trim();
    if (!trimmed || extracting) return;

    setExtracting(true);
    setExtractError(null);
    setResult(null);

    try {
      const res = await extractVideoApi(trimmed);
      if (!res.ok) {
        const msg = res.error || 'Não foi possível analisar este link de vídeo.';
        setExtractError(msg);
        notify('Não foi possível extrair o vídeo', msg, 'error');
        return;
      }

      setResult(res);
      if (res.canDirectDownload && res.directMp4Url) {
        notify(
          'Vídeo pronto para download!',
          `${res.platformLabel || 'Vídeo'} localizado em MP4.`
        );
      } else {
        notify(
          'Link analisado',
          res.note || 'A plataforma restringiu o download direto sem sessão.',
          'info'
        );
      }
    } catch {
      const msg = 'Falha de comunicação com o servidor ao analisar o vídeo.';
      setExtractError(msg);
      notify('Erro ao extrair vídeo', msg, 'error');
    } finally {
      setExtracting(false);
    }
  };

  const directDownloadHref =
    result?.canDirectDownload && result.directMp4Url
      ? buildVideoDownloadUrl(result.directMp4Url, result.title || 'video-oferta', false)
      : null;

  const inlinePreviewSrc =
    result?.canDirectDownload && result.directMp4Url
      ? buildVideoDownloadUrl(result.directMp4Url, result.title || 'video-oferta', true)
      : null;

  const sizeLabel = formatVideoFileSize(result?.fileSizeBytes);

  const handleDownloadMp4 = async () => {
    if (!directDownloadHref || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(directDownloadHref);
      if (!response.ok) {
        let errMsg = `Erro HTTP ${response.status} ao baixar vídeo.`;
        try {
          const j = await response.json();
          if (j?.error) errMsg = j.error;
        } catch {
          // ignore non-JSON body
        }
        notify('Erro ao baixar vídeo', errMsg, 'error');
        return;
      }
      const blob = await response.blob();
      const safeBase = (result?.title || 'video-oferta')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 64);
      const fileName = `${safeBase || 'video-oferta'}.mp4`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      notify('Download iniciado!', `Arquivo ${fileName} salvo no dispositivo.`);
    } catch {
      // Fallback to direct anchor navigation if blob transfer was interrupted
      const link = document.createElement('a');
      link.href = directDownloadHref;
      link.download = 'video-oferta.mp4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2 pt-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Download de Vídeos
        </h1>
        <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Cole o link do vídeo para extrair o arquivo MP4 direto pelo servidor, pré-visualizar e
          baixar pronto para seus grupos.
        </p>
      </div>

      {/* Main Input Card */}
      <form
        onSubmit={handleExtractVideo}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4"
      >
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Cole o link do vídeo (Shopee, Instagram, YouTube, TikTok, Facebook, Pinterest ou .mp4)..."
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!videoUrl.trim() || extracting}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          {extracting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analisando vídeo no servidor...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Extrair e Preparar Download</span>
            </>
          )}
        </button>

        {extractError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-rose-800 dark:text-rose-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span>{extractError}</span>
          </div>
        )}

        {result && result.canDirectDownload && directDownloadHref && inlinePreviewSrc && (
          <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#15803D] dark:text-emerald-400">
                  {result.platformLabel || 'Vídeo MP4'} · Pronto para download
                  {sizeLabel ? ` (${sizeLabel})` : ''}
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                  {result.title || 'Vídeo extraído'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadMp4}
                disabled={downloading}
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Baixando MP4...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Baixar MP4</span>
                  </>
                )}
              </button>
            </div>

            <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-200/60 dark:border-slate-800">
              <video
                controls
                playsInline
                preload="metadata"
                poster={result.thumbnailUrl || undefined}
                src={inlinePreviewSrc}
                className="w-full max-h-80 object-contain mx-auto"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (result.directMp4Url) {
                    navigator.clipboard.writeText(result.directMp4Url);
                    notify('Link MP4 copiado!');
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar link MP4</span>
              </button>
              {result.cleanUrl && (
                <a
                  href={result.cleanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir original</span>
                </a>
              )}
            </div>
          </div>
        )}

        {result && !result.canDirectDownload && (
          <div className="rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0 space-y-1">
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  {result.platformLabel || 'Plataforma'} · Download direto indisponível para este link
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {result.note}
                </p>
                {result.cleanUrl && (
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate pt-1">
                    {result.cleanUrl}
                  </div>
                )}
              </div>
            </div>
            {result.cleanUrl && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(result.cleanUrl!);
                    notify('Link limpo copiado!');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar link limpo</span>
                </button>
                <a
                  href={result.cleanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir na plataforma</span>
                </a>
              </div>
            )}
          </div>
        )}
      </form>

      {/* Supported Platforms Grid (Informational, no bogus URL injection) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
        {[
          {
            name: 'Shopee Video',
            hint: 'br.shp.ee / sv.shopee',
            color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/50',
            icon: ShoppingBag,
          },
          {
            name: 'Instagram',
            hint: 'Reels / Posts / Share',
            color: 'text-pink-600 bg-pink-50 dark:bg-pink-950/50',
            icon: ImageIcon,
          },
          {
            name: 'YouTube',
            hint: 'Vídeos e Shorts',
            color: 'text-red-600 bg-red-50 dark:bg-red-950/50',
            icon: Film,
          },
          {
            name: 'Facebook',
            hint: 'fb.watch / reels / watch',
            color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/50',
            icon: Film,
          },
          {
            name: 'TikTok',
            hint: 'Sem marca d’água',
            color: 'text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800',
            icon: Film,
          },
          {
            name: 'Pinterest / MP4',
            hint: 'pin.it ou link .mp4',
            color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50',
            icon: Film,
          },
        ].map((plat) => {
          const Icon = plat.icon;
          return (
            <div
              key={plat.name}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex flex-col items-center justify-center gap-2 text-center"
            >
              <span
                className={`w-11 h-11 rounded-full flex items-center justify-center ${plat.color}`}
              >
                <Icon className="w-5 h-5" />
              </span>
              <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100">
                {plat.name}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {plat.hint}
              </span>
            </div>
          );
        })}
      </div>

      {/* Vantagens & Instruções */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
            <CheckCircle2 className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
            <span>Como funciona</span>
          </div>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>• Extração direta do arquivo MP4 pelo servidor (até 35 MB)</li>
            <li>• Pré-visualização integrada antes de salvar no aparelho</li>
            <li>• Também funciona pelo Grupo de Automação usando &ldquo;video: link&rdquo;</li>
          </ul>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
            <Info className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <span>Instruções</span>
          </div>
          <ol className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <span>
                <strong>Abra o vídeo público</strong> na plataforma original.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center shrink-0">
                2
              </span>
              <span>
                <strong>Copie o link</strong> clicando em compartilhar.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-xs font-bold flex items-center justify-center shrink-0">
                3
              </span>
              <span>
                <strong>Cole acima</strong>, confira a prévia e clique em <strong>Baixar MP4</strong>.
              </span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. CONVERSÃO DE LINK (Tela 45)
 * ========================================================================== */
export const LinkConverterView: React.FC = () => {
  const {
    integrations,
    convertedLinks,
    setConvertedLinks,
    dispatchGroups,
    dispatchCustomMessage,
    notify,
  } = useApp();
  const [inputUrl, setInputUrl] = useState('');
  const [converting, setConverting] = useState(false);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    setConverting(true);
    try {
      const res = await convertLinkApi({
        url: inputUrl.trim(),
        credentials: integrations,
      });
      const platform = res.platform || detectMarketplaceFromUrl(inputUrl);
      const affiliateUrl =
        res.ok && res.affiliateUrl
          ? res.affiliateUrl
          : buildAffiliateLink(inputUrl, platform, integrations);

      const item = {
        id: `conv-${Date.now()}`,
        originalUrl: inputUrl.trim(),
        affiliateUrl,
        platform,
        createdAt: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setConvertedLinks((prev) => [item, ...prev]);
      setInputUrl('');
      notify(
        res.officialApi
          ? `Link oficial gerado na API ${platform}!`
          : `Link ${platform} convertido com sucesso!`,
        affiliateUrl
      );
    } catch {
      const platform = detectMarketplaceFromUrl(inputUrl);
      const affiliateUrl = buildAffiliateLink(inputUrl, platform, integrations);
      setConvertedLinks((prev) => [
        {
          id: `conv-${Date.now()}`,
          originalUrl: inputUrl.trim(),
          affiliateUrl,
          platform,
          createdAt: new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
        ...prev,
      ]);
      setInputUrl('');
      notify('Link convertido!', affiliateUrl);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Link2 className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Conversão de Link
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Form Card */}
        <form
          onSubmit={handleConvert}
          className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4"
        >
          <div>
            <div className="flex items-center gap-2 font-bold text-lg text-slate-900 dark:text-white">
              <Link2 className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
              <span>Gerar Link</span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Transforme links de produtos em links de afiliado rastreáveis com suas tags
              configuradas.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              Link do Produto
            </label>
            <input
              type="url"
              required
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Ex: https://shopee.com.br/product/123456"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={converting}
            className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
          >
            {converting ? 'Conectando à plataforma...' : 'Converter Link'}
          </button>
        </form>

        {/* Output / History Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
          {convertedLinks.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
                <Link2 className="w-6 h-6" />
              </div>
              <div className="font-semibold text-sm text-slate-600 dark:text-slate-300">
                Nenhum link gerado
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Preencha o formulário ao lado para gerar seu link de afiliado personalizado.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="font-bold text-base text-slate-900 dark:text-white">
                Links Gerados Recentemente
              </h2>
              {convertedLinks.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      <strong>{item.platform}</strong> · Gerado às {item.createdAt}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-semibold text-[#15803D] dark:text-emerald-400 break-all">
                    {item.affiliateUrl}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(item.affiliateUrl);
                        notify('Link copiado!', item.affiliateUrl);
                      }}
                      className="flex-1 py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar Link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const activeGroups = dispatchGroups.filter((g) => g.activeForOffers);
                        dispatchCustomMessage({
                          title: `Link ${item.platform}`,
                          message: `🔥 Confira esta oferta na ${item.platform}:\n🔗 ${item.affiliateUrl}`,
                          groupsNames: activeGroups.map((g) => g.name),
                          groupIds: activeGroups.map((g) => g.id),
                          platform: item.platform,
                        });
                      }}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#15803D] text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Disparar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. COMISSÃO SHOPEE (Layout Completo BuboFlow)
 * ========================================================================== */
function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatCutoffDateBr(): string {
  const cutoff = new Date(Date.now() - 60 * 86400 * 1000);
  return cutoff.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export const CommissionReportView: React.FC = () => {
  const { integrations, notify } = useApp();
  const [period, setPeriod] = useState<ShopeeCommissionPeriod>('Mês Atual');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return toLocalYmd(d);
  });
  const [customEnd, setCustomEnd] = useState<string>(() => toLocalYmd(new Date()));
  const [statusFilter, setStatusFilter] = useState<string>('Todos os status');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const [loadingReal, setLoadingReal] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [realConversions, setRealConversions] = useState<ShopeeCommissionItem[]>([]);
  const [activeRange, setActiveRange] = useState<ResolvedDateRange | null>(null);
  const [pagesFetched, setPagesFetched] = useState<number>(0);
  const [hasMoreOnShopee, setHasMoreOnShopee] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [didInitialLoad, setDidInitialLoad] = useState(false);

  const periods: ShopeeCommissionPeriod[] = [
    'Ontem',
    'Últimos 7 dias',
    'Mês Atual',
    'Mês Anterior',
    'Últimos 30 dias',
    'Personalizado',
  ];

  const hasShopeeCreds = Boolean(
    integrations.shopee.appId?.trim() &&
      integrations.shopee.apiSecret?.trim() &&
      !integrations.shopee.apiSecret.trim().startsWith('shp_live_98a7')
  );

  // Filter conversions by selected status first so KPIs, charts & rankings stay consistent
  const statusScopedConversions = useMemo(() => {
    if (statusFilter === 'Concluídos') {
      return realConversions.filter((c) => c.status === 'Concluído');
    }
    if (statusFilter === 'Pendentes') {
      return realConversions.filter((c) => c.status === 'Pendente');
    }
    if (statusFilter === 'Cancelados') {
      return realConversions.filter((c) => c.status === 'Cancelado');
    }
    if (statusFilter === 'Não pagos') {
      return realConversions.filter((c) => c.status === 'Não pago');
    }
    return realConversions;
  }, [realConversions, statusFilter]);

  const analytics = useMemo(
    () => buildShopeeCommissionAnalytics(statusScopedConversions),
    [statusScopedConversions]
  );

  const fullAnalytics = useMemo(
    () => buildShopeeCommissionAnalytics(realConversions),
    [realConversions]
  );

  const filteredTableConversions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statusScopedConversions;
    return statusScopedConversions.filter((c) => {
      const hay = `${c.product} ${c.orderId || ''} ${c.id} ${c.category} ${c.subId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [statusScopedConversions, search]);

  const totalPages = Math.max(1, Math.ceil(filteredTableConversions.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedConversions = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTableConversions.slice(start, start + pageSize);
  }, [filteredTableConversions, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, search, period]);

  const handleSyncCommissions = async (
    targetPeriod: ShopeeCommissionPeriod = period,
    options?: { silent?: boolean; start?: string; end?: string }
  ) => {
    setLoadingReal(true);
    setLastError(null);
    try {
      const res = await fetchShopeeCommissionsApi({
        credentials: integrations,
        period: targetPeriod,
        ...(targetPeriod === 'Personalizado'
          ? { startDate: options?.start ?? customStart, endDate: options?.end ?? customEnd }
          : {}),
        maxPages: 10,
      });
      if (res.ok && Array.isArray(res.conversions)) {
        setRealConversions(res.conversions);
        setActiveRange(res.range || null);
        setPagesFetched(Number(res.pagesFetched) || 1);
        setHasMoreOnShopee(Boolean(res.hasMore));
        setLastSyncedAt(res.syncedAt ? new Date(res.syncedAt) : new Date());
        setCurrentPage(1);
        if (!options?.silent) {
          notify(
            'Comissões Shopee atualizadas!',
            `${res.conversions.length} pedido(s) em ${res.range?.label || targetPeriod}.`
          );
        }
      } else {
        const msg =
          res.error ||
          'Configure seu App ID e Senha API reais da Shopee em Configurações → Plataformas.';
        setLastError(msg);
        if (!options?.silent) {
          notify('Não foi possível consultar a Shopee', msg, 'info');
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Erro de rede ao consultar comissões na Shopee.';
      setLastError(msg);
      if (!options?.silent) {
        notify('Erro ao sincronizar comissões', msg, 'error');
      }
    } finally {
      setLoadingReal(false);
    }
  };

  // Auto-load real Shopee commissions on first open when credentials are saved
  useEffect(() => {
    if (!didInitialLoad && hasShopeeCreds) {
      setDidInitialLoad(true);
      void handleSyncCommissions('Mês Atual', { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didInitialLoad, hasShopeeCreds]);

  const handleSelectPeriod = (p: ShopeeCommissionPeriod) => {
    setPeriod(p);
    if (p !== 'Personalizado' && hasShopeeCreds) {
      void handleSyncCommissions(p);
    }
  };

  const handleCopyProductLink = async (url?: string, name?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify('Link do produto copiado!', name?.slice(0, 60));
    } catch {
      notify('Não foi possível copiar automaticamente', url, 'info');
    }
  };

  const handleExportCsv = () => {
    if (filteredTableConversions.length === 0) return;
    const escapeCsv = (val: string | number | undefined) =>
      `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = [
      'ID Conversão',
      'Pedido',
      'Data (BRT)',
      'Produto',
      'Categoria',
      'Sub ID',
      'Atribuição',
      'Itens',
      'GMV (R$)',
      'Comissão Shopee (R$)',
      'Comissão Vendedor (R$)',
      'Comissão Líquida (R$)',
      'Status',
    ];
    const rows = filteredTableConversions.map((c) => [
      escapeCsv(c.id),
      escapeCsv(c.orderId || ''),
      escapeCsv(c.purchaseDateBr || ''),
      escapeCsv(c.product),
      escapeCsv(c.category),
      escapeCsv(c.subId),
      escapeCsv(c.attribution),
      escapeCsv(c.qty),
      escapeCsv(c.salesAmount.toFixed(2).replace('.', ',')),
      escapeCsv(c.shopeeCommission.toFixed(2).replace('.', ',')),
      escapeCsv(c.sellerCommission.toFixed(2).replace('.', ',')),
      escapeCsv(c.commission.toFixed(2).replace('.', ',')),
      escapeCsv(c.status),
    ]);
    const csv = '\uFEFF' + [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comissoes-shopee-${activeRange?.startDateStr || 'relatorio'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Relatório CSV exportado!', `${filteredTableConversions.length} linha(s) incluídas.`);
  };

  const syncMinutesAgo = lastSyncedAt
    ? Math.max(0, Math.floor((Date.now() - lastSyncedAt.getTime()) / 60000))
    : null;
  const syncStatusLabel = lastSyncedAt
    ? `Atualizado ${syncMinutesAgo === 0 ? 'agora' : `há ${syncMinutesAgo} min`}${
        fullAnalytics.latestSaleDateShort
          ? ` · vendas até ${fullAnalytics.latestSaleDateShort}`
          : ''
      }`
    : hasShopeeCreds
    ? 'Pronto para sincronizar com sua API Shopee'
    : 'Configure seu App ID e Senha API em Configurações → Plataformas';

  const renderProgressSplit = (shopeeVal: number, sellerVal: number) => {
    const total = shopeeVal + sellerVal;
    const shopeePct = total > 0 ? Math.min(100, (shopeeVal / total) * 100) : 100;
    return (
      <div className="space-y-2 pt-2">
        <div className="h-2 w-full rounded-full bg-emerald-100 dark:bg-emerald-950/60 overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${total > 0 ? shopeePct : 0}%` }}
          />
          {total > 0 && sellerVal > 0 && (
            <div
              className="h-full bg-emerald-800 dark:bg-emerald-300 transition-all"
              style={{ width: `${100 - shopeePct}%` }}
            />
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Shopee R$ {formatBRL(shopeeVal)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-800 dark:bg-emerald-300" />
            Vendedor R$ {formatBRL(sellerVal)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Comissão Shopee
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Acompanhe suas comissões, vendas e desempenho na Shopee.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">{syncStatusLabel}</span>
          <div className="flex items-center gap-2">
            {filteredTableConversions.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            )}
            <button
              type="button"
              disabled={loadingReal}
              onClick={() => void handleSyncCommissions(period)}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingReal ? 'animate-spin text-[#15803D]' : ''}`} />
              <span>{loadingReal ? 'Atualizando...' : 'Atualizar dados'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Period Buttons + Custom Date Pickers + Status Dropdown */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleSelectPeriod(p)}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                period === p
                  ? 'bg-[#15803D] text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {period === 'Personalizado' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 flex-1 max-w-md">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Data inicial"
                className="w-full min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs sm:text-sm tabular-nums"
              />
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Data final"
                className="w-full min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 text-xs sm:text-sm tabular-nums"
              />
            </div>
            <button
              type="button"
              disabled={loadingReal}
              onClick={() => void handleSyncCommissions('Personalizado')}
              className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              <Calendar className="w-4 h-4" />
              <span>Consultar período</span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm font-medium"
          >
            <option value="Todos os status">Todos os status</option>
            <option value="Concluídos">
              Concluídos ({fullAnalytics.statusCounts.completed})
            </option>
            <option value="Pendentes">
              Pendentes ({fullAnalytics.statusCounts.pending})
            </option>
            <option value="Cancelados">
              Cancelados ({fullAnalytics.statusCounts.cancelled})
            </option>
            <option value="Não pagos">
              Não pagos ({fullAnalytics.statusCounts.unpaid})
            </option>
          </select>

          {activeRange && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {activeRange.label} • {pagesFetched} pág.
              {hasMoreOnShopee ? ' (limite de 500 conversões atingido)' : ''}
            </span>
          )}
        </div>

        <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Vendas anteriores a {formatCutoffDateBr()} não são mais atualizadas pela Shopee.
          </span>
        </div>
      </div>

      {lastError && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-xs sm:text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{lastError}</span>
        </div>
      )}

      {/* 6 Primary KPI Cards (BuboFlow style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Comissão Líquida */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                <DollarSign className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Comissão Líquida
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  R$ {formatBRL(analytics.netCommission)}
                </div>
              </div>
            </div>
            <span title="Soma das comissões líquidas de pedidos concluídos e pendentes.">
              <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </span>
          </div>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                POR PEDIDO
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 tabular-nums">
                R$ {formatBRL(analytics.commissionPerOrder)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                % DO GMV
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 tabular-nums">
                {analytics.commissionRateOfGmv.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* 2. GMV (Vendido) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  GMV (Vendido)
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  R$ {formatBRL(analytics.validGmv)}
                </div>
              </div>
            </div>
            <span title="Valor bruto total vendido nos pedidos válidos do período.">
              <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </span>
          </div>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                ITENS VENDIDOS
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 tabular-nums">
                {analytics.validItemsSold}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                PREÇO MÉDIO POR ITEM
              </div>
              <div className="font-bold text-slate-800 dark:text-slate-100 mt-0.5 tabular-nums">
                R$ {formatBRL(analytics.avgPricePerItem)}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Pedidos Válidos */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Pedidos Válidos
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                {analytics.validOrders}
              </div>
            </div>
          </div>
          <span title="Pedidos concluídos ou pendentes de validação.">
            <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
          </span>
        </div>

        {/* 4. Ticket Médio */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ticket Médio
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                R$ {formatBRL(analytics.avgTicket)}
              </div>
            </div>
          </div>
          <span title="GMV total dividido pela quantidade de pedidos válidos.">
            <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
          </span>
        </div>

        {/* 5. Taxa de Realização */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Taxa de Realização
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                {analytics.realizationRate.toFixed(1)}%
              </div>
            </div>
          </div>
          <span title="Percentual de pedidos válidos em relação ao total de pedidos gerados.">
            <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
          </span>
        </div>

        {/* 6. Pedidos Inválidos */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Pedidos Inválidos
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                {analytics.invalidOrders}
              </div>
            </div>
          </div>
          <span title="Pedidos cancelados ou não pagos que não geram comissão.">
            <Info className="w-4 h-4 text-slate-300 dark:text-slate-600" />
          </span>
        </div>
      </div>

      {/* Status dos pedidos */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            Status dos pedidos
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Entenda em qual etapa cada venda está.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: 'Concluídos',
              desc: 'Comissão liberada',
              count: analytics.statusCounts.completed,
              dot: 'bg-emerald-500',
            },
            {
              label: 'Pendentes',
              desc: 'Aguardando confirmação',
              count: analytics.statusCounts.pending,
              dot: 'bg-amber-400',
            },
            {
              label: 'Cancelados',
              desc: 'Sem comissão',
              count: analytics.statusCounts.cancelled,
              dot: 'bg-rose-500',
            },
            {
              label: 'Não pagos',
              desc: 'Sem pagamento registrado',
              count: analytics.statusCounts.unpaid,
              dot: 'bg-sky-500',
            },
          ].map((row) => (
            <div
              key={row.label}
              className="rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-4 py-3.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${row.dot}`} />
                <div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-white">
                    {row.label}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{row.desc}</div>
                </div>
              </div>
              <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                {row.count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Venda Direta / Venda Indireta / Composição da Comissão */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Venda direta */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Target className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                Venda direta
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg whitespace-nowrap tabular-nums">
              {analytics.directSales.sharePercent.toFixed(1)}% da comissão
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                RECEITA (GMV)
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                R$ {formatBRL(analytics.directSales.gmv)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                COMISSÃO
              </div>
              <div className="text-lg font-bold text-[#15803D] dark:text-emerald-400 tabular-nums mt-0.5">
                R$ {formatBRL(analytics.directSales.commission)}
              </div>
            </div>
          </div>

          {renderProgressSplit(
            analytics.directSales.shopeeCommission,
            analytics.directSales.sellerCommission
          )}
        </div>

        {/* Venda indireta */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Share2 className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                Venda indireta
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg whitespace-nowrap tabular-nums">
              {analytics.indirectSales.sharePercent.toFixed(1)}% da comissão
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                RECEITA (GMV)
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                R$ {formatBRL(analytics.indirectSales.gmv)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                COMISSÃO
              </div>
              <div className="text-lg font-bold text-[#15803D] dark:text-emerald-400 tabular-nums mt-0.5">
                R$ {formatBRL(analytics.indirectSales.commission)}
              </div>
            </div>
          </div>

          {renderProgressSplit(
            analytics.indirectSales.shopeeCommission,
            analytics.indirectSales.sellerCommission
          )}
        </div>

        {/* Composição da comissão */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Composição da comissão
            </h3>
          </div>

          <div className="pt-1">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              COMISSÃO TOTAL
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
              R$ {formatBRL(analytics.composition.totalCommission)}
            </div>
          </div>

          {renderProgressSplit(
            analytics.composition.shopeeCommission,
            analytics.composition.sellerCommission
          )}
        </div>
      </div>

      {/* Charts: Comissão ao longo do tempo + Vendas ao longo do tempo */}
      <ShopeeCommissionCharts analytics={analytics} />

      {/* Rankings: Comissão por Sub ID & Top Categorias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Comissão por Sub ID */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Comissão por Sub ID
            </h3>
          </div>
          {analytics.bySubId.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              Nenhuma comissão por Sub ID neste período.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.bySubId.slice(0, 8).map((row, idx) => (
                <div
                  key={row.subId}
                  className="rounded-xl bg-slate-50/90 dark:bg-slate-800/50 px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xs font-bold text-slate-400 tabular-nums">
                      #{idx + 1}
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      {row.subId}
                    </span>
                  </div>
                  <span className="font-bold text-[#15803D] dark:text-emerald-400 tabular-nums whitespace-nowrap">
                    R$ {formatBRL(row.commission)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top categorias */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Top categorias
            </h3>
          </div>
          {analytics.topCategories.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              Nenhuma categoria registrada neste período.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.topCategories.slice(0, 8).map((row, idx) => (
                <div
                  key={row.category}
                  className="rounded-xl bg-slate-50/90 dark:bg-slate-800/50 px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xs font-bold text-slate-400 tabular-nums">
                      #{idx + 1}
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      {row.category}
                    </span>
                  </div>
                  <span className="font-bold text-[#15803D] dark:text-emerald-400 tabular-nums whitespace-nowrap">
                    R$ {formatBRL(row.commission)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top produtos */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
          <h3 className="font-bold text-base text-slate-900 dark:text-white">Top produtos</h3>
        </div>
        {analytics.topProducts.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            Nenhum produto com comissão válida neste período.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {analytics.topProducts.slice(0, 10).map((prod, idx) => (
              <div
                key={prod.key}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-sm font-bold text-slate-400 w-6 shrink-0 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  {prod.imageUrl ? (
                    <img
                      src={prod.imageUrl}
                      alt={prod.name}
                      loading="lazy"
                      className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-50"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                      <ShoppingBag className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-slate-900 dark:text-white line-clamp-1">
                      {prod.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      R$ {formatBRL(prod.unitPrice)} · {prod.commissionRatePercent.toFixed(1)}% de
                      comissão · {prod.qtySold} vendido{prod.qtySold > 1 ? 's' : ''} · R${' '}
                      {formatBRL(prod.gmv)} GMV
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 pl-9 sm:pl-0 shrink-0">
                  <div className="text-left sm:text-right">
                    <div className="font-bold text-sm text-[#15803D] dark:text-emerald-400 tabular-nums">
                      R$ {formatBRL(prod.totalCommission)}
                    </div>
                    <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                      COMISSÃO TOTAL
                    </div>
                  </div>
                  {prod.productUrl && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleCopyProductLink(prod.productUrl, prod.name)}
                        title="Copiar link do produto na Shopee"
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <a
                        href={prod.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir produto na Shopee"
                        className="p-2 rounded-lg text-slate-400 hover:text-[#15803D] dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detailed Orders Table (searchable + paginated) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Pedidos detalhados ({filteredTableConversions.length})
            </h3>
            <p className="text-xs text-slate-500">
              Lista completa das conversões retornadas pela Shopee Affiliate API.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto, pedido, Sub ID..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
            />
          </div>
        </div>

        {filteredTableConversions.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-500">
            {realConversions.length === 0
              ? 'Nenhum pedido encontrado neste período. Tente selecionar outro período ou clique em Atualizar dados.'
              : 'Nenhum pedido corresponde aos filtros atuais.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                    <th className="py-3 px-4">Produto / Pedido</th>
                    <th className="py-3 px-3 whitespace-nowrap">Data</th>
                    <th className="py-3 px-3">Categoria</th>
                    <th className="py-3 px-3 text-right">Itens</th>
                    <th className="py-3 px-3 text-right">GMV</th>
                    <th className="py-3 px-3 text-right">Comissão</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pagedConversions.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-900 dark:text-white line-clamp-1">
                          {c.product}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {c.orderId ? `#${c.orderId}` : c.id} • {c.attribution}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                        {c.purchaseDateBr || '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {c.category}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{c.qty}</td>
                      <td className="py-3 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        R$ {formatBRL(c.salesAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-[#15803D] dark:text-emerald-400 tabular-nums whitespace-nowrap">
                        R$ {formatBRL(c.commission)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg ${
                            c.status === 'Concluído'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                              : c.status === 'Pendente'
                              ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                              : c.status === 'Não pago'
                              ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400'
                              : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
              <span>
                Exibindo {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, filteredTableConversions.length)} de{' '}
                {filteredTableConversions.length} pedido(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Anterior</span>
                </button>
                <span>
                  Página {safePage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span>Próxima</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 4. HISTÓRICO DE ENVIOS (Telas 47–48)
 * ========================================================================== */
export const SentLogsView: React.FC = () => {
  const { sentLogs, dispatchCustomMessage, activeSegment, setRoute, notify } = useApp();
  const [platformFilter, setPlatformFilter] = useState('Todas as Plataformas');
  const [search, setSearch] = useState('');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [customPageSizeMode, setCustomPageSizeMode] = useState<boolean>(false);
  const [customPageSizeInput, setCustomPageSizeInput] = useState<string>('10');
  const [currentPage, setCurrentPage] = useState<number>(1);

  const filtered = sentLogs.filter((log) => {
    if (!matchesSegment(log.segment, activeSegment)) {
      return false;
    }
    if (platformFilter !== 'Todas as Plataformas' && log.platform !== platformFilter) {
      return false;
    }
    if (
      search.trim() &&
      !log.message.toLowerCase().includes(search.trim().toLowerCase()) &&
      !log.title.toLowerCase().includes(search.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSegment, platformFilter, search, pageSize]);

  const displayedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const hasPrevPage = currentPage > 1;
  const hasNextPage = currentPage * pageSize < filtered.length;

  const handlePageSizeSelect = (val: string) => {
    if (val === 'custom') {
      setCustomPageSizeMode(true);
      setCustomPageSizeInput(String(pageSize));
      return;
    }
    const parsed = Math.max(1, Math.min(200, Number(val) || 10));
    setCustomPageSizeMode(false);
    setPageSize(parsed);
  };

  const applyCustomPageSize = () => {
    const parsed = Math.max(1, Math.min(200, parseInt(customPageSizeInput, 10) || 10));
    setCustomPageSizeInput(String(parsed));
    setPageSize(parsed);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <FileText className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Envios
        </h1>
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
          {activeSegment}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="w-full sm:w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todas as Plataformas">Todas as Plataformas</option>
          {MARKETPLACES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <span className="whitespace-nowrap">Exibir:</span>
          <select
            value={customPageSizeMode ? 'custom' : [5, 10, 15, 20, 50].includes(pageSize) ? String(pageSize) : 'custom'}
            onChange={(e) => handlePageSizeSelect(e.target.value)}
            className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs font-medium tabular-nums"
          >
            <option value="5">5 por página</option>
            <option value="10">10 por página</option>
            <option value="15">15 por página</option>
            <option value="20">20 por página</option>
            <option value="50">50 por página</option>
            <option value="custom">Personalizado...</option>
          </select>
          {customPageSizeMode && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={200}
                value={customPageSizeInput}
                onChange={(e) => setCustomPageSizeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustomPageSize();
                  }
                }}
                className="w-16 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs tabular-nums"
              />
              <button
                type="button"
                onClick={applyCustomPageSize}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold"
              >
                OK
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por mensagem..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => notify('Histórico filtrado', `${filtered.length} registro(s).`, 'info')}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-sm font-semibold flex items-center gap-2 shrink-0"
        >
          <Search className="w-4 h-4" />
          <span>Pesquisar</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-16 px-6 flex flex-col items-center text-center">
          <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="font-bold text-lg text-slate-900 dark:text-white">
            Nenhum envio realizado ainda
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            Assim que você disparar ofertas ou comunicados para seus grupos reais conectados no
            WhatsApp ou Telegram, o monitoramento completo dos envios aparecerá aqui.
          </p>
          <button
            type="button"
            onClick={() => setRoute('grupos-envio')}
            className="mt-4 px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold"
          >
            Ver Grupos de Envio
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayedLogs.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="relative bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                    <ProductArtwork
                      artworkKey={item.artworkKey || 'cap'}
                      customImageUrl={item.customImageUrl}
                      alt={item.title}
                      className="w-full h-56 p-3"
                    />
                    <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-md bg-[#EA580C] text-white text-xs font-semibold shadow-xs">
                      {item.platform}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="text-xs text-slate-400 tabular-nums mb-1.5">
                      {item.sentAt} · {item.groupsNames.join(', ')}
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line line-clamp-4">
                      {item.message}
                    </p>
                  </div>
                </div>

                <div className="px-4 pb-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(item.message);
                      notify('Mensagem copiada!');
                    }}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar</span>
                  </button>
                  <button
                    type="button"
                    disabled={resendingId === item.id}
                    onClick={async () => {
                      setResendingId(item.id);
                      try {
                        await dispatchCustomMessage({
                          title: item.title,
                          message: item.message,
                          groupsNames: item.groupsNames,
                          platform: item.platform,
                          customImageUrl: item.customImageUrl,
                          segment: activeSegment,
                        });
                      } finally {
                        setResendingId(null);
                      }
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    {resendingId === item.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>{resendingId === item.id ? 'Reenviando...' : 'Reenviar'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 tabular-nums">
            <span>
              {displayedLogs.length} de {filtered.length} envio(s)
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">
              Página {currentPage}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!hasPrevPage}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Voltar</span>
              </button>
              <button
                type="button"
                disabled={!hasNextPage}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <span>Próximo</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/* ============================================================================
 * 5. MONITORAMENTO DE MEMBROS REAL (Via Baileys Multi-Device)
 * ========================================================================== */
export const MemberMonitorView: React.FC = () => {
  const { dispatchGroups, accounts, activeSegment, syncWhatsAppGroupsFromAccount, setRoute } =
    useApp();
  const [selectedGroupId, setSelectedGroupId] = useState('all');
  const [period, setPeriod] = useState<MemberMonitorPeriod>('Últimos 7 dias');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return formatLocalDateKey(d);
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => formatLocalDateKey(new Date()));
  const [memberEvents, setMemberEvents] = useState<BaileysMemberEvent[]>([]);
  const [cachedFallbackGroups, setCachedFallbackGroups] = useState<DispatchGroup[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadStats = async () => {
    try {
      const res = await getBaileysLiveStatsApi();
      if (res.ok) {
        if (Array.isArray(res.memberEvents)) {
          setMemberEvents(res.memberEvents);
        }
        if (Array.isArray(res.cachedGroups) && res.cachedGroups.length > 0) {
          setCachedFallbackGroups(
            res.cachedGroups.map((cg) => ({
              id: `grp-wa-${normalizeGroupJid(cg.remoteJid).replace(/[^a-zA-Z0-9]/g, '')}`,
              name: cg.name,
              channel: 'WhatsApp',
              accountId: cg.accountId || 'acc-wa-1',
              accountName: 'WhatsApp',
              remoteJid: normalizeGroupJid(cg.remoteJid),
              activeForOffers: false,
              isPriorityCapture: false,
              isChannel: false,
              membersCount: cg.membersCount,
              maxCapacity: 1024,
              inviteUrl: 'https://chat.whatsapp.com/',
              segment: 'Geral',
              isOwner: cg.isOwner,
              isAdmin: cg.isAdmin,
              isOwnerOrAdmin: cg.isOwnerOrAdmin,
            }))
          );
        }
      }
    } catch {
      // Ignore network error
    }
  };

  // Detect whether WhatsApp groups still lack owner/admin metadata (e.g., from before this update)
  const needsRoleSync = useMemo(
    () =>
      dispatchGroups.length === 0 ||
      dispatchGroups.some((g) => g.channel === 'WhatsApp' && g.isOwnerOrAdmin === undefined),
    [dispatchGroups]
  );

  // Auto-load stats & trigger silent WhatsApp group sync on mount (or if role metadata is missing), then keep stats fresh every 15s
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      await loadStats();
      if (!active) return;
      if (needsRoleSync) {
        setSyncing(true);
        try {
          await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
          if (active) await loadStats();
        } finally {
          if (active) setSyncing(false);
        }
      }
    };
    void bootstrap();
    const timer = setInterval(() => {
      void loadStats();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [needsRoleSync, syncWhatsAppGroupsFromAccount]);

  const effectiveGroups = useMemo(
    () => (dispatchGroups.length > 0 ? dispatchGroups : cachedFallbackGroups),
    [dispatchGroups, cachedFallbackGroups]
  );

  const segmentEffectiveGroups = useMemo(
    () => effectiveGroups.filter((g) => isOwnerGroupInSegment(g, activeSegment)),
    [effectiveGroups, activeSegment]
  );

  const handleRefreshLive = async () => {
    setSyncing(true);
    try {
      await syncWhatsAppGroupsFromAccount(undefined, { silent: false });
      await loadStats();
    } finally {
      setSyncing(false);
    }
  };

  const summary = useMemo(
    () =>
      computeMemberMonitorSummary({
        groups: segmentEffectiveGroups,
        memberEvents,
        selectedGroupId,
        period,
        customStartDate,
        customEndDate,
        onlyOwnerOrAdmin: true,
      }),
    [segmentEffectiveGroups, memberEvents, selectedGroupId, period, customStartDate, customEndDate]
  );

  const {
    ownedGroupsCount,
    targetGroups,
    totalParticipants,
    todayStats,
    periodStats,
    perGroupBreakdown,
  } = summary;

  useEffect(() => {
    if (selectedGroupId !== 'all' && !perGroupBreakdown.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId('all');
    }
  }, [perGroupBreakdown, selectedGroupId]);

  const hasConnectedWa = accounts.some((a) => a.channel === 'WhatsApp' && a.connected);

  // Use today's stats for the top "Saldo Diário" & "Churn Diário" cards on live periods (matching BuboFlow),
  // and period stats when explicitly inspecting past/custom windows (Ontem / Mês Anterior / Personalizado).
  const isHistoricalSlice =
    period === 'Ontem' || period === 'Mês Anterior' || period === 'Personalizado';
  const kpiNet = isHistoricalSlice ? periodStats.net : todayStats.net;
  const kpiEntries = isHistoricalSlice ? periodStats.entries : todayStats.entries;
  const kpiExits = isHistoricalSlice ? periodStats.exits : todayStats.exits;
  const kpiChurnLabel = isHistoricalSlice ? periodStats.churnLabel : todayStats.churnLabel;

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0 max-w-full overflow-x-hidden">
      {/* Header matching BuboFlow */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <BarChart3 className="w-6 h-6 text-[#15803D] dark:text-emerald-400 shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white break-words min-w-0">
              Monitoramento de Membros
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">
            Acompanhe o crescimento e engajamento dos seus grupos.
          </p>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleRefreshLive()}
          className="w-full sm:w-auto justify-center px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 shrink-0 ${syncing ? 'animate-spin text-[#15803D]' : ''}`} />
          <span>{syncing ? 'Atualizando...' : 'Atualizar Grupos'}</span>
        </button>
      </div>

      {/* Empty states: not connected vs connected with 0 owner/admin groups */}
      {effectiveGroups.length === 0 ? (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            {hasConnectedWa ? (
              <span>
                Seu WhatsApp está conectado! Clique em <strong>Atualizar Grupos</strong> para
                carregar os grupos em que você é dono ou administrador.
              </span>
            ) : (
              <span>
                Nenhum grupo sincronizado ainda. Conecte seu WhatsApp em{' '}
                <strong>Canais → WhatsApp</strong> para monitorar os grupos em que você é dono ou
                administrador.
              </span>
            )}
          </div>
          {!hasConnectedWa && (
            <button
              type="button"
              onClick={() => setRoute('whatsapp')}
              className="px-3.5 py-2 rounded-xl bg-[#15803D] text-white text-xs font-semibold shrink-0"
            >
              Conectar WhatsApp
            </button>
          )}
        </div>
      ) : ownedGroupsCount === 0 ? (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            {activeSegment !== DEFAULT_SEGMENT ? (
              <span>
                Nenhum grupo onde você é <strong>dono ou administrador</strong> está ativado no
                segmento <strong>{activeSegment}</strong>. Ative os grupos deste nicho em{' '}
                <strong>Grupos de Envio</strong> para acompanhar seus membros separadamente aqui.
              </span>
            ) : (
              <span>
                Nenhum grupo em que você é <strong>dono ou administrador</strong> foi encontrado na
                conta conectada. O monitoramento de membros acompanha apenas grupos gerenciados por
                você (grupos de terceiros em que você é apenas participante são filtrados
                automaticamente).
              </span>
            )}
          </div>
          {activeSegment !== DEFAULT_SEGMENT ? (
            <button
              type="button"
              onClick={() => setRoute('grupos-envio')}
              className="px-3.5 py-2 rounded-xl bg-[#15803D] text-white text-xs font-semibold shrink-0"
            >
              Ir para Grupos de Envio
            </button>
          ) : (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleRefreshLive()}
              className="px-3.5 py-2 rounded-xl bg-[#15803D] text-white text-xs font-semibold shrink-0 disabled:opacity-60"
            >
              Verificar novamente
            </button>
          )}
        </div>
      ) : null}

      {/* Group Filter Select (Owner/Admin groups only) */}
      <div className="min-w-0 max-w-full">
        <label htmlFor="member-monitor-group-select" className="sr-only">
          Filtrar por grupo em que você é dono ou admin
        </label>
        <select
          id="member-monitor-group-select"
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className="w-full max-w-full sm:w-96 min-w-0 truncate rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100"
        >
          <option value="all">Todos os Grupos ({ownedGroupsCount})</option>
          {perGroupBreakdown.map((g) => (
            <option key={g.id} value={g.id}>
              {truncateGroupOptionLabel(g.name, 34)} ({g.membersCount.toLocaleString('pt-BR')} ·{' '}
              {g.isOwner ? 'Dono' : 'Admin'})
            </option>
          ))}
        </select>
      </div>

      {/* 4 BuboFlow KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Total de Grupos</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5 text-slate-900 dark:text-white">
              {targetGroups.length.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Dono ou Admin</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <UserPlus className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Total de Participantes</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5 text-slate-900 dark:text-white">
              {totalParticipants.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">Nos seus grupos</div>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">
              {isHistoricalSlice ? `Saldo (${periodStats.labelSuffix})` : 'Saldo Diário'}
            </div>
            <div
              className={`text-2xl font-bold tabular-nums mt-0.5 ${
                kpiNet > 0
                  ? 'text-[#15803D] dark:text-emerald-400'
                  : kpiNet < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {kpiNet > 0 ? `+${kpiNet}` : kpiNet}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
              +{kpiEntries} entr. · -{kpiExits} saíd.
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500">
              {isHistoricalSlice ? `Churn (${periodStats.labelSuffix})` : 'Churn Diário'}
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5 text-slate-900 dark:text-white">
              {kpiChurnLabel}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
              {!isHistoricalSlice && period !== 'Hoje'
                ? `Período: ${periodStats.churnLabel} (${periodStats.exits} saíd.)`
                : `${kpiExits} saída(s) / ${kpiEntries} entrada(s)`}
            </div>
          </div>
        </div>
      </div>

      {/* 7 Period Filter Buttons (including Personalizado) */}
      <div className="space-y-3 min-w-0">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          {MEMBER_MONITOR_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium text-center transition-colors ${
                period === p
                  ? 'bg-[#15803D] text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {period === 'Personalizado' && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="member-monitor-start-date"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                Data Inicial
              </label>
              <input
                id="member-monitor-start-date"
                type="date"
                value={customStartDate}
                max={customEndDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label
                htmlFor="member-monitor-end-date"
                className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                Data Final
              </label>
              <input
                id="member-monitor-end-date"
                type="date"
                value={customEndDate}
                min={customStartDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Compact List of Monitored Owner/Admin Groups */}
      {perGroupBreakdown.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Seus Grupos Monitorados ({perGroupBreakdown.length})
            </h2>
            {selectedGroupId !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedGroupId('all')}
                className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
              >
                Ver todos os grupos
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {perGroupBreakdown.map((g) => {
              const isSelected = selectedGroupId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroupId(isSelected ? 'all' : g.id)}
                  className={`w-full text-left py-3 px-2.5 -mx-2.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition-colors ${
                    isSelected
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {g.name}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                          g.isOwner
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-[#15803D] dark:text-emerald-400'
                            : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {g.isOwner ? 'Dono' : 'Admin'}
                      </span>
                      {g.activeForOffers && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                          Disparo ativo
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 text-xs tabular-nums shrink-0">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {g.membersCount.toLocaleString('pt-BR')}{' '}
                      <span className="font-normal text-slate-500">membros</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#16A34A] font-semibold">+{g.entries}</span>
                      <span className="text-rose-600 font-semibold">-{g.exits}</span>
                      <span
                        className={`font-semibold px-1.5 py-0.5 rounded ${
                          g.net > 0
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400'
                            : g.net < 0
                            ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}
                      >
                        {g.net > 0 ? `+${g.net}` : g.net}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* All 6 BuboFlow Charts */}
      <MemberMonitorCharts summary={summary} />
    </div>
  );
};
