import React, { useEffect, useState } from 'react';
import {
  Settings,
  Layers,
  Users,
  Globe,
  FileText,
  ShoppingBag,
  Eye,
  ArrowLeft,
  Save,
  Clock,
  Calendar,
  MessageSquare,
  PlugZap,
  Key,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Plus,
  X,
  Pencil,
  Trash2,
  Gift,
  Wallet,
  ExternalLink,
  User,
  Building2,
  MapPin,
  Lock,
  Download,
  Upload,
  RotateCcw,
  Terminal,
  RefreshCw,
  Copy,
  Smartphone,
  Unlink,
  Share2,
  Send,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Marketplace, NavRoute } from '../types';
import { MARKETPLACES } from '../data/initialData';
import {
  buildAffiliateLink,
  detectMarketplaceFromUrl,
} from '../utils/templateEngine';
import {
  createAutomationGroupApi,
  disconnectMlExtensionApi,
  executeAutomationCommandApi,
  fetchMlExtensionPackageApi,
  runAutoDispatchNowApi,
  getMlExtensionStatusApi,
  sendAutomationGroupWelcomeApi,
  MlExtensionStatus,
  testPlatformApi,
} from '../utils/apiClient';

/* ============================================================================
 * 1. HUB DE CONFIGURAÇÕES (Telas 56–58)
 * ========================================================================== */
