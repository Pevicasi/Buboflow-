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
  convertLinkApi,
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

/* ============================================================================
 * 1. DOWNLOAD DE VÍDEOS (Telas 43–44)
 * ========================================================================== */
export const VideoDownloaderView: React.FC = () => {
  const { notify } = useApp();
  const [videoUrl, setVideoUrl] = useState('');
  const [readyInfo, setReadyInfo] = useState<{
    platform: string;
    cleanUrl: string;
  } | null>(null);

  const detectVideoSource = (url: string): string => {
    const lower = url.toLowerCase();
    if (lower.includes('shopee') || lower.includes('sv.shopee')) return 'Shopee Video';
    if (lower.includes('instagram')) return 'Instagram Reels';
    if (lower.includes('facebook') || lower.includes('fb.watch')) return 'Facebook Video';
    if (lower.includes('pinterest') || lower.includes('pin.it')) return 'Pinterest Video';
    return 'Vídeo HD';
  };

  const handlePrepareDownload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) return;
    const source = detectVideoSource(videoUrl);
    const stripped = videoUrl.trim().split('?')[0];
    setReadyInfo({
      platform: source,
      cleanUrl: stripped,
    });
    notify('Link processado!', `${source} pronto para abertura limpa sem parâmetros.`);
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2 pt-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Download de Vídeos
        </h1>
        <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Baixe vídeos de qualquer plataforma em alta qualidade sem marca d&apos;água.
        </p>
      </div>

      {/* Main Input Card */}
      <form
        onSubmit={handlePrepareDownload}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3"
      >
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Cole o link do vídeo aqui..."
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!videoUrl.trim()}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Baixar Vídeo</span>
        </button>

        {readyInfo && (
          <div className="mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#15803D] dark:text-emerald-400">
                {readyInfo.platform} detectado (HD · Sem rastreadores)
              </div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate mt-0.5">
                {readyInfo.cleanUrl}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(readyInfo.cleanUrl);
                  notify('Link limpo copiado!');
                }}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar</span>
              </button>
              <a
                href={readyInfo.cleanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir Mídia</span>
              </a>
            </div>
          </div>
        )}
      </form>

      {/* Supported Platforms 2x2 Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {[
          { name: 'Shopee Video', color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/50' },
          { name: 'Facebook', color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/50' },
          { name: 'Instagram', color: 'text-pink-600 bg-pink-50 dark:bg-pink-950/50' },
          { name: 'Pinterest', color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50' },
        ].map((plat) => (
          <button
            key={plat.name}
            type="button"
            onClick={() =>
              setVideoUrl(
                `https://${plat.name.toLowerCase().replace(' ', '')}.com/video/achadinho`
              )
            }
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex flex-col items-center justify-center gap-2.5 hover:border-emerald-500/40 transition-colors"
          >
            <span
              className={`w-11 h-11 rounded-full flex items-center justify-center ${plat.color}`}
            >
              {plat.name === 'Shopee Video' ? (
                <ShoppingBag className="w-5 h-5" />
              ) : (
                <ImageIcon className="w-5 h-5" />
              )}
            </span>
            <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100">
              {plat.name}
            </span>
          </button>
        ))}
      </div>

      {/* Vantagens & Instruções */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
            <CheckCircle2 className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
            <span>Vantagens</span>
          </div>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>• Downloads ilimitados para seus grupos de ofertas</li>
            <li>• Download em alta qualidade para Reels e Status</li>
            <li>• Remove automaticamente parâmetros e marcas d&apos;água</li>
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
                <strong>Abra o vídeo</strong> na plataforma original.
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
                <strong>Cole acima</strong> e clique em baixar.
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
 * 3. COMISSÃO SHOPEE (Tela 46)
 * ========================================================================== */
export const CommissionReportView: React.FC = () => {
  const { integrations, notify } = useApp();
  const [period, setPeriod] = useState('Últimos 7 dias');
  const [statusFilter, setStatusFilter] = useState('Todos os status');
  const [loadingReal, setLoadingReal] = useState(false);
  const [realConversions, setRealConversions] = useState<
    { id: string; product: string; qty: number; commission: number; status: string }[]
  >([]);

  const periods = [
    'Ontem',
    'Últimos 7 dias',
    'Mês Atual',
    'Mês Anterior',
    'Últimos 30 dias',
    'Personalizado',
  ];

  const filteredConversions = realConversions.filter((c) => {
    if (statusFilter === 'Aprovadas' && c.status !== 'Aprovada') return false;
    if (statusFilter === 'Pendentes' && c.status !== 'Pendente') return false;
    return true;
  });

  const handleSyncCommissions = async () => {
    setLoadingReal(true);
    try {
      const days = period === 'Ontem' ? 1 : period.includes('30') ? 30 : 7;
      const res = await fetchShopeeCommissionsApi({ credentials: integrations, days });
      if (res.ok && res.conversions) {
        setRealConversions(res.conversions);
        notify(
          'Comissões Shopee sincronizadas!',
          `${res.conversions.length} pedido(s) reais retornados da API.`
        );
      } else {
        notify(
          'Credenciais Shopee necessárias',
          res.error ||
            'Configure seu App ID e Senha API reais da Shopee em Configurações → Plataformas.',
          'info'
        );
      }
    } finally {
      setLoadingReal(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Comissão Shopee
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Acompanhe suas comissões, vendas e desempenho reais na Shopee Affiliate API.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {realConversions.length > 0
            ? 'Sincronizado via Shopee Affiliate GraphQL oficial'
            : 'Conecte sua API Shopee em Configurações → Plataformas para importar conversões'}
        </span>
        <button
          type="button"
          disabled={loadingReal}
          onClick={() => void handleSyncCommissions()}
          className="px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs sm:text-sm font-semibold flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingReal ? 'animate-spin' : ''}`} />
          <span>Atualizar dados</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap ${
              period === p
                ? 'bg-[#15803D] text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="w-full sm:w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
      >
        <option value="Todos os status">Todos os status</option>
        <option value="Aprovadas">Aprovadas</option>
        <option value="Pendentes">Pendentes</option>
      </select>

      {filteredConversions.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-16 px-6 flex flex-col items-center text-center">
          <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="font-bold text-lg text-slate-900 dark:text-white">
            Nenhuma comissão no período
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            Salve seu App ID e Senha API da Shopee em <strong>Configurações → Plataformas</strong> e
            clique em <strong>Atualizar dados</strong> para consultar seus pedidos reais.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                <th className="py-3.5 px-4">Oferta Convertida</th>
                <th className="py-3.5 px-3 text-right">Pedidos</th>
                <th className="py-3.5 px-3 text-right">Comissão</th>
                <th className="py-3.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredConversions.map((c) => (
                <tr key={c.id}>
                  <td className="py-3.5 px-4 font-medium">{c.product}</td>
                  <td className="py-3.5 px-3 text-right tabular-nums">{c.qty}</td>
                  <td className="py-3.5 px-3 text-right font-bold text-[#15803D] dark:text-emerald-400 tabular-nums">
                    R$ {formatBRL(c.commission)}
                  </td>
                  <td className="py-3.5 px-4 text-right text-xs text-slate-500">
                    {c.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
