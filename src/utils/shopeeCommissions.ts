export type ShopeeCommissionPeriod =
  | 'Ontem'
  | 'Últimos 7 dias'
  | 'Mês Atual'
  | 'Mês Anterior'
  | 'Últimos 30 dias'
  | 'Personalizado';

export type ShopeeCommissionStatus = 'Concluído' | 'Pendente' | 'Cancelado' | 'Não pago';

export interface ShopeeCommissionLineItem {
  itemId?: string;
  shopId?: string;
  name: string;
  imageUrl?: string;
  productUrl?: string;
  category: string;
  qty: number;
  unitPrice: number;
  gmv: number;
  totalCommission: number;
  shopeeCommission: number;
  sellerCommission: number;
  commissionRatePercent: number;
  attribution: 'Direta' | 'Indireta';
}

export interface ShopeeCommissionItem {
  id: string;
  orderId?: string;
  product: string;
  imageUrl?: string;
  productUrl?: string;
  category: string;
  subId: string;
  attribution: 'Direta' | 'Indireta';
  qty: number;
  salesAmount: number;
  commission: number;
  shopeeCommission: number;
  sellerCommission: number;
  commissionRatePercent: number;
  status: ShopeeCommissionStatus;
  rawStatus?: string;
  purchaseTime?: number;
  purchaseDateBr?: string;
  purchaseDateKey?: string;
  purchaseShortDate?: string;
  purchaseHourKey?: string;
  purchaseWeekKey?: string;
  items: ShopeeCommissionLineItem[];
}

export interface ShopeeCommissionSummary {
  totalOrders: number;
  totalItems: number;
  totalSalesAmount: number;
  totalCommission: number;
  approvedCommission: number;
  pendingCommission: number;
  cancelledCommission: number;
  approvedCount: number;
  pendingCount: number;
  cancelledCount: number;
  unpaidCount: number;
}

export interface ShopeeTimeBucket {
  key: string;
  label: string;
  shortLabel: string;
  sortKey: number;
  commission: number;
  orders: number;
  gmv: number;
}

export interface ShopeeSubIdRanking {
  subId: string;
  commission: number;
  orders: number;
  gmv: number;
}

export interface ShopeeProductRanking {
  key: string;
  itemId?: string;
  shopId?: string;
  name: string;
  imageUrl?: string;
  productUrl?: string;
  unitPrice: number;
  commissionRatePercent: number;
  qtySold: number;
  gmv: number;
  totalCommission: number;
}

export interface ShopeeCategoryRanking {
  category: string;
  commission: number;
  orders: number;
  gmv: number;
}

export interface ShopeeAttributionBreakdown {
  gmv: number;
  commission: number;
  shopeeCommission: number;
  sellerCommission: number;
  sharePercent: number;
}

export interface ShopeeCommissionAnalytics {
  netCommission: number;
  commissionPerOrder: number;
  commissionRateOfGmv: number;
  validGmv: number;
  validItemsSold: number;
  avgPricePerItem: number;
  validOrders: number;
  invalidOrders: number;
  totalOrders: number;
  avgTicket: number;
  realizationRate: number;
  statusCounts: {
    completed: number;
    pending: number;
    cancelled: number;
    unpaid: number;
  };
  directSales: ShopeeAttributionBreakdown;
  indirectSales: ShopeeAttributionBreakdown;
  composition: {
    totalCommission: number;
    shopeeCommission: number;
    sellerCommission: number;
    shopeeSharePercent: number;
    sellerSharePercent: number;
  };
  commissionByDay: ShopeeTimeBucket[];
  commissionByHour: ShopeeTimeBucket[];
  commissionByWeek: ShopeeTimeBucket[];
  salesByDay: ShopeeTimeBucket[];
  bySubId: ShopeeSubIdRanking[];
  topProducts: ShopeeProductRanking[];
  topCategories: ShopeeCategoryRanking[];
  latestSaleDateShort?: string;
}

export interface ResolvedDateRange {
  startSec: number;
  endSec: number;
  startDateStr: string;
  endDateStr: string;
  label: string;
}

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 92;

function getBrtParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const shifted = new Date(date.getTime() + BRT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function brtStartOfDaySec(year: number, month: number, day: number): number {
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - BRT_OFFSET_MS;
  return Math.floor(utcMs / 1000);
}

function brtEndOfDaySec(year: number, month: number, day: number): number {
  const utcMs = Date.UTC(year, month - 1, day, 23, 59, 59) - BRT_OFFSET_MS;
  return Math.floor(utcMs / 1000);
}

function parseYmd(raw?: string): { year: number; month: number; day: number } | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseRatePercent(raw: any): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace('%', '').replace(',', '.').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : 0;
}

function parseNum(raw: any): number {
  const n = parseFloat(String(raw ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

export function parseShopeeSubId(utmContent?: string | null): string {
  if (!utmContent || typeof utmContent !== 'string') return 'Não identificado';
  const parts = utmContent
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Não identificado';
}

export function resolveShopeeCommissionDateRange(params: {
  period?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  now?: Date;
}): { ok: true; range: ResolvedDateRange } | { ok: false; error: string } {
  const now = params.now || new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const today = getBrtParts(now);
  const period = String(params.period || '').trim();

  if (period === 'Personalizado' || (params.startDate && params.endDate && !period)) {
    const start = parseYmd(params.startDate);
    const end = parseYmd(params.endDate);
    if (!start || !end) {
      return {
        ok: false,
        error: 'Informe data inicial e data final válidas (AAAA-MM-DD) para o período personalizado.',
      };
    }
    const startSec = brtStartOfDaySec(start.year, start.month, start.day);
    const endOfEndDaySec = brtEndOfDaySec(end.year, end.month, end.day);
    const endSec = Math.min(nowSec, endOfEndDaySec);
    if (startSec > endOfEndDaySec) {
      return {
        ok: false,
        error: 'A data inicial não pode ser maior que a data final.',
      };
    }
    const spanDays = Math.ceil((endOfEndDaySec - startSec) / 86400);
    if (spanDays > MAX_RANGE_DAYS) {
      return {
        ok: false,
        error: `O intervalo máximo suportado pela API Shopee é de ${MAX_RANGE_DAYS} dias.`,
      };
    }
    const startStr = formatYmd(start.year, start.month, start.day);
    const endStr = formatYmd(end.year, end.month, end.day);
    return {
      ok: true,
      range: {
        startSec,
        endSec: Math.max(startSec, endSec),
        startDateStr: startStr,
        endDateStr: endStr,
        label: `${pad2(start.day)}/${pad2(start.month)}/${start.year} até ${pad2(end.day)}/${pad2(end.month)}/${end.year}`,
      },
    };
  }

  if (period === 'Ontem') {
    const yDate = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
    const y = {
      year: yDate.getUTCFullYear(),
      month: yDate.getUTCMonth() + 1,
      day: yDate.getUTCDate(),
    };
    const ymd = formatYmd(y.year, y.month, y.day);
    return {
      ok: true,
      range: {
        startSec: brtStartOfDaySec(y.year, y.month, y.day),
        endSec: brtEndOfDaySec(y.year, y.month, y.day),
        startDateStr: ymd,
        endDateStr: ymd,
        label: `Ontem (${pad2(y.day)}/${pad2(y.month)}/${y.year})`,
      },
    };
  }

  if (period === 'Mês Atual') {
    const startStr = formatYmd(today.year, today.month, 1);
    const endStr = formatYmd(today.year, today.month, today.day);
    return {
      ok: true,
      range: {
        startSec: brtStartOfDaySec(today.year, today.month, 1),
        endSec: nowSec,
        startDateStr: startStr,
        endDateStr: endStr,
        label: `Mês Atual (${pad2(today.month)}/${today.year})`,
      },
    };
  }

  if (period === 'Mês Anterior') {
    const prevMonthLast = new Date(Date.UTC(today.year, today.month - 1, 0));
    const pYear = prevMonthLast.getUTCFullYear();
    const pMonth = prevMonthLast.getUTCMonth() + 1;
    const pLastDay = prevMonthLast.getUTCDate();
    return {
      ok: true,
      range: {
        startSec: brtStartOfDaySec(pYear, pMonth, 1),
        endSec: brtEndOfDaySec(pYear, pMonth, pLastDay),
        startDateStr: formatYmd(pYear, pMonth, 1),
        endDateStr: formatYmd(pYear, pMonth, pLastDay),
        label: `Mês Anterior (${pad2(pMonth)}/${pYear})`,
      },
    };
  }

  const days =
    period === 'Últimos 30 dias'
      ? 30
      : period === 'Últimos 7 dias'
      ? 7
      : Math.max(1, Math.min(MAX_RANGE_DAYS, Number(params.days) || 7));

  const startDateObj = new Date(Date.UTC(today.year, today.month - 1, today.day - (days - 1)));
  const sYear = startDateObj.getUTCFullYear();
  const sMonth = startDateObj.getUTCMonth() + 1;
  const sDay = startDateObj.getUTCDate();

  return {
    ok: true,
    range: {
      startSec: brtStartOfDaySec(sYear, sMonth, sDay),
      endSec: nowSec,
      startDateStr: formatYmd(sYear, sMonth, sDay),
      endDateStr: formatYmd(today.year, today.month, today.day),
      label: period || `Últimos ${days} dias`,
    },
  };
}

export function mapShopeeOrderStatus(rawStatus?: string): ShopeeCommissionStatus {
  const upper = String(rawStatus || '').toUpperCase().trim();
  if (upper.includes('UNPAID') || upper.includes('NOT_PAID')) {
    return 'Não pago';
  }
  if (upper.includes('COMPLETE') || upper.includes('APPROV') || upper === 'PAID') {
    return 'Concluído';
  }
  if (upper.includes('CANCEL') || upper.includes('INVALID') || upper.includes('REJECT')) {
    return 'Cancelado';
  }
  return 'Pendente';
}

export function isValidCommissionStatus(status: ShopeeCommissionStatus): boolean {
  return status === 'Concluído' || status === 'Pendente';
}

export function normalizeShopeeConversionNode(node: any, idx: number): ShopeeCommissionItem {
  const orders: any[] = Array.isArray(node?.orders) ? node.orders : [];
  const firstOrder = orders[0];
  const rawItems: any[] = orders.flatMap((o) => (Array.isArray(o?.items) ? o.items : []));

  const items: ShopeeCommissionLineItem[] = rawItems.map((it) => {
    const qty = Math.max(1, Number(it?.qty) || 1);
    const unitPrice = parseNum(it?.itemPrice);
    const actualAmt = parseNum(it?.actualAmount);
    const gmv = actualAmt > 0 ? actualAmt : unitPrice * qty;
    const itemShopeeComm = parseNum(it?.itemShopeeCommissionCapped);
    const itemSellerComm = parseNum(it?.itemSellerCommission);
    const itemTotalComm =
      parseNum(it?.itemTotalCommission) ||
      parseNum(it?.itemCommission) ||
      itemShopeeComm + itemSellerComm;

    const shopeeRate = parseRatePercent(it?.itemShopeeCommissionRate);
    const sellerRate = parseRatePercent(it?.itemSellerCommissionRate);
    const rate =
      shopeeRate + sellerRate > 0
        ? Number((shopeeRate + sellerRate).toFixed(2))
        : gmv > 0
        ? Number(((itemTotalComm / gmv) * 100).toFixed(2))
        : 0;

    const attrRaw = String(it?.attributionType || '').toUpperCase();
    const attribution: 'Direta' | 'Indireta' =
      attrRaw.includes('DIFFERENT') || attrRaw.includes('INDIRECT') ? 'Indireta' : 'Direta';

    const shopId = it?.shopId ? String(it.shopId) : undefined;
    const itemId = it?.itemId ? String(it.itemId) : undefined;
    const productUrl =
      shopId && itemId ? `https://shopee.com.br/product/${shopId}/${itemId}` : undefined;

    return {
      itemId,
      shopId,
      name: String(it?.itemName || `Item Shopee #${itemId || idx + 1}`).trim(),
      imageUrl: typeof it?.imageUrl === 'string' && it.imageUrl.trim() ? it.imageUrl.trim() : undefined,
      productUrl,
      category:
        String(it?.globalCategoryLv1Name || it?.categoryLv1Name || '').trim() || 'Sem categoria',
      qty,
      unitPrice: Number(unitPrice.toFixed(2)),
      gmv: Number(gmv.toFixed(2)),
      totalCommission: Number(itemTotalComm.toFixed(4)),
      shopeeCommission: Number(itemShopeeComm.toFixed(4)),
      sellerCommission: Number(itemSellerComm.toFixed(4)),
      commissionRatePercent: rate,
      attribution,
    };
  });

  const firstItem = items[0];
  const totalQty = items.reduce((sum, it) => sum + it.qty, 0) || 1;
  const itemsSalesSum = items.reduce((sum, it) => sum + it.gmv, 0);
  const salesAmount = Number(
    (itemsSalesSum || parseNum(node?.checkoutAmount || node?.totalSales)).toFixed(2)
  );

  const rawShopeeComm =
    parseNum(node?.shopeeCommissionCapped) ||
    items.reduce((sum, it) => sum + it.shopeeCommission, 0);
  const rawSellerComm =
    parseNum(node?.sellerCommission) ||
    items.reduce((sum, it) => sum + it.sellerCommission, 0);
  const rawNetComm =
    parseNum(node?.netCommission) ||
    parseNum(node?.totalCommission) ||
    items.reduce((sum, it) => sum + it.totalCommission, 0) ||
    rawShopeeComm + rawSellerComm;

  const rawStatus = String(
    node?.conversionStatus || node?.orderStatus || firstOrder?.orderStatus || 'PENDING'
  );
  const status = mapShopeeOrderStatus(rawStatus);

  const purchaseTime = Number(node?.purchaseTime || 0) || undefined;
  let purchaseDateBr: string | undefined;
  let purchaseDateKey: string | undefined;
  let purchaseShortDate: string | undefined;
  let purchaseHourKey: string | undefined;
  let purchaseWeekKey: string | undefined;

  if (purchaseTime) {
    const ms = purchaseTime > 1e12 ? purchaseTime : purchaseTime * 1000;
    const p = getBrtParts(new Date(ms));
    purchaseDateKey = `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
    purchaseShortDate = `${pad2(p.day)}/${pad2(p.month)}`;
    purchaseHourKey = `${pad2(p.hour)}:00`;
    purchaseDateBr = `${purchaseDateKey} ${pad2(p.hour)}:${pad2(p.minute)}`;

    // Monday of the week in BRT
    const daysFromMon = (p.weekday + 6) % 7;
    const monDate = new Date(Date.UTC(p.year, p.month - 1, p.day - daysFromMon));
    purchaseWeekKey = `Sem ${pad2(monDate.getUTCDate())}/${pad2(monDate.getUTCMonth() + 1)}`;
  }

  const extraItemsLabel = items.length > 1 ? ` (+${items.length - 1} item)` : '';
  const productName = firstItem?.name
    ? `${firstItem.name}${extraItemsLabel}`
    : `Pedido Shopee #${firstOrder?.orderId || node?.conversionId || idx + 1}`;

  const directCount = items.filter((it) => it.attribution === 'Direta').length;
  const attribution: 'Direta' | 'Indireta' =
    items.length > 0 && directCount === 0 ? 'Indireta' : 'Direta';

  const ratePct =
    salesAmount > 0
      ? Number(((rawNetComm / salesAmount) * 100).toFixed(2))
      : firstItem?.commissionRatePercent || 0;

  return {
    id: String(node?.conversionId || firstOrder?.orderId || `conv-${idx}`),
    orderId: firstOrder?.orderId ? String(firstOrder.orderId) : undefined,
    product: productName,
    imageUrl: firstItem?.imageUrl,
    productUrl: firstItem?.productUrl,
    category: firstItem?.category || 'Sem categoria',
    subId: parseShopeeSubId(node?.utmContent),
    attribution,
    qty: totalQty,
    salesAmount,
    commission: Number(rawNetComm.toFixed(4)),
    shopeeCommission: Number(rawShopeeComm.toFixed(4)),
    sellerCommission: Number(rawSellerComm.toFixed(4)),
    commissionRatePercent: ratePct,
    status,
    rawStatus,
    purchaseTime,
    purchaseDateBr,
    purchaseDateKey,
    purchaseShortDate,
    purchaseHourKey,
    purchaseWeekKey,
    items,
  };
}

export function summarizeShopeeCommissions(
  conversions: ShopeeCommissionItem[]
): ShopeeCommissionSummary {
  let totalItems = 0;
  let totalSalesAmount = 0;
  let totalCommission = 0;
  let approvedCommission = 0;
  let pendingCommission = 0;
  let cancelledCommission = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let unpaidCount = 0;

  for (const c of conversions) {
    const comm = Number(c.commission) || 0;
    const sales = Number(c.salesAmount) || 0;
    const qty = Number(c.qty) || 0;

    if (c.status === 'Concluído') {
      approvedCount += 1;
      approvedCommission += comm;
      totalCommission += comm;
      totalSalesAmount += sales;
      totalItems += qty;
    } else if (c.status === 'Pendente') {
      pendingCount += 1;
      pendingCommission += comm;
      totalCommission += comm;
      totalSalesAmount += sales;
      totalItems += qty;
    } else if (c.status === 'Não pago') {
      unpaidCount += 1;
    } else {
      cancelledCount += 1;
      cancelledCommission += comm;
    }
  }

  return {
    totalOrders: conversions.length,
    totalItems,
    totalSalesAmount: Number(totalSalesAmount.toFixed(2)),
    totalCommission: Number(totalCommission.toFixed(2)),
    approvedCommission: Number(approvedCommission.toFixed(2)),
    pendingCommission: Number(pendingCommission.toFixed(2)),
    cancelledCommission: Number(cancelledCommission.toFixed(2)),
    approvedCount,
    pendingCount,
    cancelledCount,
    unpaidCount,
  };
}

export function buildShopeeCommissionAnalytics(
  conversions: ShopeeCommissionItem[]
): ShopeeCommissionAnalytics {
  let completed = 0;
  let pending = 0;
  let cancelled = 0;
  let unpaid = 0;

  let validGmv = 0;
  let validItemsSold = 0;
  let netCommission = 0;
  let totalShopeeComm = 0;
  let totalSellerComm = 0;

  let directGmv = 0;
  let directComm = 0;
  let directShopee = 0;
  let directSeller = 0;

  let indirectGmv = 0;
  let indirectComm = 0;
  let indirectShopee = 0;
  let indirectSeller = 0;

  const dayMap = new Map<string, ShopeeTimeBucket>();
  const hourMap = new Map<string, ShopeeTimeBucket>();
  const weekMap = new Map<string, ShopeeTimeBucket>();
  const subIdMap = new Map<string, ShopeeSubIdRanking>();
  const productMap = new Map<string, ShopeeProductRanking>();
  const categoryMap = new Map<string, ShopeeCategoryRanking>();

  let latestTs = 0;
  let latestSaleDateShort: string | undefined;

  for (const c of conversions) {
    if (c.status === 'Concluído') completed += 1;
    else if (c.status === 'Pendente') pending += 1;
    else if (c.status === 'Não pago') unpaid += 1;
    else cancelled += 1;

    if (!isValidCommissionStatus(c.status)) continue;

    const comm = Number(c.commission) || 0;
    const shopeeComm =
      Number(c.shopeeCommission) || Math.max(0, comm - (Number(c.sellerCommission) || 0));
    const sellerComm = Number(c.sellerCommission) || 0;
    const sales = Number(c.salesAmount) || 0;
    const qty = Number(c.qty) || 0;

    validGmv += sales;
    validItemsSold += qty;
    netCommission += comm;
    totalShopeeComm += shopeeComm;
    totalSellerComm += sellerComm;

    if (c.purchaseTime && c.purchaseTime > latestTs) {
      latestTs = c.purchaseTime;
      latestSaleDateShort = c.purchaseShortDate;
    }

    // Attribution breakdown (item-level when available, else conversion-level)
    const lineItems = c.items && c.items.length > 0 ? c.items : [];
    if (lineItems.length > 0) {
      for (const it of lineItems) {
        const itComm = Number(it.totalCommission) || 0;
        const itShopee = Number(it.shopeeCommission) || Math.max(0, itComm - (Number(it.sellerCommission) || 0));
        const itSeller = Number(it.sellerCommission) || 0;
        if (it.attribution === 'Indireta') {
          indirectGmv += it.gmv;
          indirectComm += itComm;
          indirectShopee += itShopee;
          indirectSeller += itSeller;
        } else {
          directGmv += it.gmv;
          directComm += itComm;
          directShopee += itShopee;
          directSeller += itSeller;
        }

        // Top products aggregation
        const pKey = it.itemId || it.name.toLowerCase();
        const prevProd = productMap.get(pKey);
        if (prevProd) {
          prevProd.qtySold += it.qty;
          prevProd.gmv += it.gmv;
          prevProd.totalCommission += itComm;
          if (!prevProd.imageUrl && it.imageUrl) prevProd.imageUrl = it.imageUrl;
          if (!prevProd.productUrl && it.productUrl) prevProd.productUrl = it.productUrl;
        } else {
          productMap.set(pKey, {
            key: pKey,
            itemId: it.itemId,
            shopId: it.shopId,
            name: it.name,
            imageUrl: it.imageUrl,
            productUrl: it.productUrl,
            unitPrice: it.unitPrice || it.gmv / Math.max(1, it.qty),
            commissionRatePercent: it.commissionRatePercent,
            qtySold: it.qty,
            gmv: it.gmv,
            totalCommission: itComm,
          });
        }

        // Top categories aggregation
        const cat = it.category || 'Sem categoria';
        const prevCat = categoryMap.get(cat);
        if (prevCat) {
          prevCat.commission += itComm;
          prevCat.orders += 1;
          prevCat.gmv += it.gmv;
        } else {
          categoryMap.set(cat, { category: cat, commission: itComm, orders: 1, gmv: it.gmv });
        }
      }
    } else {
      if (c.attribution === 'Indireta') {
        indirectGmv += sales;
        indirectComm += comm;
        indirectShopee += shopeeComm;
        indirectSeller += sellerComm;
      } else {
        directGmv += sales;
        directComm += comm;
        directShopee += shopeeComm;
        directSeller += sellerComm;
      }

      const pKey = c.id;
      productMap.set(pKey, {
        key: pKey,
        name: c.product,
        imageUrl: c.imageUrl,
        productUrl: c.productUrl,
        unitPrice: qty > 0 ? sales / qty : sales,
        commissionRatePercent: c.commissionRatePercent,
        qtySold: qty,
        gmv: sales,
        totalCommission: comm,
      });

      const cat = c.category || 'Sem categoria';
      const prevCat = categoryMap.get(cat);
      if (prevCat) {
        prevCat.commission += comm;
        prevCat.orders += 1;
        prevCat.gmv += sales;
      } else {
        categoryMap.set(cat, { category: cat, commission: comm, orders: 1, gmv: sales });
      }
    }

    // Sub ID ranking
    const subKey = c.subId || 'Não identificado';
    const prevSub = subIdMap.get(subKey);
    if (prevSub) {
      prevSub.commission += comm;
      prevSub.orders += 1;
      prevSub.gmv += sales;
    } else {
      subIdMap.set(subKey, { subId: subKey, commission: comm, orders: 1, gmv: sales });
    }

    // Time series buckets
    if (c.purchaseDateKey) {
      const sortKey = c.purchaseTime || 0;
      const dayEntry = dayMap.get(c.purchaseDateKey);
      if (dayEntry) {
        dayEntry.commission += comm;
        dayEntry.orders += 1;
        dayEntry.gmv += sales;
      } else {
        dayMap.set(c.purchaseDateKey, {
          key: c.purchaseDateKey,
          label: c.purchaseDateKey,
          shortLabel: c.purchaseShortDate || c.purchaseDateKey.slice(0, 5),
          sortKey,
          commission: comm,
          orders: 1,
          gmv: sales,
        });
      }
    }

    if (c.purchaseHourKey) {
      const hourNum = Number(c.purchaseHourKey.slice(0, 2)) || 0;
      const hourEntry = hourMap.get(c.purchaseHourKey);
      if (hourEntry) {
        hourEntry.commission += comm;
        hourEntry.orders += 1;
        hourEntry.gmv += sales;
      } else {
        hourMap.set(c.purchaseHourKey, {
          key: c.purchaseHourKey,
          label: c.purchaseHourKey,
          shortLabel: c.purchaseHourKey,
          sortKey: hourNum,
          commission: comm,
          orders: 1,
          gmv: sales,
        });
      }
    }

    if (c.purchaseWeekKey) {
      const sortKey = c.purchaseTime || 0;
      const weekEntry = weekMap.get(c.purchaseWeekKey);
      if (weekEntry) {
        weekEntry.commission += comm;
        weekEntry.orders += 1;
        weekEntry.gmv += sales;
      } else {
        weekMap.set(c.purchaseWeekKey, {
          key: c.purchaseWeekKey,
          label: c.purchaseWeekKey,
          shortLabel: c.purchaseWeekKey,
          sortKey,
          commission: comm,
          orders: 1,
          gmv: sales,
        });
      }
    }
  }

  const validOrders = completed + pending;
  const invalidOrders = cancelled + unpaid;
  const totalOrders = validOrders + invalidOrders;
  const totalAttrComm = directComm + indirectComm;
  const totalCompComm = totalShopeeComm + totalSellerComm;

  const round2 = (v: number) => Number(v.toFixed(2));
  const round1 = (v: number) => Number(v.toFixed(1));

  const finalizeBuckets = (map: Map<string, ShopeeTimeBucket>) =>
    Array.from(map.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((b) => ({
        ...b,
        commission: round2(b.commission),
        gmv: round2(b.gmv),
      }));

  const commissionByDay = finalizeBuckets(dayMap);

  return {
    netCommission: round2(netCommission),
    commissionPerOrder: validOrders > 0 ? round2(netCommission / validOrders) : 0,
    commissionRateOfGmv: validGmv > 0 ? round1((netCommission / validGmv) * 100) : 0,
    validGmv: round2(validGmv),
    validItemsSold,
    avgPricePerItem: validItemsSold > 0 ? round2(validGmv / validItemsSold) : 0,
    validOrders,
    invalidOrders,
    totalOrders,
    avgTicket: validOrders > 0 ? round2(validGmv / validOrders) : 0,
    realizationRate: totalOrders > 0 ? round1((validOrders / totalOrders) * 100) : 0,
    statusCounts: {
      completed,
      pending,
      cancelled,
      unpaid,
    },
    directSales: {
      gmv: round2(directGmv),
      commission: round2(directComm),
      shopeeCommission: round2(directShopee),
      sellerCommission: round2(directSeller),
      sharePercent: totalAttrComm > 0 ? round1((directComm / totalAttrComm) * 100) : 0,
    },
    indirectSales: {
      gmv: round2(indirectGmv),
      commission: round2(indirectComm),
      shopeeCommission: round2(indirectShopee),
      sellerCommission: round2(indirectSeller),
      sharePercent: totalAttrComm > 0 ? round1((indirectComm / totalAttrComm) * 100) : 0,
    },
    composition: {
      totalCommission: round2(netCommission),
      shopeeCommission: round2(totalShopeeComm),
      sellerCommission: round2(totalSellerComm),
      shopeeSharePercent: totalCompComm > 0 ? round1((totalShopeeComm / totalCompComm) * 100) : 0,
      sellerSharePercent: totalCompComm > 0 ? round1((totalSellerComm / totalCompComm) * 100) : 0,
    },
    commissionByDay,
    commissionByHour: finalizeBuckets(hourMap),
    commissionByWeek: finalizeBuckets(weekMap),
    salesByDay: commissionByDay,
    bySubId: Array.from(subIdMap.values())
      .map((s) => ({ ...s, commission: round2(s.commission), gmv: round2(s.gmv) }))
      .sort((a, b) => b.commission - a.commission),
    topProducts: Array.from(productMap.values())
      .map((p) => ({
        ...p,
        unitPrice: round2(p.unitPrice),
        gmv: round2(p.gmv),
        totalCommission: round2(p.totalCommission),
        commissionRatePercent:
          p.commissionRatePercent > 0
            ? round1(p.commissionRatePercent)
            : p.gmv > 0
            ? round1((p.totalCommission / p.gmv) * 100)
            : 0,
      }))
      .sort((a, b) => b.totalCommission - a.totalCommission),
    topCategories: Array.from(categoryMap.values())
      .map((cat) => ({ ...cat, commission: round2(cat.commission), gmv: round2(cat.gmv) }))
      .sort((a, b) => b.commission - a.commission),
    latestSaleDateShort,
  };
}