export const SettingsHubView: React.FC = () => {
  const { setRoute } = useApp();

  const cards: {
    route: NavRoute;
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
  }[] = [
    {
      route: 'config-disparo-automatico',
      title: 'Disparo Automático',
      subtitle: 'Configure o disparo automático',
      icon: Layers,
      tone: 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-400',
    },
    {
      route: 'config-grupo-automacao',
      title: 'Grupo de Automação',
      subtitle: 'Configure um grupo para comandos rápidos',
      icon: Users,
      tone: 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-400',
    },
    {
      route: 'config-site',
      title: 'Site',
      subtitle: 'Personalize seu site de captura',
      icon: Globe,
      tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
    },
    {
      route: 'config-templates',
      title: 'Templates',
      subtitle: 'Gerencie templates de mensagem',
      icon: FileText,
      tone: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400',
    },
    {
      route: 'config-plataformas',
      title: 'Plataformas',
      subtitle: 'Integrações com Marketplaces',
      icon: ShoppingBag,
      tone: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
    },
    {
      route: 'config-monitoramento',
      title: 'Monitoramento Automático',
      subtitle: 'Configure o monitoramento automático',
      icon: Eye,
      tone: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400',
    },
    {
      route: 'config-avancadas',
      title: 'Configurações Avançadas',
      subtitle: 'Gerencie filtros avançados e backup',
      icon: Settings,
      tone: 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Settings className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Configurações
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.route}
              type="button"
              onClick={() => setRoute(card.route)}
              className="text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 hover:border-emerald-500/50 transition-colors flex flex-col justify-between gap-4"
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${card.tone}`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-bold text-base text-slate-900 dark:text-white">
                  {card.title}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {card.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. DISPARO AUTOMÁTICO (Telas 61–65)
 * ========================================================================== */
export const AutoDispatchConfigView: React.FC = () => {
  const { autoDispatch, setAutoDispatch, activeSegment, setRoute, notify } = useApp();
  const [runningNow, setRunningNow] = useState(false);

  const totalPct = Object.values(autoDispatch.distribution).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0
  );
  const validDistribution = totalPct === 100 || totalPct === 0;

  const handleRunAutoDispatchNow = async () => {
    setRunningNow(true);
    try {
      const res = await runAutoDispatchNowApi(activeSegment);
      if (res.ok && res.sentProductsCount > 0) {
        notify(
          `Disparo automático executado (${activeSegment})!`,
          `${res.sentProductsCount} oferta(s) enviada(s) para ${res.sentGroupsCount} grupo(s).`
        );
      } else {
        notify(
          'Não foi possível disparar agora',
          res.error ||
            `Verifique se há produtos salvos, WhatsApp conectado e grupos ativos no segmento "${activeSegment}".`,
          'info'
        );
      }
    } catch {
      notify('Erro ao acionar disparo automático', 'Tente novamente em instantes.', 'error');
    } finally {
      setRunningNow(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Disparo Automático
        </h1>
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
          Segmento: {activeSegment}
        </span>
      </div>

      {/* Main Toggle Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-lg text-slate-900 dark:text-white">
          Disparo Automático · {activeSegment}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Habilite o disparo automático para enviar os produtos salvos do segmento{' '}
          <strong>{activeSegment}</strong> apenas para os grupos ativos deste segmento (horário de
          Brasília).
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={autoDispatch.enabled}
              onClick={() =>
                setAutoDispatch((prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                autoDispatch.enabled ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  autoDispatch.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              Habilitar envio automático diário
            </span>
          </div>

          <button
            type="button"
            disabled={runningNow}
            onClick={handleRunAutoDispatchNow}
            className="px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span>{runningNow ? 'Disparando...' : 'Disparar ciclo agora'}</span>
          </button>
        </div>
      </div>

      {/* Como funciona? */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-base text-slate-900 dark:text-white">
          Como funciona?
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </span>
            <div>
              <div className="font-semibold">Horário de Funcionamento</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Defina o horário inicial e final dos disparos. As mensagens serão enviadas
                apenas dentro desse intervalo.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </span>
            <div>
              <div className="font-semibold">Intervalo de Envio</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Defina o tempo mínimo e máximo (em minutos) entre os envios para simular
                comportamento humano.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5" />
            </span>
            <div>
              <div className="font-semibold">Limite de produtos</div>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure o número mínimo e máximo de produtos enviados por execução.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Configurações de Envio */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Configurações de Envio
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure os horários e intervalos para envio automático de mensagens.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Horário de Início
            </label>
            <input
              type="time"
              value={autoDispatch.startTime}
              onChange={(e) =>
                setAutoDispatch((prev) => ({ ...prev, startTime: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Horário de Fim
            </label>
            <input
              type="time"
              value={autoDispatch.endTime}
              onChange={(e) =>
                setAutoDispatch((prev) => ({ ...prev, endTime: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Intervalo Mínimo (minutos)
            </label>
            <input
              type="number"
              min={1}
              value={autoDispatch.minIntervalMinutes}
              onChange={(e) =>
                setAutoDispatch((prev) => ({
                  ...prev,
                  minIntervalMinutes: Number(e.target.value),
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Intervalo Máximo (minutos)
            </label>
            <input
              type="number"
              min={1}
              value={autoDispatch.maxIntervalMinutes}
              onChange={(e) =>
                setAutoDispatch((prev) => ({
                  ...prev,
                  maxIntervalMinutes: Number(e.target.value),
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Mín. Produtos / Execução
            </label>
            <input
              type="number"
              min={1}
              value={autoDispatch.minProductsPerRun}
              onChange={(e) =>
                setAutoDispatch((prev) => ({
                  ...prev,
                  minProductsPerRun: Number(e.target.value),
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Máx. Produtos / Execução
            </label>
            <input
              type="number"
              min={1}
              value={autoDispatch.maxProductsPerRun}
              onChange={(e) =>
                setAutoDispatch((prev) => ({
                  ...prev,
                  maxProductsPerRun: Number(e.target.value),
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => notify('Configurações de horário salvas!')}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Configurações de Envio</span>
        </button>
      </div>

      {/* Distribuição de Plataformas */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Distribuição de Plataformas
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Defina a porcentagem de produtos de cada plataforma. A soma deve ser 100% ou 0%.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MARKETPLACES.map((m) => (
            <div key={m}>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                {m} (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={autoDispatch.distribution[m]}
                onChange={(e) =>
                  setAutoDispatch((prev) => ({
                    ...prev,
                    distribution: {
                      ...prev.distribution,
                      [m]: Math.max(0, Number(e.target.value) || 0),
                    },
                  }))
                }
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm font-medium tabular-nums">
          Soma Total:{' '}
          <strong
            className={
              validDistribution
                ? 'text-[#15803D] dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }
          >
            {totalPct}%
          </strong>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!validDistribution) {
              notify(
                'Soma inválida',
                'A soma das porcentagens precisa ser exatamente 100% ou tudo 0%.',
                'error'
              );
              return;
            }
            notify('Distribuição salva com sucesso!');
          }}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Distribuição</span>
        </button>
      </div>

      {/* Ordem de Envio */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Ordem de Envio dos Produtos
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Defina em qual ordem os produtos da sua lista serão enviados.
          </p>
        </div>

        <select
          value={autoDispatch.sendOrder}
          onChange={(e) =>
            setAutoDispatch((prev) => ({
              ...prev,
              sendOrder: e.target.value as typeof prev.sendOrder,
            }))
          }
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Aleatório">Aleatório</option>
          <option value="Mais Recentes">Mais Recentes</option>
          <option value="Priorizados Primeiro">Priorizados Primeiro</option>
          <option value="Maior Comissão">Maior Comissão</option>
        </select>

        <button
          type="button"
          onClick={() => notify('Ordem de envio atualizada!', autoDispatch.sendOrder)}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Ordem de Envio</span>
        </button>
      </div>

      {/* Regras de Cupons no Disparo Automático */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Regras de Cupons no Disparo Automático
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Priorize ofertas com cupom recente para evitar que expirem na fila e defina por quanto
            tempo um cupom capturado no Mercado Livre permanece válido. Sincronizado com a aba
            Cupons.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Priorizar ofertas com cupom ativo
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Envia primeiro os produtos que vieram com cupom válido recente, antes que o cupom
                esgote ou expire.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoDispatch.prioritizeCouponProducts !== false}
              aria-label="Priorizar ofertas com cupom ativo"
              onClick={() => {
                const next = !(autoDispatch.prioritizeCouponProducts !== false);
                setAutoDispatch((prev) => ({ ...prev, prioritizeCouponProducts: next }));
                notify(
                  next
                    ? 'Prioridade para ofertas com cupom ativada'
                    : 'Prioridade para ofertas com cupom desativada'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                autoDispatch.prioritizeCouponProducts !== false
                  ? 'bg-[#15803D]'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoDispatch.prioritizeCouponProducts !== false
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-1.5">
            <label
              htmlFor="autodispatch-ml-coupon-ttl"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              Validade do cupom capturado (Mercado Livre)
            </label>
            <select
              id="autodispatch-ml-coupon-ttl"
              value={String(
                typeof autoDispatch.mlCouponMaxAgeHours === 'number'
                  ? autoDispatch.mlCouponMaxAgeHours
                  : 4
              )}
              onChange={(e) => {
                const hours = Number(e.target.value);
                setAutoDispatch((prev) => ({ ...prev, mlCouponMaxAgeHours: hours }));
                notify(
                  'Prazo de validade atualizado',
                  hours > 0
                    ? `Cupons capturados no ML expiram após ${hours} hora(s).`
                    : 'Cupons capturados no ML valem até o fim do mesmo dia (23h59).'
                );
              }}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
            >
              <option value="2">2 horas após a captura</option>
              <option value="4">4 horas após a captura (Recomendado)</option>
              <option value="6">6 horas após a captura</option>
              <option value="0">Mesmo dia (até 23h59)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. GRUPO DE AUTOMAÇÃO / CONTROLE REMOTO (Telas 66–71)
 * ========================================================================== */
const CHAT_COMMANDS = [
  {
    tag: 'www.link-produto.com.br',
    title: 'Disparar Produto para Grupos de Envio',
    desc: 'Envie qualquer link ou post de produto e ele será disparado para todos os seus grupos de envio.',
    example: 'https://shopee.com.br/produto-oferta',
  },
  {
    tag: 'preview',
    title: 'Gera Template no Grupo de Automação',
    desc: 'Use preview: seguido do link para gerar o template da oferta apenas no grupo de automação, sem disparar.',
    example: 'preview: https://shopee.com.br/produto',
  },
  {
    tag: 'converter',
    title: 'Converter Link para Afiliado',
    desc: 'Use converter: seguido do link para converter em seu link de afiliado.',
    example: 'converter: https://shopee.com.br/produto',
  },
  {
    tag: 'video',
    title: 'Converter Vídeo',
    desc: 'Use video: seguido do link para converter vídeo de produto sem marca d’água.',
    example: 'video: https://sv.shopee.com.br/video',
  },
  {
    tag: 'envio_automatico_on',
    title: 'Ativar Envio Automático',
    desc: 'Envie envio_automatico_on para ativar o envio automático de ofertas.',
    example: 'envio_automatico_on',
  },
  {
    tag: 'envio_automatico_off',
    title: 'Desativar Envio Automático',
    desc: 'Envie envio_automatico_off para pausar o envio automático.',
    example: 'envio_automatico_off',
  },
  {
    tag: 'envio',
    title: 'Comunicado em Massa',
    desc: 'Envie uma mensagem de texto simples para todos os seus grupos de envio usando envio:',
    example: 'envio: Olá pessoal, oferta relâmpago liberada!',
  },
  {
    tag: 'agendar',
    title: 'Agendar Produto ou Mensagem',
    desc: 'Use agendar: seguido do link e horário para agendar o disparo.',
    example: 'agendar: https://shopee.com.br/produto 19:00',
  },
  {
    tag: 'salvar_prioridade',
    title: 'Salvar Produto com Prioridade',
    desc: 'Envie salvar_prioridade: seguido do link para salvar no topo da fila.',
    example: 'salvar_prioridade: https://shopee.com.br/produto',
  },
  {
    tag: 'status',
    title: 'Status do Segmento',
    desc: 'Mostra no grupo se o disparo automático está ativo, quantos grupos estão ligados e quantas ofertas estão na fila.',
    example: 'status',
  },
  {
    tag: 'ajuda',
    title: 'Lista Rápida de Comandos',
    desc: 'Envia o resumo de todos os comandos aceitos direto no grupo de automação.',
    example: 'ajuda',
  },
];

export const AutomationGroupConfigView: React.FC = () => {
  const {
    activeSegment,
    monitoringRules,
    setMonitoringRules,
    monitoringGroups,
    setMonitoringGroups,
    dispatchGroups,
    setDispatchGroups,
    accounts,
    setRoute,
    notify,
  } = useApp();

  const [testCmd, setTestCmd] = useState('status');
  const [runningCmd, setRunningCmd] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [sendTestReplyToWa, setSendTestReplyToWa] = useState(false);
  const [cmdResult, setCmdResult] = useState<{
    ok: boolean;
    replyText: string;
    previewText?: string;
    previewImageUrl?: string;
  } | null>(null);

  // Deduplicate all available WhatsApp groups (monitoring + dispatch) so any real WA group can be chosen
  const selectableWaGroups = React.useMemo(() => {
    const byJid = new Map<string, { id: string; name: string; accountName: string; remoteJid: string }>();
    for (const g of monitoringGroups) {
      if (g.channel !== 'WhatsApp' || !g.remoteJid) continue;
      const norm = g.remoteJid.trim().toLowerCase();
      byJid.set(norm, {
        id: g.id,
        name: g.name,
        accountName: g.accountName,
        remoteJid: g.remoteJid,
      });
    }
    for (const g of dispatchGroups) {
      if (g.channel !== 'WhatsApp' || !g.remoteJid) continue;
      const norm = g.remoteJid.trim().toLowerCase();
      if (!byJid.has(norm)) {
        byJid.set(norm, {
          id: g.id,
          name: g.name,
          accountName: g.accountName,
          remoteJid: g.remoteJid,
        });
      }
    }
    return Array.from(byJid.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [monitoringGroups, dispatchGroups]);

  const selectedGroup = selectableWaGroups.find(
    (g) => g.id === monitoringRules.automationGroupId || g.remoteJid === monitoringRules.automationGroupId
  );
  const hasConnectedWa = accounts.some((a) => a.channel === 'WhatsApp' && a.connected);

  const handleCreateAutomationGroup = async () => {
    if (creatingGroup) return;
    setCreatingGroup(true);
    try {
      const res = await createAutomationGroupApi({ segment: activeSegment });
      if (!res.ok || !res.group) {
        notify(
          'Não foi possível criar o grupo',
          res.error || 'Verifique se o WhatsApp está conectado.',
          'error'
        );
        return;
      }
      const created = res.group;
      setMonitoringGroups((prev) => [
        ...prev.filter((m) => m.id !== created.id && m.remoteJid !== created.remoteJid),
        {
          id: created.id,
          name: created.name,
          channel: 'WhatsApp',
          accountId: created.accountId,
          accountName: created.accountName,
          remoteJid: created.remoteJid,
          monitored: false,
          monitoredSegments: [],
          useGroupImage: false,
          capturedToday: 0,
        },
      ]);
      const dispId = `grp-wa-${created.remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`;
      setDispatchGroups((prev) => [
        ...prev.filter((d) => d.id !== dispId && d.remoteJid !== created.remoteJid),
        {
          id: dispId,
          name: created.name,
          channel: 'WhatsApp',
          accountId: created.accountId,
          accountName: created.accountName,
          remoteJid: created.remoteJid,
          activeForOffers: false,
          activeSegments: [],
          isPriorityCapture: false,
          isChannel: false,
          membersCount: 1,
          maxCapacity: 1024,
          inviteUrl: 'https://chat.whatsapp.com/',
          segment: activeSegment,
          isOwner: true,
          isAdmin: true,
          isOwnerOrAdmin: true,
        },
      ]);
      setMonitoringRules((prev) => ({
        ...prev,
        automationGroupId: created.id,
      }));
      notify(
        'Grupo de automação criado!',
        created.welcomeSent === false
          ? `"${created.name}" foi criado e vinculado ao segmento ${activeSegment}, mas o WhatsApp atrasou a entrega das boas-vindas. Clique em "Enviar boas-vindas" para reenviar.`
          : `"${created.name}" foi criado no WhatsApp com descrição e boas-vindas, e já está vinculado ao segmento ${activeSegment}.`
      );
    } catch (err: any) {
      notify(
        'Erro ao criar grupo',
        err?.message || 'Falha de comunicação com o servidor.',
        'error'
      );
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleSendWelcome = async () => {
    if (!selectedGroup || sendingWelcome) return;
    setSendingWelcome(true);
    try {
      const res = await sendAutomationGroupWelcomeApi({
        segment: activeSegment,
        groupJid: selectedGroup.remoteJid,
        updateDescription: false,
      });
      if (res.ok) {
        notify(
          'Boas-vindas enviadas!',
          `A mensagem com o guia de comandos foi enviada em "${selectedGroup.name}".`
        );
      } else {
        notify(
          'Não foi possível enviar boas-vindas',
          res.error || 'Tente novamente em alguns segundos.',
          'error'
        );
      }
    } catch (err: any) {
      notify(
        'Erro ao enviar boas-vindas',
        err?.message || 'Falha de comunicação com o servidor.',
        'error'
      );
    } finally {
      setSendingWelcome(false);
    }
  };

  const runRealCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = testCmd.trim();
    if (!raw || runningCmd) return;

    setRunningCmd(true);
    setCmdResult(null);
    try {
      const res = await executeAutomationCommandApi({
        command: raw,
        segment: activeSegment,
        sendToGroup: sendTestReplyToWa && Boolean(selectedGroup),
      });
      setCmdResult({
        ok: Boolean(res.ok),
        replyText: res.replyText || res.error || 'Comando processado.',
        previewText: res.previewText,
        previewImageUrl: res.previewImageUrl,
      });
      if (res.ok) {
        notify('Comando executado no servidor!', res.replyText.split('\n')[0]);
      } else {
        notify('Atenção no comando', res.replyText || res.error || 'Verifique a sintaxe.', 'error');
      }
    } catch (err: any) {
      setCmdResult({
        ok: false,
        replyText: `❌ Falha ao comunicar com o servidor: ${err?.message || 'erro de rede'}`,
      });
    } finally {
      setRunningCmd(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Grupo de Automação
          </h1>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {activeSegment}
          </span>
        </div>
      </div>

      {/* Definir Grupo Controle Remoto */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
            <Users className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
            <span>Definir Grupo de Automação</span>
          </div>
          {selectedGroup ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {hasConnectedWa
                  ? 'Escutando comandos no WhatsApp em tempo real'
                  : 'Salvo (conecte o WhatsApp para escutar)'}
              </span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">Desativado neste segmento</span>
          )}
        </div>

        <p className="text-xs sm:text-sm text-slate-500">
          Escolha o grupo privado do WhatsApp que funcionará como seu &ldquo;Controle Remoto&rdquo;.
          Qualquer comando ou link enviado por você nesse grupo será executado automaticamente pelo
          servidor e respondido lá mesmo — mesmo que o grupo não esteja marcado em Grupos de
          Monitoramento.
        </p>

        <select
          value={monitoringRules.automationGroupId}
          onChange={(e) =>
            setMonitoringRules((prev) => ({
              ...prev,
              automationGroupId: e.target.value,
            }))
          }
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="">Não utilizar grupo de automação</option>
          {selectableWaGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.accountName})
            </option>
          ))}
        </select>

        {selectedGroup && (
          <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/50 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2 flex-wrap">
            <span>
              <strong>Ativo:</strong> {selectedGroup.name} ({selectedGroup.accountName})
            </span>
            <span className="font-mono text-[11px] opacity-80">{selectedGroup.remoteJid}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            disabled={creatingGroup || !hasConnectedWa}
            onClick={() => void handleCreateAutomationGroup()}
            title={
              hasConnectedWa
                ? `Cria no WhatsApp o grupo "${activeSegment} - GRUPO DE AUTOMAÇÃO" com descrição e vincula automaticamente`
                : 'Conecte o WhatsApp primeiro para criar o grupo automaticamente'
            }
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            {creatingGroup ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>
              {creatingGroup
                ? 'Criando grupo no WhatsApp...'
                : `Criar "${activeSegment} - GRUPO DE AUTOMAÇÃO"`}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              notify(
                selectedGroup ? 'Grupo de automação ativo!' : 'Grupo de automação desativado',
                selectedGroup
                  ? `Envie "ajuda" ou "status" em "${selectedGroup.name}" no WhatsApp para testar.`
                  : 'Nenhum grupo de automação selecionado neste segmento.'
              )
            }
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Salvar seleção</span>
          </button>

          {selectedGroup && (
            <button
              type="button"
              disabled={sendingWelcome || !hasConnectedWa}
              onClick={() => void handleSendWelcome()}
              title="Envia a mensagem de boas-vindas com o guia de comandos no grupo selecionado"
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {sendingWelcome ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{sendingWelcome ? 'Enviando...' : 'Enviar boas-vindas'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Executor Real de Comandos */}
      <form
        onSubmit={runRealCommand}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-white">
            <Terminal className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
            <span>Executar Comando Rápido Agora</span>
          </div>
          {selectedGroup && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendTestReplyToWa}
                onChange={(e) => setSendTestReplyToWa(e.target.checked)}
                className="rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
              />
              <span>Enviar resposta também no grupo do WhatsApp</span>
            </label>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={testCmd}
            onChange={(e) => setTestCmd(e.target.value)}
            placeholder="Ex: status, preview: https://..., converter: https://..., agendar: https://... 19:00"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm font-mono"
          />
          <button
            type="submit"
            disabled={runningCmd || !testCmd.trim()}
            className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shrink-0 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningCmd ? 'animate-spin' : ''}`} />
            <span>{runningCmd ? 'Executando...' : 'Executar Comando'}</span>
          </button>
        </div>
        {cmdResult && (
          <div className="space-y-2.5">
            <div
              className={`rounded-xl font-mono text-xs p-3.5 whitespace-pre-wrap break-words ${
                cmdResult.ok
                  ? 'bg-slate-900 text-emerald-300'
                  : 'bg-rose-950/90 text-rose-200 border border-rose-800/60'
              }`}
            >
              {cmdResult.replyText}
            </div>
            {cmdResult.previewText && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Prévia Gerada do Template
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start">
                  {cmdResult.previewImageUrl && (
                    <img
                      src={
                        cmdResult.previewImageUrl.startsWith('http')
                          ? `/api/media/proxy?url=${encodeURIComponent(cmdResult.previewImageUrl)}`
                          : cmdResult.previewImageUrl
                      }
                      alt="Prévia do produto"
                      className="w-24 h-24 rounded-xl object-contain bg-white border border-slate-200 shrink-0"
                    />
                  )}
                  <pre className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap font-sans flex-1">
                    {cmdResult.previewText}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      {/* Lista de Comandos Disponíveis (Telas 66–71) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-lg text-slate-900 dark:text-white">
          Comandos Disponíveis
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CHAT_COMMANDS.map((cmd) => (
            <div
              key={cmd.tag}
              onClick={() => setTestCmd(cmd.example)}
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 cursor-pointer hover:border-emerald-500/50 transition-colors"
            >
              <div className="font-mono text-xs font-semibold text-[#15803D] dark:text-emerald-400">
                {cmd.tag}
              </div>
              <div className="font-bold text-sm text-slate-900 dark:text-white">
                {cmd.title}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{cmd.desc}</p>
              <div className="rounded-xl bg-[#1E293B] p-3 font-mono text-xs text-slate-200 overflow-x-auto">
                {cmd.example}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 4. INTEGRAÇÃO DE PLATAFORMAS (Telas 88–97)
 * ========================================================================== */
export const PlatformsConfigView: React.FC = () => {
  const { integrations, setIntegrations, setRoute, notify } = useApp();
  const [newSubId, setNewSubId] = useState('');
  const [newBlockedCoupon, setNewBlockedCoupon] = useState('');
  const [testingPlatform, setTestingPlatform] = useState<Marketplace | null>(null);
  const [mlExtStatus, setMlExtStatus] = useState<MlExtensionStatus | null>(null);
  const [checkingMlExt, setCheckingMlExt] = useState(false);
  const [mlZipBlob, setMlZipBlob] = useState<Blob | null>(null);
  const [mlZipUrl, setMlZipUrl] = useState<string | null>(null);
  const [mlPanelUrl, setMlPanelUrl] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const [preparingZip, setPreparingZip] = useState(false);
  const [bridgeDetected, setBridgeDetected] = useState(false);
  const [syncingViaBridge, setSyncingViaBridge] = useState(false);

  const refreshMlExtStatus = async (showToast = false) => {
    const key = integrations.mercadoLivre.extensionKey?.trim() || '';
    setCheckingMlExt(true);
    try {
      const status = await getMlExtensionStatusApi(key);
      setMlExtStatus(status);
      if (
        status.synced &&
        status.hasSsid &&
        status.extensionKey &&
        status.extensionKey !== key
      ) {
        setIntegrations((prev) => ({
          ...prev,
          mercadoLivre: {
            ...prev.mercadoLivre,
            extensionKey: status.extensionKey || prev.mercadoLivre.extensionKey,
            etiqueta: prev.mercadoLivre.etiqueta || status.etiqueta || '',
          },
        }));
      }
      if (showToast) {
        if (status.synced && status.hasSsid) {
          notify(
            'Extensão Mercado Livre conectada!',
            `Sessão ativa (${status.cookiesCount} cookies via ${status.browserName || 'navegador'}).`
          );
        } else if (status.synced) {
          notify(
            'Extensão sincronizada, falta login no ML',
            'Faça login no Mercado Livre Afiliados no navegador e clique em Sincronizar Sessão.',
            'info'
          );
        } else {
          notify(
            'Extensão ainda não sincronizada',
            'Verifique se a URL na extensão começa com https:// e bate com a URL do painel abaixo, ou atualize o .zip.',
            'info'
          );
        }
      }
    } catch {
      if (showToast) {
        notify('Erro ao consultar extensão', 'Verifique a conexão com o servidor.', 'error');
      }
    } finally {
      setCheckingMlExt(false);
    }
  };

  useEffect(() => {
    void refreshMlExtStatus(false);
    const interval = setInterval(() => {
      void refreshMlExtStatus(false);
    }, 4000);
    const onFocusOrSync = () => {
      void refreshMlExtStatus(false);
    };
    const onExtMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'buboflow-extension') return;
      if (data.type === 'EXTENSION_READY') {
        setBridgeDetected(true);
      }
      if (data.type === 'ML_SYNC_RESULT') {
        setSyncingViaBridge(false);
        void refreshMlExtStatus(false);
        if (data.ok && data.hasSsid) {
          notify(
            'Extensão sincronizada!',
            `Sessão Mercado Livre conectada (${data.cookiesCount || 0} cookies).`
          );
        } else if (data.ok && !data.hasSsid) {
          notify(
            'Conectado ao painel, falta login no ML',
            'Abra o Mercado Livre Afiliados neste navegador, entre na conta e sincronize.',
            'info'
          );
        } else if (data.error) {
          notify('Falha ao sincronizar extensão', String(data.error), 'error');
        }
      }
    };

    window.addEventListener('focus', onFocusOrSync);
    window.addEventListener('buboflow:ml-synced', onFocusOrSync);
    window.addEventListener('message', onExtMessage);
    window.postMessage({ source: 'buboflow-panel', type: 'EXTENSION_PING' }, '*');

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocusOrSync);
      window.removeEventListener('buboflow:ml-synced', onFocusOrSync);
      window.removeEventListener('message', onExtMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrations.mercadoLivre.extensionKey]);

  const handleRequestBridgeSync = () => {
    setSyncingViaBridge(true);
    window.postMessage(
      {
        source: 'buboflow-panel',
        type: 'REQUEST_SYNC',
        extensionKey: integrations.mercadoLivre.extensionKey?.trim() || '',
        etiqueta: integrations.mercadoLivre.etiqueta?.trim() || '',
      },
      '*'
    );
    setTimeout(() => {
      setSyncingViaBridge(false);
      void refreshMlExtStatus(false);
    }, 3500);
  };

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const key = integrations.mercadoLivre.extensionKey?.trim() || 'bbf_ml_default';
    const tag = integrations.mercadoLivre.etiqueta?.trim() || '';

    setPreparingZip(true);
    void fetchMlExtensionPackageApi(key, tag)
      .then((res) => {
        if (!active || !res.ok || !res.blob) return;
        createdUrl = URL.createObjectURL(res.blob);
        setMlZipBlob(res.blob);
        setMlZipUrl(createdUrl);
        if (res.serverUrl) setMlPanelUrl(res.serverUrl);
      })
      .catch(() => {
        // Ignore silent preload errors
      })
      .finally(() => {
        if (active) setPreparingZip(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [integrations.mercadoLivre.extensionKey, integrations.mercadoLivre.etiqueta]);

  const handleDownloadMlZipFallback = async () => {
    setPreparingZip(true);
    try {
      const res = await fetchMlExtensionPackageApi(
        integrations.mercadoLivre.extensionKey,
        integrations.mercadoLivre.etiqueta
      );
      if (!res.ok || !res.blob) {
        notify('Erro ao gerar .zip', res.error || 'Tente novamente.', 'error');
        return;
      }
      const url = URL.createObjectURL(res.blob);
      setMlZipBlob(res.blob);
      setMlZipUrl(url);
      if (res.serverUrl) setMlPanelUrl(res.serverUrl);

      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'extensao-mercadolivre-afiliados.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setPreparingZip(false);
    }
  };

  const handleShareOrSaveMlZip = async () => {
    let blob = mlZipBlob;
    if (!blob) {
      setPreparingZip(true);
      try {
        const res = await fetchMlExtensionPackageApi(
          integrations.mercadoLivre.extensionKey,
          integrations.mercadoLivre.etiqueta
        );
        if (res.ok && res.blob) {
          blob = res.blob;
          setMlZipBlob(res.blob);
          setMlZipUrl(URL.createObjectURL(res.blob));
        }
      } finally {
        setPreparingZip(false);
      }
    }
    if (!blob) {
      notify('Não foi possível preparar o arquivo .zip.', undefined, 'error');
      return;
    }

    try {
      const file = new File([blob], 'extensao-mercadolivre-afiliados.zip', {
        type: 'application/zip',
      });
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Extensão Mercado Livre Afiliados (.zip)',
        });
        notify('Arquivo .zip enviado!', 'Escolha "Salvar em Arquivos/Downloads" ou envie para o Lemur Browser.');
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          files: [file],
          title: 'Extensão Mercado Livre Afiliados (.zip)',
        });
        notify('Arquivo .zip enviado!');
        return;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }

    notify(
      'Desbloqueie Downloads no navegador ou abra no Lemur Browser',
      'Toque no ícone ao lado do endereço do site → Permissões → Downloads automáticos → Permitir.',
      'info'
    );
  };

  const handleCopyPanelUrl = async () => {
    const targetUrl =
      mlPanelUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      notify('URL do painel copiada!', 'Cole no Lemur Browser para baixar o .zip e conectar a extensão.');
    } catch {
      notify('URL do painel:', targetUrl, 'info');
    }
  };

  const handleDisconnectMlExt = async () => {
    const key = integrations.mercadoLivre.extensionKey?.trim();
    if (!key) return;
    await disconnectMlExtensionApi(key);
    setMlExtStatus(null);
    notify('Sessão da extensão removida', 'Sincronize novamente quando precisar.');
  };

  const handleCopyMlKey = async () => {
    try {
      await navigator.clipboard.writeText(integrations.mercadoLivre.extensionKey);
      notify('Chave copiada!');
    } catch {
      notify('Não foi possível copiar automaticamente.', undefined, 'info');
    }
  };

  const handleTestPlatform = async (platform: Marketplace) => {
    setTestingPlatform(platform);
    try {
      const res = await testPlatformApi({ platform, credentials: integrations });
      notify(
        res.ok ? `Conexão ${platform} ativa!` : `Atenção em ${platform}`,
        res.message,
        res.ok ? 'success' : 'error'
      );
    } catch {
      notify(`Erro ao testar ${platform}`, 'Verifique sua conexão com o servidor.', 'error');
    } finally {
      setTestingPlatform(null);
    }
  };

  const addShopeeSubId = () => {
    const clean = newSubId
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 50);
    if (!clean || integrations.shopee.subIds.length >= 5) return;
    setIntegrations((prev) => ({
      ...prev,
      shopee: { ...prev.shopee, subIds: [...prev.shopee.subIds, clean] },
    }));
    setNewSubId('');
  };

  const addBlockedCoupon = () => {
    if (!newBlockedCoupon.trim()) return;
    setIntegrations((prev) => ({
      ...prev,
      netshoes: {
        ...prev.netshoes,
        blockedCoupons: [
          ...prev.netshoes.blockedCoupons,
          newBlockedCoupon.trim().toUpperCase(),
        ],
      },
    }));
    setNewBlockedCoupon('');
  };

  const regenerateMlKey = () => {
    const rand = Math.random().toString(36).slice(2, 12);
    const now = new Date().toLocaleString('pt-BR');
    setIntegrations((prev) => ({
      ...prev,
      mercadoLivre: {
        ...prev.mercadoLivre,
        extensionKey: `bbf_${rand}`,
        extensionCreatedAt: now,
      },
    }));
    setMlExtStatus(null);
    notify('Nova chave gerada!', 'Baixe novamente o .zip ou cole a nova chave na extensão.');
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Plataformas
        </h1>
      </div>

      {/* 1. SHOPEE (Telas 88–89) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">
            Integração Shopee
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Configure os dados da sua conta Shopee Affiliate para geração de links e Sub IDs.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">App ID Shopee</label>
            <input
              type="text"
              value={integrations.shopee.appId}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  shopee: { ...prev.shopee, appId: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Senha API Shopee</label>
            <input
              type="password"
              value={integrations.shopee.apiSecret}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  shopee: { ...prev.shopee, apiSecret: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5">
            Sub IDs de produtos (Máximo: 5)
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {integrations.shopee.subIds.map((sub, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-mono"
              >
                <span>{sub}</span>
                <button
                  type="button"
                  onClick={() =>
                    setIntegrations((prev) => ({
                      ...prev,
                      shopee: {
                        ...prev.shopee,
                        subIds: prev.shopee.subIds.filter((_, idx) => idx !== i),
                      },
                    }))
                  }
                >
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newSubId}
              onChange={(e) => setNewSubId(e.target.value)}
              placeholder="Ex: grupovip2 (apenas letras e números)"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
            />
            <button
              type="button"
              onClick={addShopeeSubId}
              className="px-3.5 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs font-semibold"
            >
              + Adicionar
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            A API oficial da Shopee aceita apenas letras e números nos Sub IDs (sem espaços ou underline).
          </p>
        </div>

        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={integrations.shopee.isManagedPartner}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                shopee: { ...prev.shopee, isManagedPartner: e.target.checked },
              }))
            }
            className="w-4 h-4 rounded text-[#15803D]"
          />
          <span>Sou gerenciado da Shopee (libera cupons HB, CR, PB, AFF, ACC)</span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={testingPlatform === 'Shopee'}
            onClick={() => void handleTestPlatform('Shopee')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <PlugZap className="w-4 h-4" />
            <span>{testingPlatform === 'Shopee' ? 'Testando API...' : 'Testar integração'}</span>
          </button>
          <button
            type="button"
            onClick={() => notify('Shopee salva!')}
            className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Shopee</span>
          </button>
        </div>
      </div>

      {/* 2. MERCADO LIVRE (Telas 91–92) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-bold text-lg text-slate-900 dark:text-white">
              Integração Mercado Livre
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Conecte pela extensão para gerar links curtos /sec/ ou use sua etiqueta (ex: vipe6350064).
            </p>
          </div>
          {mlExtStatus?.synced && mlExtStatus.hasSsid ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                Extensão conectada
                {mlExtStatus.bridgeOnline ? ' (Tempo real)' : ''}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>
                {mlExtStatus?.synced ? 'Falta login no ML' : 'Extensão não sincronizada'}
              </span>
            </span>
          )}
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3.5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 font-mono min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate">Chave ativa: {integrations.mercadoLivre.extensionKey}</span>
                <button
                  type="button"
                  onClick={() => void handleCopyMlKey()}
                  className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 shrink-0"
                  title="Copiar chave"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {mlPanelUrl && (
                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300">
                  <span className="truncate">URL do Painel: {mlPanelUrl}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopyPanelUrl()}
                    className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 shrink-0"
                    title="Copiar URL do painel"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="text-slate-400">
                Criada em: {integrations.mercadoLivre.extensionCreatedAt}
              </div>
              {mlExtStatus?.synced && (
                <div className="text-emerald-600 dark:text-emerald-400">
                  {mlExtStatus.cookiesCount} cookies sincronizados ({mlExtStatus.browserName || 'Navegador'})
                  {mlExtStatus.lastSyncAt
                    ? ` • ${new Date(mlExtStatus.lastSyncAt).toLocaleString('pt-BR')}`
                    : ''}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {bridgeDetected && (
                <button
                  type="button"
                  disabled={syncingViaBridge}
                  onClick={handleRequestBridgeSync}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <PlugZap className="w-3.5 h-3.5" />
                  <span>{syncingViaBridge ? 'Sincronizando...' : 'Sincronizar Extensão Agora'}</span>
                </button>
              )}
              {mlZipUrl ? (
                <a
                  href={mlZipUrl}
                  download="extensao-mercadolivre-afiliados.zip"
                  onClick={() =>
                    notify(
                      'Iniciando download do .zip (v1.1.0)...',
                      'Se já tinha uma versão antiga instalada, remova-a em Extensões e carregue este novo .zip.'
                    )
                  }
                  className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Extensão (.zip)</span>
                </a>
              ) : (
                <button
                  type="button"
                  disabled={preparingZip}
                  onClick={() => void handleDownloadMlZipFallback()}
                  className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{preparingZip ? 'Preparando .zip...' : 'Baixar Extensão (.zip)'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleShareOrSaveMlZip()}
                className="px-3 py-2 rounded-xl border border-emerald-600/40 bg-emerald-50/70 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Salvar / Compartilhar .zip</span>
              </button>
              <button
                type="button"
                onClick={() => void handleCopyPanelUrl()}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar URL do Painel</span>
              </button>
              {mlPanelUrl && (
                <a
                  href={mlPanelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir fora do Preview</span>
                </a>
              )}
              <button
                type="button"
                disabled={checkingMlExt}
                onClick={() => void refreshMlExtStatus(true)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingMlExt ? 'animate-spin' : ''}`} />
                <span>Verificar</span>
              </button>
              <button
                type="button"
                onClick={regenerateMlKey}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Nova chave</span>
              </button>
              {mlExtStatus?.synced && (
                <button
                  type="button"
                  onClick={() => void handleDisconnectMlExt()}
                  className="px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Desconectar</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-2.5 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
            <div className="font-semibold">
              Se você tocou em &quot;Bloquear&quot; downloads no Lemur Browser ou Chrome:
            </div>
            <div>
              • <strong>Mais rápido:</strong> toque em <strong>Abrir fora do Preview</strong> (ou use o botão <strong>Salvar / Compartilhar .zip</strong> acima).
              <br />• <strong>Para desbloquear no Lemur Browser:</strong> toque nos <strong>3 pontinhos (⋮)</strong> → <strong>Configurações</strong> → <strong>Configurações do site</strong> → <strong>Downloads automáticos</strong> → remova ou permita o site bloqueado (ou toque no ícone de cadeado/ajustes ao lado do endereço → <em>Permissões</em>).
            </div>
          </div>

          <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 p-3 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
            <div className="font-semibold flex items-center gap-1.5 text-slate-800 dark:text-slate-100">
              <Smartphone className="w-3.5 h-3.5 text-[#15803D] dark:text-emerald-400" />
              <span>Como conectar no celular Android (Lemur) ou no PC (v1.1.0 com detecção automática):</span>
            </div>
            <p>
              <strong>No Celular (Android — Lemur Browser):</strong> Baixe o novo <strong>.zip (v1.1.0)</strong>, remova a versão antiga em <em>Extensões</em> se já tiver instalado antes, ative o <em>Modo Desenvolvedor</em> e carregue o novo <code>.zip</code>. Ao voltar para esta aba, a extensão detecta automaticamente a URL <code>https://</code> e a Chave ativa e sincroniza sua sessão!
            </p>
            <p>
              <strong>No PC (Chrome):</strong> Descompacte o <code>.zip</code>, acesse <code>chrome://extensions</code>, ative o <em>Modo do desenvolvedor</em> e clique em <strong>Carregar sem compactação</strong>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">
              Etiqueta do Mercado Livre *
            </label>
            <input
              type="text"
              value={integrations.mercadoLivre.etiqueta}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  mercadoLivre: { ...prev.mercadoLivre, etiqueta: e.target.value },
                }))
              }
              placeholder="Ex: vipe6350064"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">
              Token OAuth Mercado Livre (Opcional)
            </label>
            <input
              type="password"
              value={integrations.mercadoLivre.authCode}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  mercadoLivre: { ...prev.mercadoLivre, authCode: e.target.value },
                }))
              }
              placeholder="Opcional para busca via API oficial"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={testingPlatform === 'Mercado Livre'}
            onClick={() => void handleTestPlatform('Mercado Livre')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <PlugZap className="w-4 h-4" />
            <span>
              {testingPlatform === 'Mercado Livre' ? 'Testando busca...' : 'Testar integração'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => notify('Mercado Livre salvo!')}
            className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Mercado Livre</span>
          </button>
        </div>
      </div>

      {/* 3. AMAZON (Telas 90–91) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">
            Integração Amazon
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Configure o seu ID de Associado Amazon para gerar links rastreáveis.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">ID de Afiliado Amazon</label>
            <input
              type="text"
              value={integrations.amazon.associateTag}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  amazon: { ...prev.amazon, associateTag: e.target.value },
                }))
              }
              placeholder="Ex: seuid-20"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Access Key (Opcional)</label>
            <input
              type="text"
              value={integrations.amazon.accessKey}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  amazon: { ...prev.amazon, accessKey: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Secret Key (Opcional)</label>
            <input
              type="password"
              value={integrations.amazon.secretKey}
              onChange={(e) =>
                setIntegrations((prev) => ({
                  ...prev,
                  amazon: { ...prev.amazon, secretKey: e.target.value },
                }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={integrations.amazon.autoShorten}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                amazon: { ...prev.amazon, autoShorten: e.target.checked },
              }))
            }
            className="w-4 h-4 rounded text-[#15803D]"
          />
          <span>Encurtar links automaticamente (estilo amzn.to)</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={testingPlatform === 'Amazon'}
            onClick={() => void handleTestPlatform('Amazon')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <PlugZap className="w-4 h-4" />
            <span>{testingPlatform === 'Amazon' ? 'Testando...' : 'Testar integração'}</span>
          </button>
          <button
            type="button"
            onClick={() => notify('Amazon salva!')}
            className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Amazon</span>
          </button>
        </div>
      </div>

      {/* 4. NETSHOES / RAKUTEN (Telas 93–94) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">
            Integração Netshoes (Rakuten)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Configure suas credenciais Rakuten e substituição automática de cupons nominais.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            value={integrations.netshoes.accountSid}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                netshoes: { ...prev.netshoes, accountSid: e.target.value },
              }))
            }
            placeholder="Account ID (SID) Ex: 4695120"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <input
            type="text"
            value={integrations.netshoes.nominalCoupon}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                netshoes: {
                  ...prev.netshoes,
                  nominalCoupon: e.target.value.toUpperCase(),
                },
              }))
            }
            placeholder="Meu cupom nominal (Ex: DIVULGA)"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newBlockedCoupon}
              onChange={(e) => setNewBlockedCoupon(e.target.value)}
              placeholder="Cupom bloqueado..."
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
            />
            <button
              type="button"
              onClick={addBlockedCoupon}
              className="px-3 py-2 rounded-xl border border-[#15803D] text-[#15803D] text-xs font-semibold"
            >
              +
            </button>
          </div>
        </div>

        {integrations.netshoes.blockedCoupons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {integrations.netshoes.blockedCoupons.map((c, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-mono flex items-center gap-1"
              >
                {c}
                <button
                  type="button"
                  onClick={() =>
                    setIntegrations((prev) => ({
                      ...prev,
                      netshoes: {
                        ...prev.netshoes,
                        blockedCoupons: prev.netshoes.blockedCoupons.filter(
                          (_, i) => i !== idx
                        ),
                      },
                    }))
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={testingPlatform === 'Netshoes'}
            onClick={() => void handleTestPlatform('Netshoes')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          >
            <PlugZap className="w-4 h-4" />
            <span>{testingPlatform === 'Netshoes' ? 'Testando...' : 'Testar integração'}</span>
          </button>
          <button
            type="button"
            onClick={() => notify('Netshoes salva!')}
            className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Netshoes</span>
          </button>
        </div>
      </div>

      {/* 5. MAGALU & 6. ALIEXPRESS (Telas 95–97) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <h2 className="font-bold text-base">Integração Magalu</h2>
          <input
            type="text"
            value={integrations.magalu.partnerStore}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                magalu: { ...prev.magalu, partnerStore: e.target.value },
              }))
            }
            placeholder="Loja Parceiro Magalu (ex: achadinhosofertas)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <input
            type="text"
            value={integrations.magalu.affiliateId}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                magalu: { ...prev.magalu, affiliateId: e.target.value },
              }))
            }
            placeholder="ID de afiliado direto (Opcional)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={testingPlatform === 'Magalu'}
              onClick={() => void handleTestPlatform('Magalu')}
              className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              {testingPlatform === 'Magalu' ? 'Testando...' : 'Testar Loja'}
            </button>
            <button
              type="button"
              onClick={() => notify('Magalu salvo!')}
              className="py-2.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold"
            >
              Salvar Magalu
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
          <h2 className="font-bold text-base">Integração AliExpress</h2>
          <input
            type="text"
            value={integrations.aliexpress.appKey}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                aliexpress: { ...prev.aliexpress, appKey: e.target.value },
              }))
            }
            placeholder="App Key (AliExpress Portals)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <input
            type="password"
            value={integrations.aliexpress.appSecret}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                aliexpress: { ...prev.aliexpress, appSecret: e.target.value },
              }))
            }
            placeholder="App Secret (AliExpress Portals)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <input
            type="text"
            value={integrations.aliexpress.trackingId}
            onChange={(e) =>
              setIntegrations((prev) => ({
                ...prev,
                aliexpress: { ...prev.aliexpress, trackingId: e.target.value },
              }))
            }
            placeholder="Tracking ID (Ex: divulgatudo)"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={testingPlatform === 'AliExpress'}
              onClick={() => void handleTestPlatform('AliExpress')}
              className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              {testingPlatform === 'AliExpress' ? 'Testando...' : 'Testar API'}
            </button>
            <button
              type="button"
              onClick={() => notify('AliExpress salvo!')}
              className="py-2.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold"
            >
              Salvar AliExpress
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 5. MONITORAMENTO AUTOMÁTICO (Telas 98–99)
 * ========================================================================== */
export const MonitoringAutoConfigView: React.FC = () => {
  const { monitoringRules, setMonitoringRules, setRoute, notify } = useApp();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Monitoramento Automático
        </h1>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-lg">Monitoramento Automático</h2>
        <p className="text-sm text-slate-500">
          Configure a captura automática de produtos nos grupos monitorados.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={monitoringRules.enabled}
            onClick={() =>
              setMonitoringRules((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              monitoringRules.enabled ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                monitoringRules.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm font-medium">
            Habilitar captura automática de produtos
          </span>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Comparador Automático de Menor Preço
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Ao capturar uma oferta de um grupo monitorado, busca automaticamente o mesmo produto
              na Shopee e no Mercado Livre e substitui pelo anúncio mais barato com seu link de
              afiliado (filtrando acessórios e divergências de modelo/capacidade).
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(monitoringRules.compareLowerPrice)}
            aria-label="Habilitar comparador automático de menor preço"
            onClick={() =>
              setMonitoringRules((prev) => ({
                ...prev,
                compareLowerPrice: !prev.compareLowerPrice,
              }))
            }
            className="inline-flex items-center gap-2 min-h-[40px] px-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] shrink-0"
          >
            <span
              className={`text-xs font-semibold whitespace-nowrap ${
                monitoringRules.compareLowerPrice
                  ? 'text-[#15803D] dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {monitoringRules.compareLowerPrice ? 'Ativado' : 'Desativado'}
            </span>
            <span
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                monitoringRules.compareLowerPrice
                  ? 'bg-[#15803D] dark:bg-emerald-600'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                  monitoringRules.compareLowerPrice ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label
              htmlFor="compare-min-savings-input"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5"
            >
              Economia mínima para substituir (%)
            </label>
            <input
              id="compare-min-savings-input"
              type="number"
              min={1}
              max={60}
              disabled={!monitoringRules.compareLowerPrice}
              value={monitoringRules.compareMinSavingsPercent ?? 5}
              onChange={(e) => {
                const val = Math.max(1, Math.min(60, Number(e.target.value) || 5));
                setMonitoringRules((prev) => ({
                  ...prev,
                  compareMinSavingsPercent: val,
                }));
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 disabled:opacity-50 px-3.5 py-2.5 text-sm tabular-nums"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              A troca só acontece se a oferta encontrada for pelo menos esta porcentagem mais barata
              que o preço capturado.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 p-3.5 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <div className="font-semibold text-slate-800 dark:text-slate-100">
              Proteção contra falsos positivos
            </div>
            <p>
              Compara título, código de modelo, armazenamento e voltagem, respeita os marketplaces
              permitidos no grupo e ignora acessórios (capas, películas, cabos ou peças).
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-base">Configurações de Monitoramento</h2>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Evitar capturar produtos repetidos (horas)
          </label>
          <input
            type="number"
            min={0}
            value={monitoringRules.avoidDuplicateHours}
            onChange={(e) =>
              setMonitoringRules((prev) => ({
                ...prev,
                avoidDuplicateHours: Math.max(0, Number(e.target.value) || 0),
              }))
            }
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Se não quiser aplicar a regra de horário para capturar produtos repetidos,
            informe 0.
          </p>
        </div>

        <button
          type="button"
          onClick={() => notify('Configurações de monitoramento salvas!')}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Configurações de Monitoramento</span>
        </button>
      </div>
    </div>
  );
};

/* ============================================================================
 * 6. CONFIGURAÇÕES AVANÇADAS + BACKUP LOCAL (Telas 100–102)
 * ========================================================================== */
export const AdvancedFiltersConfigView: React.FC = () => {
  const {
    monitoringRules,
    setMonitoringRules,
    exportBackupJson,
    importBackupJson,
    resetAllData,
    setRoute,
    notify,
  } = useApp();

  const [restrictedInput, setRestrictedInput] = useState('');
  const [allowedInput, setAllowedInput] = useState('');

  const addRestricted = () => {
    if (!restrictedInput.trim()) return;
    setMonitoringRules((prev) => ({
      ...prev,
      restrictedWords: [...prev.restrictedWords, restrictedInput.trim().toLowerCase()],
    }));
    setRestrictedInput('');
  };

  const addAllowed = () => {
    if (!allowedInput.trim()) return;
    setMonitoringRules((prev) => ({
      ...prev,
      allowedWords: [...prev.allowedWords, allowedInput.trim().toLowerCase()],
    }));
    setAllowedInput('');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importBackupJson(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleExportFile = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `buboflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Backup baixado!', 'Guarde o arquivo JSON para restaurar em outro celular/PC.');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Configurações Avançadas
        </h1>
      </div>

      {/* Palavras Restritas */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Ban className="w-5 h-5 text-rose-500" />
          <span>Palavras Restritas</span>
        </div>
        <p className="text-sm text-slate-500">
          Defina palavras que devem ser ignoradas durante o monitoramento de mensagens.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={restrictedInput}
            onChange={(e) => setRestrictedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRestricted();
              }
            }}
            placeholder="Ex: adulto, aposta, usado..."
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addRestricted}
            className="px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs font-semibold"
          >
            + ADICIONAR
          </button>
        </div>

        {monitoringRules.restrictedWords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {monitoringRules.restrictedWords.map((w, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-medium"
              >
                {w}
                <button
                  type="button"
                  onClick={() =>
                    setMonitoringRules((prev) => ({
                      ...prev,
                      restrictedWords: prev.restrictedWords.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => notify('Palavras restritas salvas!')}
          className="w-full py-3 rounded-xl bg-[#15803D] text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Palavras Restritas</span>
        </button>
      </div>

      {/* Palavras Permitidas */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <CheckCircle2 className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
          <span>Palavras Permitidas</span>
        </div>
        <p className="text-sm text-slate-500">
          Defina palavras que obrigatoriamente devem estar presentes em uma mensagem para que
          um produto seja capturado.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={allowedInput}
            onChange={(e) => setAllowedInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAllowed();
              }
            }}
            placeholder="Ex: bebê, fralda, mamãe..."
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addAllowed}
            className="px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs font-semibold"
          >
            + ADICIONAR
          </button>
        </div>

        {monitoringRules.allowedWords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {monitoringRules.allowedWords.map((w, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-[#15803D] dark:text-emerald-300 text-xs font-medium"
              >
                {w}
                <button
                  type="button"
                  onClick={() =>
                    setMonitoringRules((prev) => ({
                      ...prev,
                      allowedWords: prev.allowedWords.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 p-3.5 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            <strong>Atenção:</strong> Ao utilizar Palavras Permitidas, o monitoramento se
            torna mais restritivo. Se nenhum produto contiver as palavras definidas, nenhum
            resultado será capturado.
          </p>
        </div>

        <button
          type="button"
          onClick={() => notify('Palavras permitidas salvas!')}
          className="w-full py-3 rounded-xl bg-[#15803D] text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Palavras Permitidas</span>
        </button>
      </div>

      {/* Backup & Sincronização Local */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <h2 className="font-bold text-base">Backup & Portabilidade de Dados (.JSON)</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Como o painel opera sem banco de dados externo, exporte seus templates, grupos e
          ofertas para sincronizar entre o celular e o computador.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handleExportFile}
            className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Exportar Dados (.json)</span>
          </button>

          <label className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
            <Upload className="w-4 h-4" />
            <span>Importar Backup</span>
            <input
              type="file"
              accept="application/json"
              onChange={handleImportFile}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={resetAllData}
            className="px-4 py-2.5 rounded-xl border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-400 text-xs sm:text-sm font-semibold flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Restaurar Padrão</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 7. PROGRAMA DE INDICAÇÕES (Telas 59–60)
 * ========================================================================== */
export const ReferralsView: React.FC = () => {
  const { profile, setProfile, notify } = useApp();
  const [agreed, setAgreed] = useState(profile.referralActive);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2.5">
        <Users className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Indicações
        </h1>
      </div>

      {/* Hero Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/60 dark:to-slate-900 border border-emerald-200/70 dark:border-emerald-800/60 p-6 text-center space-y-2.5">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-[#15803D] dark:text-emerald-400">
          <Gift className="w-4 h-4" />
          <span>Programa de Indicações</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
          Indique o BuboFlow e ganhe{' '}
          <span className="text-[#15803D] dark:text-emerald-400">
            12% de comissão recorrente
          </span>
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
          Para cada pessoa que assinar pelo seu link, você recebe 12% de comissão
          automaticamente, todos os meses, enquanto a assinatura dela estiver ativa.
        </p>
      </div>

      {/* Wallet Setup Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Programa de Indicações</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure o <strong>Wallet ID</strong> da sua conta Asaas para receber as
              transferências automáticas a cada pagamento confirmado.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5">Wallet ID (Asaas)</label>
          <input
            type="text"
            value={profile.asaasWalletId}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, asaasWalletId: e.target.value }))
            }
            placeholder="Cole aqui o seu Wallet ID"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono"
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="w-4 h-4 rounded text-[#15803D]"
          />
          <span>Li e concordo com os Termos do Programa de Indicações</span>
        </label>

        <button
          type="button"
          onClick={() => {
            if (!agreed) {
              notify('Aceite os termos antes de ativar', undefined, 'error');
              return;
            }
            setProfile((prev) => ({ ...prev, referralActive: true }));
            notify('Indicações ativadas!', 'Seu link de afiliado da plataforma está pronto.');
          }}
          className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
        >
          Salvar e ativar indicações
        </button>

        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
          <div className="text-slate-400 font-semibold">Não sabe seu Wallet ID?</div>
          <a
            href="https://www.asaas.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[#15803D] dark:text-emerald-400 font-medium hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Criar ou acessar conta no Asaas</span>
          </a>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 8. MEU PERFIL (Telas 103–105) & 9. SEGMENTOS (Tela 107)
 * ========================================================================== */
export const ProfileView: React.FC = () => {
  const { profile, setProfile, notify } = useApp();
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confPass, setConfPass] = useState('');

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2.5">
          <User className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Meu Perfil
          </h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Gerencie suas informações pessoais e da sua empresa.
        </p>
      </div>

      {/* Dados do Usuário */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-base">
          <User className="w-5 h-5 text-[#15803D]" />
          <span>Dados do Usuário</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold mb-1">Nome Completo</label>
            <input
              type="text"
              value={profile.fullName}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, fullName: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">CPF</label>
            <input
              type="text"
              disabled
              value={profile.cpf}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 px-3.5 py-2 text-sm text-slate-500 tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">E-mail</label>
            <input
              type="email"
              disabled
              value={profile.email}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 px-3.5 py-2 text-sm text-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Telefone</label>
            <input
              type="text"
              value={profile.phone}
              onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => notify('Dados pessoais atualizados!')}
            className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Alterações</span>
          </button>
        </div>
      </div>

      {/* Dados da Empresa & Endereço */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2 font-bold text-base">
          <Building2 className="w-5 h-5 text-[#15803D]" />
          <span>Dados da Empresa & Endereço</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Nome da Empresa</label>
            <input
              type="text"
              value={profile.companyName}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, companyName: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">CNPJ</label>
            <input
              type="text"
              value={profile.cnpj}
              onChange={(e) => setProfile((prev) => ({ ...prev, cnpj: e.target.value }))}
              placeholder="Opcional"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">CEP</label>
            <input
              type="text"
              value={profile.cep}
              onChange={(e) => setProfile((prev) => ({ ...prev, cep: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Endereço</label>
            <input
              type="text"
              value={profile.street}
              onChange={(e) => setProfile((prev) => ({ ...prev, street: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Número</label>
            <input
              type="text"
              value={profile.number}
              onChange={(e) => setProfile((prev) => ({ ...prev, number: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Bairro</label>
            <input
              type="text"
              value={profile.neighborhood}
              onChange={(e) =>
                setProfile((prev) => ({ ...prev, neighborhood: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-between items-center pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="w-3.5 h-3.5" /> Salvo localmente no navegador
          </span>
          <button
            type="button"
            onClick={() => notify('Endereço e empresa salvos!')}
            className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Alterações</span>
          </button>
        </div>
      </div>

      {/* Segurança */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
        <div className="flex items-center gap-2 font-bold text-base">
          <Lock className="w-5 h-5 text-[#15803D]" />
          <span>Segurança</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="password"
            value={curPass}
            onChange={(e) => setCurPass(e.target.value)}
            placeholder="Senha Atual"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
          />
          <input
            type="password"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="Nova Senha"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
          />
          <input
            type="password"
            value={confPass}
            onChange={(e) => setConfPass(e.target.value)}
            placeholder="Confirmar Nova Senha"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setCurPass('');
              setNewPass('');
              setConfPass('');
              notify('Preferência registrada!', 'O painel permanece em acesso direto sem login.');
            }}
            className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs sm:text-sm font-semibold"
          >
            Alterar Senha
          </button>
        </div>
      </div>
    </div>
  );
};

export const SegmentsView: React.FC = () => {
  const { segments, activeSegment, setActiveSegment, addSegment, renameSegment, deleteSegment } =
    useApp();
  const [newName, setNewName] = useState('');
  const [editingSeg, setEditingSeg] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addSegment(newName);
    setNewName('');
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2.5">
        <Settings className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Segmentos
        </h1>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-5">
        <div>
          <div className="flex items-center gap-2 font-bold text-lg">
            <Layers className="w-5 h-5 text-[#15803D]" />
            <span>Gerenciamento de Segmentos</span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Separe nichos diferentes (ex: Geral, Beleza, Tech &amp; Gamer) sem misturar produtos,
            grupos ativos ou disparos automáticos.
          </p>
        </div>

        <form onSubmit={handleAdd} className="flex items-center gap-2.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do novo segmento..."
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar</span>
          </button>
        </form>

        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500">
              <th className="py-3 px-2">Nome</th>
              <th className="py-3 px-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {segments.map((seg) => (
              <tr key={seg}>
                <td className="py-3 px-2 font-medium">
                  {editingSeg === seg ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          renameSegment(seg, editingValue);
                          setEditingSeg(null);
                        }}
                        className="text-xs font-semibold text-[#15803D]"
                      >
                        Salvar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveSegment(seg)}
                      className="inline-flex items-center gap-2 text-left hover:text-[#15803D]"
                    >
                      <span>{seg}</span>
                      {activeSegment === seg && (
                        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                          Ativo
                        </span>
                      )}
                    </button>
                  )}
                </td>
                <td className="py-3 px-2 text-right">
                  {seg !== 'Geral' ? (
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSeg(seg);
                          setEditingValue(seg);
                        }}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSegment(seg)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Padrão</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shared vs Isolated Reference Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Compartilhado (Toda a Conta)
          </div>
          <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
            <li>• Contas conectadas (WhatsApp e Telegram)</li>
            <li>• Plataformas de Afiliado (Shopee, ML, Amazon, Magalu, etc.)</li>
            <li>• Vitrine de Ofertas (salva no segmento ativo)</li>
            <li>• Ferramentas, Comissões e Perfil</li>
          </ul>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">
            Isolado por Segmento
          </div>
          <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
            <li>• Produtos salvos, Favoritos e Meus Cupons</li>
            <li>• Grupos ativos de Envio e Monitoramento</li>
            <li>• Disparo Automático, Templates e Regras</li>
            <li>• Agendamentos, Filas, Site, Envios e Dashboard</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
