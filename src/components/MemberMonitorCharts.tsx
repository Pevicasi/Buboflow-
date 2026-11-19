import React, { useMemo, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import {
  DailyFlowPoint,
  MemberMonitorSummary,
  buildSmoothSvgPath,
} from '../utils/memberMonitorAnalytics';

interface MemberMonitorChartsProps {
  summary: MemberMonitorSummary;
}

function pickEvenLabelIndices(len: number): number[] {
  if (len <= 1) return [0];
  if (len <= 4) return Array.from({ length: len }, (_, i) => i);
  return Array.from(
    new Set([
      0,
      Math.round((len - 1) * 0.33),
      Math.round((len - 1) * 0.66),
      len - 1,
    ])
  ).sort((a, b) => a - b);
}

function niceCeil(val: number, minFloor: number): number {
  if (val <= minFloor) return minFloor;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  const normalized = val / magnitude;
  const nice =
    normalized <= 1.2
      ? 1.2
      : normalized <= 1.5
      ? 1.5
      : normalized <= 2
      ? 2
      : normalized <= 3
      ? 3
      : normalized <= 4
      ? 4
      : normalized <= 5
      ? 5
      : normalized <= 8
      ? 8
      : 10;
  return Math.max(minFloor, Math.ceil(nice * magnitude));
}

function formatCompactNumber(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString('pt-BR');
  return v.toFixed(1).replace('.', ',');
}

export const MemberMonitorCharts: React.FC<MemberMonitorChartsProps> = ({ summary }) => {
  const { dailyFlow, weekdayPatterns, totalParticipants } = summary;
  const [hoverEvolIdx, setHoverEvolIdx] = useState<number | null>(null);
  const [hoverBarIdx, setHoverBarIdx] = useState<number | null>(null);
  const [hoverNetIdx, setHoverNetIdx] = useState<number | null>(null);
  const [hoverChurnIdx, setHoverChurnIdx] = useState<number | null>(null);
  const [hoverFlowIdx, setHoverFlowIdx] = useState<number | null>(null);

  const xLabelIndices = useMemo(() => pickEvenLabelIndices(dailyFlow.length), [dailyFlow.length]);

  /* --------------------------------------------------------------------------
   * 1. EVOLUÇÃO DE MEMBROS (Total de Membros + Média Móvel 7 dias)
   * ------------------------------------------------------------------------ */
  const evolChart = useMemo(() => {
    const xStart = 48;
    const xEnd = 340;
    const yTop = 24;
    const yBottom = 160;
    const maxVal = niceCeil(
      Math.max(
        totalParticipants,
        ...dailyFlow.map((d) => Math.max(d.total, d.movingAvg7d))
      ) * 1.12,
      10
    );
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(maxVal * r));
    const denom = Math.max(1, dailyFlow.length - 1);
    const mapY = (v: number) => yBottom - (Math.max(0, v) / maxVal) * (yBottom - yTop);
    const totalPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapY(d.total),
      d,
    }));
    const avgPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapY(d.movingAvg7d),
      d,
    }));
    const linePath = buildSmoothSvgPath(totalPts);
    const areaPath =
      totalPts.length > 0
        ? `${linePath} L${totalPts[totalPts.length - 1].x.toFixed(1)} ${yBottom} L${totalPts[0].x.toFixed(1)} ${yBottom} Z`
        : '';
    const avgPath = buildSmoothSvgPath(avgPts);
    return { ticks, maxVal, totalPts, avgPts, linePath, areaPath, avgPath, yTop, yBottom };
  }, [dailyFlow, totalParticipants]);

  /* --------------------------------------------------------------------------
   * 2. ENTRADAS VS SAÍDAS DIÁRIAS
   * ------------------------------------------------------------------------ */
  const visibleBars = useMemo(
    () => (dailyFlow.length <= 10 ? dailyFlow : dailyFlow.slice(-10)),
    [dailyFlow]
  );
  const barChart = useMemo(() => {
    const maxVal = niceCeil(
      Math.max(...visibleBars.map((d) => Math.max(d.entries, d.exits)), 0),
      8
    );
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(maxVal * r));
    const labelIdx = pickEvenLabelIndices(visibleBars.length);
    return { maxVal, ticks, labelIdx };
  }, [visibleBars]);

  /* --------------------------------------------------------------------------
   * 3. SALDO DIÁRIO (CRESCIMENTO LÍQUIDO) — supports positive AND negative values
   * ------------------------------------------------------------------------ */
  const netChart = useMemo(() => {
    const xStart = 48;
    const xEnd = 340;
    const yTop = 24;
    const yBottom = 160;
    const rawMax = Math.max(2, ...dailyFlow.map((d) => d.net));
    const rawMin = Math.min(0, ...dailyFlow.map((d) => d.net));
    const maxY = Math.max(2, Math.ceil(rawMax / 2) * 2);
    const minY = rawMin < 0 ? Math.floor(rawMin / 2) * 2 : -2;
    const span = Math.max(2, maxY - minY);
    const mapY = (v: number) => yBottom - ((v - minY) / span) * (yBottom - yTop);
    const zeroY = mapY(0);
    const step = span <= 8 ? 2 : Math.ceil(span / 4);
    const ticks: number[] = [];
    for (let v = minY; v <= maxY; v += step) {
      ticks.push(v);
    }
    if (!ticks.includes(0)) ticks.push(0);
    if (!ticks.includes(maxY)) ticks.push(maxY);
    ticks.sort((a, b) => a - b);

    const denom = Math.max(1, dailyFlow.length - 1);
    const pts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapY(d.net),
      d,
    }));
    const linePath = buildSmoothSvgPath(pts);
    const areaPath =
      pts.length > 0
        ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
        : '';
    return { ticks, pts, linePath, areaPath, zeroY, yTop, yBottom };
  }, [dailyFlow]);

  /* --------------------------------------------------------------------------
   * 4. TAXA DE CHURN DIÁRIA (%) — Churn Diário (black area) + Média 7 dias (red)
   * ------------------------------------------------------------------------ */
  const churnChart = useMemo(() => {
    const xStart = 50;
    const xEnd = 340;
    const yTop = 24;
    const yBottom = 160;
    const peak = Math.max(
      ...dailyFlow.map((d) => Math.max(d.churnPct, d.churnAvg7d)),
      0
    );
    const maxY = Math.max(80, Math.ceil(peak / 20) * 20);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(maxY * r));
    const mapY = (v: number) => yBottom - (Math.max(0, v) / maxY) * (yBottom - yTop);
    const denom = Math.max(1, dailyFlow.length - 1);
    const churnPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapY(d.churnPct),
      d,
    }));
    const avgPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapY(d.churnAvg7d),
      d,
    }));
    const linePath = buildSmoothSvgPath(churnPts);
    const areaPath =
      churnPts.length > 0
        ? `${linePath} L${churnPts[churnPts.length - 1].x.toFixed(1)} ${yBottom} L${churnPts[0].x.toFixed(1)} ${yBottom} Z`
        : '';
    const avgPath = buildSmoothSvgPath(avgPts);
    return { ticks, maxY, churnPts, avgPts, linePath, areaPath, avgPath, yTop, yBottom };
  }, [dailyFlow]);

  /* --------------------------------------------------------------------------
   * 5. PADRÃO POR DIA DA SEMANA (Média de Entradas / Saídas / Churn %)
   * ------------------------------------------------------------------------ */
  const maxWdEntries = Math.max(1, ...weekdayPatterns.map((w) => w.avgEntries));
  const maxWdExits = Math.max(1, ...weekdayPatterns.map((w) => w.avgExits));
  const maxWdChurn = Math.max(1, ...weekdayPatterns.map((w) => w.churnNum));

  /* --------------------------------------------------------------------------
   * 6. FLUXO DE PARTICIPANTES (Dual-axis combo: Saldo bars + Entradas + Saídas + Total Membros)
   * ------------------------------------------------------------------------ */
  const flowChart = useMemo(() => {
    const xStart = 54;
    const xEnd = 666;
    const yTop = 22;
    const yBottom = 178;

    // Left axis: Entradas, Saídas, Saldo (even 4-interval scale: [-step, 0, step, 2*step, 3*step] so 0 aligns strictly with gridline!)
    const posPeak = Math.max(
      6,
      ...dailyFlow.map((d) => Math.max(d.entries, d.exits, d.net))
    );
    const negPeak = Math.max(
      0,
      ...dailyFlow.map((d) => (d.net < 0 ? Math.abs(d.net) : 0))
    );
    const step = Math.max(2, Math.ceil(posPeak / 3), Math.ceil(negPeak));
    const leftMin = -step;
    const leftMax = step * 3;
    const leftSpan = leftMax - leftMin; // 4 * step
    const mapLeftY = (v: number) => yBottom - ((v - leftMin) / leftSpan) * (yBottom - yTop);
    const leftZeroY = mapLeftY(0);
    const leftTicks = [leftMin, 0, step, step * 2, leftMax];

    // Right axis: Total Membros (even 4-interval scale)
    const rightMax = niceCeil(
      Math.max(totalParticipants, ...dailyFlow.map((d) => d.total)) * 1.15,
      10
    );
    const rightTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(rightMax * r));
    const mapRightY = (v: number) => yBottom - (Math.max(0, v) / rightMax) * (yBottom - yTop);

    const denom = Math.max(1, dailyFlow.length - 1);
    const slotW = (xEnd - xStart) / Math.max(1, dailyFlow.length);
    const barW = Math.max(12, Math.min(44, slotW * 0.45));

    const entryPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapLeftY(d.entries),
      d,
    }));
    const exitPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapLeftY(d.exits),
      d,
    }));
    const totalPts = dailyFlow.map((d, i) => ({
      x: xStart + (i / denom) * (xEnd - xStart),
      y: mapRightY(d.total),
      d,
    }));
    const saldoBars = dailyFlow.map((d, i) => {
      const cx = xStart + (i / denom) * (xEnd - xStart);
      const yVal = mapLeftY(d.net);
      const y = Math.min(yVal, leftZeroY);
      const h = Math.max(d.net === 0 ? 0 : 3, Math.abs(yVal - leftZeroY));
      return { x: cx - barW / 2, y, w: barW, h, cx, d };
    });

    return {
      leftTicks,
      rightTicks,
      leftZeroY,
      entryPts,
      exitPts,
      totalPts,
      saldoBars,
      entryPath: buildSmoothSvgPath(entryPts),
      exitPath: buildSmoothSvgPath(exitPts),
      totalPath: buildSmoothSvgPath(totalPts, 0.15),
      yTop,
      yBottom,
      xStart,
      xEnd,
    };
  }, [dailyFlow, totalParticipants]);

  const activeEvol: DailyFlowPoint | null =
    hoverEvolIdx !== null ? dailyFlow[hoverEvolIdx] || null : null;
  const activeBar: DailyFlowPoint | null =
    hoverBarIdx !== null ? visibleBars[hoverBarIdx] || null : null;
  const activeNet: DailyFlowPoint | null =
    hoverNetIdx !== null ? dailyFlow[hoverNetIdx] || null : null;
  const activeChurn: DailyFlowPoint | null =
    hoverChurnIdx !== null ? dailyFlow[hoverChurnIdx] || null : null;
  const activeFlow: DailyFlowPoint | null =
    hoverFlowIdx !== null ? dailyFlow[hoverFlowIdx] || null : null;

  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      {/* Row 1: Evolução de Membros & Entradas vs Saídas Diárias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {/* 1. Evolução de Membros */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 min-w-0 relative">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Evolução de Membros
            </h2>
            {activeEvol && (
              <div className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-200 mr-2">
                  {activeEvol.label}
                </span>
                <span className="text-[#15803D] font-semibold mr-2">
                  Total: {activeEvol.total.toLocaleString('pt-BR')}
                </span>
                <span className="text-[#0284C7] font-semibold">
                  Média: {formatCompactNumber(activeEvol.movingAvg7d)}
                </span>
              </div>
            )}
          </div>

          <svg
            viewBox="0 0 360 192"
            className="w-full h-52 block select-none"
            onMouseLeave={() => setHoverEvolIdx(null)}
          >
            <defs>
              <linearGradient id="buboMemberGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#15803D" stopOpacity="0.30" />
                <stop offset="100%" stopColor="#15803D" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {evolChart.ticks.map((v, idx) => {
              const y =
                evolChart.yBottom -
                (v / evolChart.maxVal) * (evolChart.yBottom - evolChart.yTop);
              return (
                <g key={idx}>
                  <line
                    x1="44"
                    y1={y}
                    x2="346"
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <text x="38" y={y + 4} textAnchor="end" fontSize="9.5" fill="#94A3B8">
                    {v.toLocaleString('pt-BR')}
                  </text>
                </g>
              );
            })}
            {evolChart.areaPath && <path d={evolChart.areaPath} fill="url(#buboMemberGrad)" />}
            {evolChart.linePath && (
              <path
                d={evolChart.linePath}
                fill="none"
                stroke="#15803D"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
            )}
            {evolChart.avgPath && (
              <path
                d={evolChart.avgPath}
                fill="none"
                stroke="#0284C7"
                strokeWidth="1.8"
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            )}
            {hoverEvolIdx !== null && evolChart.totalPts[hoverEvolIdx] && (
              <g>
                <line
                  x1={evolChart.totalPts[hoverEvolIdx].x}
                  y1={evolChart.yTop}
                  x2={evolChart.totalPts[hoverEvolIdx].x}
                  y2={evolChart.yBottom}
                  stroke="#CBD5E1"
                  strokeWidth="1"
                />
                <circle
                  cx={evolChart.totalPts[hoverEvolIdx].x}
                  cy={evolChart.totalPts[hoverEvolIdx].y}
                  r="4"
                  fill="#15803D"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />
              </g>
            )}
            {/* Interactive hover hit zones */}
            {evolChart.totalPts.map((pt, idx) => {
              const colW = (340 - 48) / Math.max(1, evolChart.totalPts.length);
              return (
                <rect
                  key={idx}
                  x={pt.x - colW / 2}
                  y={evolChart.yTop}
                  width={colW}
                  height={evolChart.yBottom - evolChart.yTop}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverEvolIdx(idx)}
                  onClick={() => setHoverEvolIdx(idx)}
                />
              );
            })}
            {xLabelIndices.map((idx) => {
              const pt = evolChart.totalPts[idx];
              if (!pt) return null;
              return (
                <text key={idx} x={pt.x} y="180" textAnchor="middle" fontSize="10" fill="#64748B">
                  {pt.d.label}
                </text>
              );
            })}
          </svg>

          <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium mt-2">
            <span className="inline-flex items-center gap-1.5 text-[#0284C7]">
              <span className="w-3 h-0.5 bg-[#0284C7] rounded-full" />
              Média Móvel (7 dias)
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#15803D] dark:text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
              Total de Membros ({totalParticipants.toLocaleString('pt-BR')})
            </span>
          </div>
        </div>

        {/* 2. Entradas vs Saídas Diárias */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 min-w-0 relative">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Entradas vs Saídas Diárias
            </h2>
            {activeBar && (
              <div className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-200 mr-2">
                  {activeBar.label}
                </span>
                <span className="text-[#16A34A] font-semibold mr-2">
                  Entradas: {activeBar.entries}
                </span>
                <span className="text-[#EF4444] font-semibold">
                  Saídas: {activeBar.exits}
                </span>
              </div>
            )}
          </div>

          <svg
            viewBox="0 0 360 192"
            className="w-full h-52 block select-none"
            onMouseLeave={() => setHoverBarIdx(null)}
          >
            {barChart.ticks.map((v, idx) => {
              const y = 160 - (v / barChart.maxVal) * (160 - 24);
              return (
                <g key={idx}>
                  <line
                    x1="36"
                    y1={y}
                    x2="346"
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <text x="30" y={y + 4} textAnchor="end" fontSize="9.5" fill="#94A3B8">
                    {v}
                  </text>
                </g>
              );
            })}
            {visibleBars.map((d, idx) => {
              const slotW = (344 - 42) / Math.max(1, visibleBars.length);
              const centerX = 42 + idx * slotW + slotW / 2;
              const barW = Math.max(6, Math.min(16, slotW * 0.34));
              const eH = d.entries > 0 ? Math.max(4, (d.entries / barChart.maxVal) * 136) : 0;
              const xH = d.exits > 0 ? Math.max(4, (d.exits / barChart.maxVal) * 136) : 0;
              return (
                <g
                  key={d.dateKey}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverBarIdx(idx)}
                  onClick={() => setHoverBarIdx(idx)}
                >
                  {hoverBarIdx === idx && (
                    <line
                      x1={centerX}
                      y1="24"
                      x2={centerX}
                      y2="160"
                      stroke="#CBD5E1"
                      strokeWidth="1"
                    />
                  )}
                  <rect
                    x={centerX - barW - 1}
                    y={160 - eH}
                    width={barW}
                    height={eH}
                    rx="3"
                    fill="#16A34A"
                  />
                  <rect
                    x={centerX + 1}
                    y={160 - xH}
                    width={barW}
                    height={xH}
                    rx="3"
                    fill="#EF4444"
                  />
                  <rect
                    x={centerX - slotW / 2}
                    y="24"
                    width={slotW}
                    height="136"
                    fill="transparent"
                  />
                  {barChart.labelIdx.includes(idx) && (
                    <text
                      x={centerX}
                      y="180"
                      textAnchor="middle"
                      fontSize="10"
                      fill="#64748B"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium mt-2">
            <span className="inline-flex items-center gap-1.5 text-[#16A34A]">
              <span className="w-3 h-3 rounded-xs bg-[#16A34A]" /> Entradas
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#EF4444]">
              <span className="w-3 h-3 rounded-xs bg-[#EF4444]" /> Saídas
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: Saldo Diário (Crescimento Líquido) & Taxa de Churn Diária (%) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {/* 3. Saldo Diário (Crescimento Líquido) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 min-w-0 relative">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Saldo Diário (Crescimento Líquido)
            </h2>
            {activeNet && (
              <div className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-200 mr-2">
                  {activeNet.label}
                </span>
                <span
                  className={`font-semibold ${
                    activeNet.net >= 0 ? 'text-[#16A34A]' : 'text-[#EF4444]'
                  }`}
                >
                  Saldo: {activeNet.net > 0 ? `+${activeNet.net}` : activeNet.net}
                </span>
              </div>
            )}
          </div>

          <svg
            viewBox="0 0 360 192"
            className="w-full h-52 block select-none"
            onMouseLeave={() => setHoverNetIdx(null)}
          >
            <defs>
              <linearGradient id="buboNetGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16A34A" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#16A34A" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {netChart.ticks.map((v, idx) => {
              const span = Math.max(
                2,
                netChart.ticks[netChart.ticks.length - 1] - netChart.ticks[0]
              );
              const y =
                netChart.yBottom -
                ((v - netChart.ticks[0]) / span) * (netChart.yBottom - netChart.yTop);
              return (
                <g key={idx}>
                  <line
                    x1="44"
                    y1={y}
                    x2="346"
                    y2={y}
                    stroke={v === 0 ? '#CBD5E1' : '#E2E8F0'}
                    strokeDasharray={v === 0 ? '4 2' : '3 3'}
                  />
                  <text x="38" y={y + 4} textAnchor="end" fontSize="9.5" fill="#94A3B8">
                    {v}
                  </text>
                </g>
              );
            })}
            {netChart.areaPath && <path d={netChart.areaPath} fill="url(#buboNetGrad)" />}
            {netChart.linePath && (
              <path
                d={netChart.linePath}
                fill="none"
                stroke="#16A34A"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            )}
            {hoverNetIdx !== null && netChart.pts[hoverNetIdx] && (
              <g>
                <line
                  x1={netChart.pts[hoverNetIdx].x}
                  y1={netChart.yTop}
                  x2={netChart.pts[hoverNetIdx].x}
                  y2={netChart.yBottom}
                  stroke="#CBD5E1"
                  strokeWidth="1"
                />
                <circle
                  cx={netChart.pts[hoverNetIdx].x}
                  cy={netChart.pts[hoverNetIdx].y}
                  r="4"
                  fill="#16A34A"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />
              </g>
            )}
            {netChart.pts.map((pt, idx) => {
              const colW = (340 - 48) / Math.max(1, netChart.pts.length);
              return (
                <rect
                  key={idx}
                  x={pt.x - colW / 2}
                  y={netChart.yTop}
                  width={colW}
                  height={netChart.yBottom - netChart.yTop}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverNetIdx(idx)}
                  onClick={() => setHoverNetIdx(idx)}
                />
              );
            })}
            {xLabelIndices.map((idx) => {
              const pt = netChart.pts[idx];
              if (!pt) return null;
              return (
                <text key={idx} x={pt.x} y="180" textAnchor="middle" fontSize="10" fill="#64748B">
                  {pt.d.label}
                </text>
              );
            })}
          </svg>

          <div className="flex items-center justify-center gap-4 text-xs font-medium mt-2">
            <span className="inline-flex items-center gap-1.5 text-[#16A34A]">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-[#16A34A] bg-white" />
              Saldo Diário
            </span>
          </div>
        </div>

        {/* 4. Taxa de Churn Diária (%) */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 min-w-0 relative">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Taxa de Churn Diária (%)
            </h2>
            {activeChurn && (
              <div className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 tabular-nums">
                <span className="font-semibold text-slate-700 dark:text-slate-200 mr-2">
                  {activeChurn.label}
                </span>
                <span className="text-slate-900 dark:text-white font-semibold mr-2">
                  Churn: {activeChurn.churnPct}%
                </span>
                <span className="text-[#EF4444] font-semibold">
                  Média 7d: {activeChurn.churnAvg7d}%
                </span>
              </div>
            )}
          </div>

          <svg
            viewBox="0 0 360 192"
            className="w-full h-52 block select-none"
            onMouseLeave={() => setHoverChurnIdx(null)}
          >
            <defs>
              <linearGradient id="buboChurnGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1E293B" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#1E293B" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <text x="14" y="96" textAnchor="middle" fontSize="10" fill="#64748B">
              %
            </text>
            {churnChart.ticks.map((v, idx) => {
              const y =
                churnChart.yBottom -
                (v / churnChart.maxY) * (churnChart.yBottom - churnChart.yTop);
              return (
                <g key={idx}>
                  <line
                    x1="46"
                    y1={y}
                    x2="346"
                    y2={y}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <text x="40" y={y + 4} textAnchor="end" fontSize="9.5" fill="#94A3B8">
                    {v}
                  </text>
                </g>
              );
            })}
            {churnChart.areaPath && <path d={churnChart.areaPath} fill="url(#buboChurnGrad)" />}
            {churnChart.avgPath && (
              <path
                d={churnChart.avgPath}
                fill="none"
                stroke="#EF4444"
                strokeWidth="2"
                strokeDasharray="4 3"
                strokeLinecap="round"
              />
            )}
            {churnChart.linePath && (
              <path
                d={churnChart.linePath}
                fill="none"
                stroke="#0F172A"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            )}
            {hoverChurnIdx !== null && churnChart.churnPts[hoverChurnIdx] && (
              <g>
                <line
                  x1={churnChart.churnPts[hoverChurnIdx].x}
                  y1={churnChart.yTop}
                  x2={churnChart.churnPts[hoverChurnIdx].x}
                  y2={churnChart.yBottom}
                  stroke="#CBD5E1"
                  strokeWidth="1"
                />
                <circle
                  cx={churnChart.churnPts[hoverChurnIdx].x}
                  cy={churnChart.churnPts[hoverChurnIdx].y}
                  r="4"
                  fill="#0F172A"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />
              </g>
            )}
            {churnChart.churnPts.map((pt, idx) => {
              const colW = (340 - 50) / Math.max(1, churnChart.churnPts.length);
              return (
                <rect
                  key={idx}
                  x={pt.x - colW / 2}
                  y={churnChart.yTop}
                  width={colW}
                  height={churnChart.yBottom - churnChart.yTop}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverChurnIdx(idx)}
                  onClick={() => setHoverChurnIdx(idx)}
                />
              );
            })}
            {xLabelIndices.map((idx) => {
              const pt = churnChart.churnPts[idx];
              if (!pt) return null;
              return (
                <text key={idx} x={pt.x} y="180" textAnchor="middle" fontSize="10" fill="#64748B">
                  {pt.d.label}
                </text>
              );
            })}
          </svg>

          <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium mt-2">
            <span className="inline-flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-900 dark:border-slate-100 bg-white dark:bg-slate-900" />
              Churn Diário
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#EF4444]">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-[#EF4444] bg-white" />
              Média 7 dias
            </span>
          </div>
        </div>
      </div>

      {/* 5. Padrão por Dia da Semana (Média de Entradas, Média de Saídas, Média de Churn %) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 space-y-6 min-w-0">
        <h2 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white">
          Padrão por Dia da Semana
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Média de Entradas */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-center text-[#15803D] dark:text-emerald-400">
              Média de Entradas
            </h3>
            {weekdayPatterns.map((w) => {
              const ratio = w.avgEntries / maxWdEntries;
              const shade =
                w.avgEntries <= 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-slate-800 dark:text-slate-200'
                  : ratio >= 0.75
                  ? 'bg-emerald-500 text-slate-950'
                  : ratio >= 0.35
                  ? 'bg-emerald-400 text-slate-950'
                  : 'bg-emerald-200 text-slate-900';
              return (
                <div key={w.day} className="flex items-center gap-3">
                  <span className="w-18 text-xs text-slate-600 dark:text-slate-300 shrink-0">
                    {w.day}
                  </span>
                  <div
                    className={`flex-1 py-2.5 rounded-lg text-center font-bold text-sm tabular-nums ${shade}`}
                  >
                    {formatCompactNumber(w.avgEntries)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Média de Saídas */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-center text-rose-600 dark:text-rose-400">
              Média de Saídas
            </h3>
            {weekdayPatterns.map((w) => {
              const ratio = w.avgExits / maxWdExits;
              const shade =
                w.avgExits <= 0
                  ? 'bg-rose-50 dark:bg-rose-950/30 text-slate-800 dark:text-slate-200'
                  : ratio >= 0.75
                  ? 'bg-rose-500 text-slate-950'
                  : ratio >= 0.35
                  ? 'bg-rose-400 text-slate-950'
                  : 'bg-rose-200 text-slate-900';
              return (
                <div key={w.day} className="flex items-center gap-3">
                  <span className="w-18 text-xs text-slate-600 dark:text-slate-300 shrink-0">
                    {w.day}
                  </span>
                  <div
                    className={`flex-1 py-2.5 rounded-lg text-center font-bold text-sm tabular-nums ${shade}`}
                  >
                    {formatCompactNumber(w.avgExits)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Média de Churn (%) */}
          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-center text-amber-600 dark:text-amber-400">
              Média de Churn (%)
            </h3>
            {weekdayPatterns.map((w) => {
              const ratio = w.churnNum / maxWdChurn;
              const shade =
                w.churnNum <= 0
                  ? 'bg-amber-50 dark:bg-amber-950/30 text-slate-800 dark:text-slate-200'
                  : ratio >= 0.75
                  ? 'bg-amber-500 text-slate-950'
                  : ratio >= 0.35
                  ? 'bg-amber-300 text-slate-950'
                  : 'bg-amber-100 text-slate-900';
              return (
                <div key={w.day} className="flex items-center gap-3">
                  <span className="w-18 text-xs text-slate-600 dark:text-slate-300 shrink-0">
                    {w.day}
                  </span>
                  <div
                    className={`flex-1 py-2.5 rounded-lg text-center font-bold text-sm tabular-nums ${shade}`}
                  >
                    {w.churnPct}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200/70 dark:border-sky-800/60 p-4 flex items-start gap-3 text-xs sm:text-sm text-sky-900 dark:text-sky-200">
          <Lightbulb className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
          <p>
            <strong>Dica:</strong> Use esses padrões para otimizar o timing de envios e convites.
            Dias com alta entrada são ideais para campanhas, enquanto dias com alto churn podem
            indicar necessidade de engajamento.
          </p>
        </div>
      </div>

      {/* 6. Fluxo de Participantes (Combo Chart: Saldo bars + Entradas + Saídas + Total Membros) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 min-w-0 relative">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white">
            Fluxo de Participantes
          </h2>
          {activeFlow && (
            <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 tabular-nums">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {activeFlow.label}
              </span>
              <span className="text-[#16A34A] font-semibold">Entradas: {activeFlow.entries}</span>
              <span className="text-[#EF4444] font-semibold">Saídas: {activeFlow.exits}</span>
              <span className="text-slate-600 dark:text-slate-300 font-semibold">
                Saldo: {activeFlow.net > 0 ? `+${activeFlow.net}` : activeFlow.net}
              </span>
              <span className="text-[#0284C7] font-semibold">
                Total: {activeFlow.total.toLocaleString('pt-BR')}
              </span>
            </div>
          )}
        </div>

        <svg
          viewBox="0 0 720 216"
          className="w-full h-56 sm:h-64 block select-none"
          onMouseLeave={() => setHoverFlowIdx(null)}
        >
          {/* Horizontal gridlines + Left Y axis + Right Y axis */}
          {flowChart.rightTicks.map((rv, idx) => {
            const frac = idx / Math.max(1, flowChart.rightTicks.length - 1);
            const y = flowChart.yBottom - frac * (flowChart.yBottom - flowChart.yTop);
            const lv = flowChart.leftTicks[idx] ?? 0;
            return (
              <g key={idx}>
                <line
                  x1="44"
                  y1={y}
                  x2="676"
                  y2={y}
                  stroke={lv === 0 ? '#CBD5E1' : '#E2E8F0'}
                  strokeDasharray={lv === 0 ? '4 2' : '3 3'}
                />
                <text x="36" y={y + 4} textAnchor="end" fontSize="11" fill="#94A3B8">
                  {lv}
                </text>
                <text x="684" y={y + 4} textAnchor="start" fontSize="11" fill="#94A3B8">
                  {rv.toLocaleString('pt-BR')}
                </text>
              </g>
            );
          })}

          {/* Gray Saldo bars */}
          {flowChart.saldoBars.map((b, idx) => (
            <rect
              key={idx}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx="3"
              fill="#CBD5E1"
              fillOpacity="0.85"
            />
          ))}

          {/* Green Entradas smooth curve */}
          {flowChart.entryPath && (
            <path
              d={flowChart.entryPath}
              fill="none"
              stroke="#15803D"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          )}

          {/* Red Saídas smooth curve */}
          {flowChart.exitPath && (
            <path
              d={flowChart.exitPath}
              fill="none"
              stroke="#EF4444"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          )}

          {/* Blue dashed Total Membros line + dots */}
          {flowChart.totalPath && (
            <path
              d={flowChart.totalPath}
              fill="none"
              stroke="#0284C7"
              strokeWidth="2.4"
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          )}
          {flowChart.totalPts.length <= 16 &&
            flowChart.totalPts.map((pt, idx) => (
              <circle
                key={idx}
                cx={pt.x}
                cy={pt.y}
                r="3.8"
                fill="#0284C7"
                stroke="#FFFFFF"
                strokeWidth="1.6"
              />
            ))}

          {/* Hover guide */}
          {hoverFlowIdx !== null && flowChart.totalPts[hoverFlowIdx] && (
            <line
              x1={flowChart.totalPts[hoverFlowIdx].x}
              y1={flowChart.yTop}
              x2={flowChart.totalPts[hoverFlowIdx].x}
              y2={flowChart.yBottom}
              stroke="#94A3B8"
              strokeWidth="1"
            />
          )}

          {/* Interactive hit regions */}
          {flowChart.totalPts.map((pt, idx) => {
            const colW = (flowChart.xEnd - flowChart.xStart) / Math.max(1, flowChart.totalPts.length);
            return (
              <rect
                key={idx}
                x={pt.x - colW / 2}
                y={flowChart.yTop}
                width={colW}
                height={flowChart.yBottom - flowChart.yTop}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverFlowIdx(idx)}
                onClick={() => setHoverFlowIdx(idx)}
              />
            );
          })}

          {xLabelIndices.map((idx) => {
            const pt = flowChart.totalPts[idx];
            if (!pt) return null;
            return (
              <text key={idx} x={pt.x} y="200" textAnchor="middle" fontSize="11.5" fill="#64748B">
                {pt.d.label}
              </text>
            );
          })}
        </svg>

        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-5 text-xs font-medium mt-2">
          <span className="inline-flex items-center gap-1.5 text-[#15803D] dark:text-emerald-400">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[#15803D] bg-white" />
            Entradas
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="w-3 h-3 rounded-xs bg-slate-300" />
            Saldo
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#EF4444]">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[#EF4444] bg-white" />
            Saídas
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#0284C7]">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[#0284C7] bg-white" />
            Total Membros
          </span>
        </div>
      </div>
    </div>
  );
};
