import React, { useMemo, useState } from 'react';
import { MessageSquare, Smartphone, Calendar, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SentLog } from '../types';
import { isGroupActiveInSegment, matchesSegment } from '../utils/segmentScoping';

type PeriodKey =
  | 'Hoje'
  | 'Ontem'
  | 'Últimos 7 dias'
  | 'Mês Atual'
  | 'Mês Anterior'
  | 'Últimos 30 dias'
  | 'Personalizado';

const PERIODS: PeriodKey[] = [
  'Hoje',
  'Ontem',
  'Últimos 7 dias',
  'Mês Atual',
  'Mês Anterior',
  'Últimos 30 dias',
  'Personalizado',
];

interface DayBar {
  label: string;
  shopee: number;
  mercadoLivre: number;
  amazon: number;
  magalu: number;
  aliexpress: number;
  netshoes: number;
}

function emptyBar(label: string): DayBar {
  return {
    label,
    shopee: 0,
    mercadoLivre: 0,
    amazon: 0,
    magalu: 0,
    aliexpress: 0,
    netshoes: 0,
  };
}

function addLogToBar(bar: DayBar, log: SentLog) {
  const weight = Math.max(1, log.groupsNames?.length || 1);
  if (log.platform === 'Shopee') bar.shopee += weight;
  else if (log.platform === 'Mercado Livre') bar.mercadoLivre += weight;
  else if (log.platform === 'Amazon') bar.amazon += weight;
  else if (log.platform === 'Magalu') bar.magalu += weight;
  else if (log.platform === 'AliExpress') bar.aliexpress += weight;
  else if (log.platform === 'Netshoes') bar.netshoes += weight;
}

function parseLogDate(log: SentLog): Date | null {
  if (log.sentAtIso) {
    const d = new Date(log.sentAtIso);
    if (!isNaN(d.getTime())) return d;
  }
  // Fallback format: "DD/MM/YYYY, HH:mm"
  const m = String(log.sentAt || '').match(
    /(\d{2})\/(\d{2})\/(\d{4})(?:,\s*|\s+)(\d{2}):(\d{2})/
  );
  if (m) {
    const [, dd, mm, yyyy, hh, min] = m;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  }
  return null;
}

