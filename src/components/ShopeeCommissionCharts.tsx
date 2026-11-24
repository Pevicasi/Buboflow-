import React, { useMemo, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import type { ShopeeCommissionAnalytics, ShopeeTimeBucket } from '../utils/shopeeCommissions';
import { formatBRL } from '../utils/templateEngine';

interface ShopeeCommissionChartsProps {
  analytics: ShopeeCommissionAnalytics;
}

function niceCurrencyMax(val: number): number {
  if (val <= 0) return 1;
  if (val <= 1) return 1;
  if (val <= 2) return 2;
  if (val <= 5) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(val)));
  const norm = val / mag;
  const step = norm <= 1.2 ? 1.2 : norm <= 2 ? 2 : norm <= 4 ? 4 : norm <= 5 ? 5 : 8;
  return Math.ceil(step * mag);
}

function formatAxisBrl(val: number): string {
  if (val >= 1000) return `R$${(val / 1000).toFixed(1).replace('.0', '')}k`;
  if (Number.isInteger(val)) return `R$${val}`;
  return `R$${val.toFixed(2).replace('.', ',')}`;
}

export const ShopeeCommissionCharts: React.FC<ShopeeCommissionChartsProps> = ({ analytics }) => {
  const [granularity, setGranularity] = useState<'dia' | 'hora' | 'semana'>('dia');
  const [hoverCommIdx, setHoverCommIdx] = useState<number | null>(null);
  const [hoverSalesIdx, setHoverSalesIdx] = useState<number | null>(null);

  const commSeries: ShopeeTimeBucket[] = useMemo(() => {
    if (granularity === 'hora') return analytics.commissionByHour;
    if (granularity === 'semana') return analytics.commissionByWeek;
    return analytics.commissionByDay;
  }, [analytics, granularity]);

  const commChart = useMemo(() => {
    const xStart = 52;
    const xEnd = 338;
    const yTop = 20;
    const yBottom = 164;
    const maxVal = niceCurrencyMax(Math.max(...commSeries.map((d) => d.commission), 0) * 1.15);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Number((maxVal * r).toFixed(2)));

    const mapY = (v: number) => yBottom - (Math.max(0, v) / maxVal) * (yBottom - yTop);
    const pts = commSeries.map((d, i) => {
      const x =
        commSeries.length <= 1
          ? (xStart + xEnd) / 2
          : xStart + (i / (commSeries.length - 1)) * (xEnd - xStart);
      return { x, y: mapY(d.commission), d };
    });

    const linePath =
      pts.length > 1
        ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
        : '';
    const areaPath =
      pts.length > 1
        ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)} ${yBottom} L${pts[0].x.toFixed(1)} ${yBottom} Z`
        : '';

    return { xStart, xEnd, yTop, yBottom, maxVal, ticks, pts, linePath, areaPath };
  }, [commSeries]);

  const salesSeries = analytics.salesByDay;
  const salesChart = useMemo(() => {
    const xStart = 36;
    const xEnd = 304;
    const yTop = 20;
    const yBottom = 164;
    const maxOrders = Math.max(1, ...salesSeries.map((d) => d.orders));
    const orderTicks =
      maxOrders <= 4
        ? Array.from({ length: maxOrders + 1 }, (_, i) => i)
        : [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(maxOrders * r));

    const maxGmv = niceCurrencyMax(Math.max(...salesSeries.map((d) => d.gmv), 0) * 1.12);
    const gmvTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(maxGmv * r));

    const slotWidth = (xEnd - xStart) / Math.max(1, salesSeries.length);
    const barWidth = Math.min(120, Math.max(14, slotWidth * 0.62));

    const items = salesSeries.map((d, i) => {
      const cx = xStart + slotWidth * i + slotWidth / 2;
      const barH = (d.orders / maxOrders) * (yBottom - yTop);
      const barY = yBottom - barH;
      const gmvY = yBottom - (Math.max(0, d.gmv) / maxGmv) * (yBottom - yTop);
      return { cx, barX: cx - barWidth / 2, barY, barH, barWidth, gmvY, d };
    });

    const gmvPath =
      items.length > 1
        ? items.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)} ${p.gmvY.toFixed(1)}`).join(' ')
        : '';

    return { xStart, xEnd, yTop, yBottom, maxOrders, orderTicks, maxGmv, gmvTicks, items, gmvPath };
  }, [salesSeries]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Comissão ao longo do tempo */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Comissão ao longo do tempo
            </h3>
          </div>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 gap-1">
          {(
            [
              { id: 'dia', label: 'Por Dia' },
              { id: 'hora', label: 'Por Hora' },
              { id: 'semana', label: 'Por Semana' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setGranularity(tab.id);
                setHoverCommIdx(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                granularity === tab.id
                  ? 'bg-[#15803D] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {commSeries.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-slate-400">
            Nenhuma comissão válida no período selecionado.
          </div>
        ) : (
          <div className="relative">
            <svg viewBox="0 0 360 198" className="w-full h-52 overflow-visible">
              <defs>
                <linearGradient id="shopeeCommArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#15803D" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#15803D" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {commChart.ticks.map((t, idx) => {
                const y =
                  commChart.yBottom -
                  (idx / (commChart.ticks.length - 1)) * (commChart.yBottom - commChart.yTop);
                return (
                  <g key={`cy-${idx}`}>
                    <line
                      x1={commChart.xStart}
                      y1={y}
                      x2={commChart.xEnd}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={commChart.xStart - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] tabular-nums"
                    >
                      {formatAxisBrl(t)}
                    </text>
                  </g>
                );
              })}

              {commChart.areaPath && <path d={commChart.areaPath} fill="url(#shopeeCommArea)" />}
              {commChart.linePath && (
                <path
                  d={commChart.linePath}
                  fill="none"
                  stroke="#15803D"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {commChart.pts.map((pt, idx) => {
                const showLabel =
                  commChart.pts.length <= 6 ||
                  idx === 0 ||
                  idx === commChart.pts.length - 1 ||
                  idx % Math.ceil(commChart.pts.length / 4) === 0;
                const isHovered = hoverCommIdx === idx;
                return (
                  <g
                    key={pt.d.key}
                    onMouseEnter={() => setHoverCommIdx(idx)}
                    onMouseLeave={() => setHoverCommIdx(null)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 6 : 4.5}
                      fill="#ffffff"
                      stroke="#15803D"
                      strokeWidth="2.5"
                    />
                    {showLabel && (
                      <text
                        x={pt.x}
                        y={184}
                        textAnchor="middle"
                        className="fill-slate-400 text-[10px] tabular-nums"
                      >
                        {commChart.pts.length === 1 ? pt.d.label : pt.d.shortLabel}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {hoverCommIdx !== null && commSeries[hoverCommIdx] && (
              <div className="absolute top-2 right-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-xs shadow-lg pointer-events-none">
                <div className="font-semibold">{commSeries[hoverCommIdx].label}</div>
                <div className="text-emerald-400 font-bold tabular-nums">
                  Comissão: R$ {formatBRL(commSeries[hoverCommIdx].commission)}
                </div>
                <div className="text-slate-300 tabular-nums">
                  {commSeries[hoverCommIdx].orders} pedido(s) • GMV R${' '}
                  {formatBRL(commSeries[hoverCommIdx].gmv)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Vendas ao longo do tempo (Pedidos + Valor Bruto) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            Vendas ao longo do tempo
          </h3>
        </div>

        {salesSeries.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-xs text-slate-400">
            Nenhuma venda válida registrada no período.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <svg viewBox="0 0 360 198" className="w-full h-52 overflow-visible">
                {salesChart.gmvTicks.map((t, idx) => {
                  const ratio = idx / (salesChart.gmvTicks.length - 1);
                  const y = salesChart.yBottom - ratio * (salesChart.yBottom - salesChart.yTop);
                  const leftOrderLabel = Math.round(salesChart.maxOrders * ratio);
                  return (
                    <g key={`sy-${idx}`}>
                      <line
                        x1={salesChart.xStart}
                        y1={y}
                        x2={salesChart.xEnd}
                        y2={y}
                        stroke="currentColor"
                        className="text-slate-200 dark:text-slate-800"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={salesChart.xStart - 8}
                        y={y + 3.5}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] tabular-nums"
                      >
                        {leftOrderLabel}
                      </text>
                      <text
                        x={salesChart.xEnd + 8}
                        y={y + 3.5}
                        textAnchor="start"
                        className="fill-slate-400 text-[10px] tabular-nums"
                      >
                        {formatAxisBrl(t)}
                      </text>
                    </g>
                  );
                })}

                {salesChart.items.map((item, idx) => {
                  const showLabel =
                    salesChart.items.length <= 7 ||
                    idx === 0 ||
                    idx === salesChart.items.length - 1 ||
                    idx % Math.ceil(salesChart.items.length / 5) === 0;
                  return (
                    <g
                      key={item.d.key}
                      onMouseEnter={() => setHoverSalesIdx(idx)}
                      onMouseLeave={() => setHoverSalesIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={item.barX}
                        y={item.barY}
                        width={item.barWidth}
                        height={Math.max(2, item.barH)}
                        rx={4}
                        fill="#0284C7"
                        opacity={hoverSalesIdx === idx ? 0.95 : 0.85}
                      />
                      {showLabel && (
                        <text
                          x={item.cx}
                          y={184}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px] tabular-nums"
                        >
                          {item.d.shortLabel}
                        </text>
                      )}
                    </g>
                  );
                })}

                {salesChart.gmvPath && (
                  <path
                    d={salesChart.gmvPath}
                    fill="none"
                    stroke="#15803D"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {salesChart.items.map((item, idx) => (
                  <circle
                    key={`gmv-dot-${item.d.key}`}
                    cx={item.cx}
                    cy={item.gmvY}
                    r={hoverSalesIdx === idx ? 5.5 : 4}
                    fill="#15803D"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="pointer-events-none"
                  />
                ))}
              </svg>

              {hoverSalesIdx !== null && salesSeries[hoverSalesIdx] && (
                <div className="absolute top-2 right-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-xs shadow-lg pointer-events-none">
                  <div className="font-semibold">{salesSeries[hoverSalesIdx].label}</div>
                  <div className="text-sky-300 font-semibold tabular-nums">
                    Pedidos: {salesSeries[hoverSalesIdx].orders}
                  </div>
                  <div className="text-emerald-400 font-bold tabular-nums">
                    Valor bruto: R$ {formatBRL(salesSeries[hoverSalesIdx].gmv)}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-600" />
                Pedidos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
                Valor bruto
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