const SHORT_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const DashboardView: React.FC = () => {
  const { sentLogs, accounts, schedules, dispatchGroups, activeSegment, setRoute } = useApp();
  const [period, setPeriod] = useState<PeriodKey>('Últimos 7 dias');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(Date.now() - 6 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const segmentSentLogs = useMemo(
    () => sentLogs.filter((log) => matchesSegment(log.segment, activeSegment)),
    [sentLogs, activeSegment]
  );
  const activeGroupsInSegment = useMemo(
    () => dispatchGroups.filter((g) => isGroupActiveInSegment(g, activeSegment)).length,
    [dispatchGroups, activeSegment]
  );

  const connectedCount = accounts.filter((a) => a.connected).length;
  const totalInstances = Math.max(1, accounts.length);
  const disconnectedCount = Math.max(0, accounts.length - connectedCount);
  const connectedRatio = accounts.length === 0 ? 0 : connectedCount / accounts.length;
  const pendingSchedules = schedules.filter(
    (s) => s.status === 'Pendente' && matchesSegment(s.segment, activeSegment)
  ).length;

  const { bars, displayedMessages } = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

    let rangeStart = startOfToday;
    let rangeEnd = new Date(startOfToday.getTime() + 86400000 - 1);

    if (period === 'Ontem') {
      rangeStart = startOfYesterday;
      rangeEnd = new Date(startOfToday.getTime() - 1);
    } else if (period === 'Últimos 7 dias') {
      rangeStart = new Date(startOfToday.getTime() - 6 * 86400000);
    } else if (period === 'Mês Atual') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'Mês Anterior') {
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (period === 'Últimos 30 dias') {
      rangeStart = new Date(startOfToday.getTime() - 29 * 86400000);
    } else if (period === 'Personalizado') {
      rangeStart = customStart ? new Date(`${customStart}T00:00:00`) : startOfToday;
      rangeEnd = customEnd ? new Date(`${customEnd}T23:59:59`) : rangeEnd;
    }

    const matchingLogs = segmentSentLogs
      .map((log) => ({ log, date: parseLogDate(log) }))
      .filter((item): item is { log: SentLog; date: Date } => {
        if (!item.date) return false;
        return item.date >= rangeStart && item.date <= rangeEnd;
      });

    const totalCount = matchingLogs.reduce(
      (sum, { log }) => sum + Math.max(1, log.groupsNames?.length || 1),
      0
    );

    if (period === 'Hoje' || period === 'Ontem') {
      const hourSlots = ['00h', '08h', '12h', '16h', '20h'];
      const buckets = hourSlots.map((lbl) => emptyBar(lbl));
      for (const { log, date } of matchingLogs) {
        const h = date.getHours();
        const idx = h < 6 ? 0 : h < 11 ? 1 : h < 15 ? 2 : h < 19 ? 3 : 4;
        addLogToBar(buckets[idx], log);
      }
      return { bars: buckets, displayedMessages: totalCount };
    }

    if (period === 'Últimos 7 dias') {
      const buckets: DayBar[] = [];
      const dayKeys: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(startOfToday.getTime() - i * 86400000);
        dayKeys.push(d.toISOString().slice(0, 10));
        buckets.push(emptyBar(SHORT_WEEKDAYS[d.getDay()]));
      }
      for (const { log, date } of matchingLogs) {
        const key = new Date(date.getFullYear(), date.getMonth(), date.getDate())
          .toISOString()
          .slice(0, 10);
        const idx = dayKeys.indexOf(key);
        if (idx >= 0) addLogToBar(buckets[idx], log);
      }
      return { bars: buckets, displayedMessages: totalCount };
    }

    // Weekly buckets for Mês Atual / Mês Anterior / Últimos 30 dias / Personalizado
    const spanMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
    const labels =
      period === 'Personalizado'
        ? ['P1', 'P2', 'P3', 'P4']
        : ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
    const buckets = labels.map((l) => emptyBar(l));
    for (const { log, date } of matchingLogs) {
      const ratio = (date.getTime() - rangeStart.getTime()) / spanMs;
      const idx = Math.min(3, Math.max(0, Math.floor(ratio * 4)));
      addLogToBar(buckets[idx], log);
    }
    return { bars: buckets, displayedMessages: totalCount };
  }, [segmentSentLogs, period, customStart, customEnd]);

  const rawMax = Math.max(
    0,
    ...bars.map(
      (b) => b.shopee + b.mercadoLivre + b.amazon + b.magalu + b.aliexpress + b.netshoes
    )
  );
  const maxTotal = Math.max(20, Math.ceil(rawMax / 4) * 4);
  const yTicks = [
    0,
    Math.round(maxTotal * 0.25),
    Math.round(maxTotal * 0.5),
    Math.round(maxTotal * 0.75),
    maxTotal,
  ];

  // SVG Donut geometry
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const connectedStroke = circumference * connectedRatio;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Visão Geral
          </h1>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {activeSegment}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRoute('grupos-envio')}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-emerald-500/40 transition-colors"
        >
          <Users className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
          <span>
            <strong>{dispatchGroups.length}</strong> grupo(s) sincronizado(s) ·{' '}
            <strong>{activeGroupsInSegment}</strong> ativo(s) em {activeSegment}
          </span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setRoute('envios')}
          className="text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 hover:border-emerald-500/40 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-4">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {displayedMessages}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Mensagens Enviadas
          </div>
        </button>

        <button
          type="button"
          onClick={() => setRoute('whatsapp')}
          className="text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 hover:border-emerald-500/40 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-4">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {connectedCount}/{accounts.length}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Instâncias Conectadas
          </div>
        </button>

        <button
          type="button"
          onClick={() => setRoute('agendamentos')}
          className="text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 hover:border-emerald-500/40 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {pendingSchedules}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Agendamentos Pendentes
          </div>
        </button>
      </div>

      {/* Period Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#15803D] text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      {period === 'Personalizado' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500">De:</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500">Até:</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stacked Bar Chart */}
        <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Envio de Mensagens
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Volume real de mensagens disparadas no período:{' '}
            <strong className="text-slate-900 dark:text-slate-100">{period}</strong>
          </p>

          <div className="mt-6 relative">
            <div className="flex items-end gap-3 h-56 pl-9 pr-2 pb-6 relative">
              {/* Horizontal dashed grid lines */}
              {[...yTicks].reverse().map((tick, idx) => (
                <div
                  key={idx}
                  style={{ bottom: `${24 + (tick / maxTotal) * 200}px` }}
                  className="absolute left-9 right-2 border-b border-dashed border-slate-200 dark:border-slate-800 pointer-events-none"
                >
                  <span className="absolute -left-9 -top-2 text-[11px] text-slate-400 tabular-nums w-7 text-right">
                    {tick}
                  </span>
                </div>
              ))}

              {/* Bars */}
              {bars.map((bar, i) => {
                const total =
                  bar.shopee +
                  bar.mercadoLivre +
                  bar.amazon +
                  bar.magalu +
                  bar.aliexpress +
                  bar.netshoes;
                const scale = 200 / maxTotal;
                return (
                  <div
                    key={`${bar.label}-${i}`}
                    onMouseEnter={() => setHoveredIdx(i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className="flex-1 flex flex-col items-center justify-end h-full relative z-10 group cursor-pointer"
                  >
                    {hoveredIdx === i && (
                      <div className="absolute -top-12 bg-slate-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap z-20 pointer-events-none tabular-nums">
                        <strong>{bar.label}:</strong> {total} envio(s)
                      </div>
                    )}
                    <div className="w-full max-w-[38px] flex flex-col-reverse overflow-hidden rounded-t-sm">
                      {bar.shopee > 0 && (
                        <div
                          style={{ height: `${bar.shopee * scale}px` }}
                          className="bg-[#EA580C] transition-opacity group-hover:opacity-90"
                        />
                      )}
                      {bar.mercadoLivre > 0 && (
                        <div
                          style={{ height: `${bar.mercadoLivre * scale}px` }}
                          className="bg-[#FACC15] transition-opacity group-hover:opacity-90"
                        />
                      )}
                      {bar.amazon > 0 && (
                        <div
                          style={{ height: `${bar.amazon * scale}px` }}
                          className="bg-[#F59E0B]"
                        />
                      )}
                      {bar.magalu > 0 && (
                        <div
                          style={{ height: `${bar.magalu * scale}px` }}
                          className="bg-[#2563EB]"
                        />
                      )}
                      {bar.aliexpress > 0 && (
                        <div
                          style={{ height: `${bar.aliexpress * scale}px` }}
                          className="bg-[#EF4444]"
                        />
                      )}
                      {bar.netshoes > 0 && (
                        <div
                          style={{ height: `${bar.netshoes * scale}px` }}
                          className="bg-[#7E22CE]"
                        />
                      )}
                    </div>
                    <span className="absolute -bottom-5 text-[11px] text-slate-500 dark:text-slate-400">
                      {bar.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Marketplace Legend */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#EF4444]" /> AliExpress
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#F59E0B]" /> Amazon
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#2563EB]" /> Magalu
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#FACC15]" /> Mercado Livre
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#7E22CE]" /> Netshoes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-[#EA580C]" /> Shopee
              </span>
            </div>
          </div>
        </div>

        {/* Status das Instâncias Donut */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 sm:p-6 flex flex-col justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Status das Instâncias
          </h2>

          <div className="my-6 flex items-center justify-center relative">
            <svg viewBox="0 0 180 180" className="w-48 h-48 -rotate-90">
              <circle
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke="#EF4444"
                strokeWidth="26"
                opacity={accounts.length === 0 ? 0.2 : 1}
              />
              <circle
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke="#15803D"
                strokeWidth="26"
                strokeDasharray={`${connectedStroke} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                {accounts.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Total</span>
            </div>
          </div>

          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#15803D]" />
                Conectadas
              </span>
              <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                {connectedCount} (
                {accounts.length ? Math.round((connectedCount / totalInstances) * 100) : 0}%)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444]" />
                Desconectadas
              </span>
              <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                {disconnectedCount} (
                {accounts.length ? Math.round((disconnectedCount / totalInstances) * 100) : 0}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
