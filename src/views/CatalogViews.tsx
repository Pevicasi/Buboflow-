import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Package,
  Star,
  Tag,
  Ticket,
  Search,
  RefreshCw,
  Eye,
  Send,
  MoreVertical,
  Plus,
  X,
  Calendar,
  Copy,
  Trash2,
  ListOrdered,
  Sparkles,
  Download,
  Loader2,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  Coupon,
  Marketplace,
  Product,
  ProductArtworkKey,
} from '../types';
import { MARKETPLACES, VITRINE_CATEGORIES } from '../data/initialData';
import { ProductArtwork } from '../components/ProductArtwork';
import { WhatsAppMockup } from '../components/WhatsAppMockup';
import {
  buildAffiliateLink,
  detectMarketplaceFromUrl,
  formatBRL,
  getPreviewDomain,
  renderProductMessage,
} from '../utils/templateEngine';
import {
  cleanupExpiredMlCouponsApi,
  convertLinkApi,
  extractOfferUrlApi,
  fetchPlatformCategoriesApi,
  searchPlatformsApi,
} from '../utils/apiClient';
import { DEFAULT_ML_COUPON_MAX_AGE_HOURS } from '../utils/mercadoLivreCoupons';
import { needsAffiliateReconversion } from '../utils/affiliateUrlRules';
import { FALLBACK_PLATFORM_CATEGORIES, PlatformCategory } from '../utils/catalogCategories';
import {
  isGroupActiveInSegment,
  matchesSegment,
  normalizeSegmentName,
} from '../utils/segmentScoping';

function getPlatformAccent(platform: Marketplace): string {
  switch (platform) {
    case 'Mercado Livre':
      return 'bg-[#FACC15] text-slate-900';
    case 'Shopee':
      return 'bg-[#EA580C] text-white';
    case 'Amazon':
      return 'bg-[#F59E0B] text-slate-900';
    case 'Magalu':
      return 'bg-[#2563EB] text-white';
    case 'Netshoes':
      return 'bg-[#7E22CE] text-white';
    case 'AliExpress':
      return 'bg-[#EF4444] text-white';
  }
}

interface CatalogListProps {
  mode: 'produtos' | 'favoritos' | 'vitrine';
}

export const ProductsCatalogView: React.FC<CatalogListProps> = ({ mode }) => {
  const {
    products,
    setProducts,
    segments,
    activeSegment,
    integrations,
    dispatchGroups,
    getTemplateForPlatform,
    dispatchOfferNow,
    setSchedules,
    queues,
    setQueues,
    notify,
    globalSearch,
  } = useApp();

  const [platformFilter, setPlatformFilter] = useState<string>('Todas as Plataformas');
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas as Categorias');
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('Todas as Subcategorias');
  const [platformCategories, setPlatformCategories] = useState<PlatformCategory[]>(
    FALLBACK_PLATFORM_CATEGORIES['Todas as Plataformas']
  );
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>(
    mode === 'vitrine' ? 'Relevância' : 'Ordenar por'
  );
  const [priorityFilter, setPriorityFilter] = useState<string>('Todos os Produtos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Live Marketplace Search & Unlimited Pagination State
  const [liveOffers, setLiveOffers] = useState<Product[]>([]);
  const [isSearchingLive, setIsSearchingLive] = useState<boolean>(false);
  const [liveWarnings, setLiveWarnings] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(10);
  const [customPageSizeMode, setCustomPageSizeMode] = useState<boolean>(false);
  const [customPageSizeInput, setCustomPageSizeInput] = useState<string>('10');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [vitrinePages, setVitrinePages] = useState<
    Record<number, { offers: Product[]; nextCursor: string | null; hasMore: boolean }>
  >({});

  // Modals
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [sendModalProduct, setSendModalProduct] = useState<Product | null>(null);
  const [sendTiming, setSendTiming] = useState<'now' | 'schedule'>('now');
  const [scheduleDateTime, setScheduleDateTime] = useState<string>('2026-11-18T10:00');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([activeSegment]);
  const [isSendingNow, setIsSendingNow] = useState<boolean>(false);
  const [newProductOpen, setNewProductOpen] = useState(false);

  // New Product Form
  const [npTitle, setNpTitle] = useState('');
  const [npUrl, setNpUrl] = useState('');
  const [npExtractedAffUrl, setNpExtractedAffUrl] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);
  const [npPlatform, setNpPlatform] = useState<Marketplace>('Shopee');
  const [npCategory, setNpCategory] = useState('Acessórios de Moda');
  const [npOriginal, setNpOriginal] = useState('99.90');
  const [npDiscount, setNpDiscount] = useState('59.90');
  const [npCommissionPct, setNpCommissionPct] = useState('12');
  const [npCoupon, setNpCoupon] = useState('');
  const [npArtwork, setNpArtwork] = useState<ProductArtworkKey>('sneaker');
  const [npCustomImage, setNpCustomImage] = useState<string>('');

  // Load real platform categories & subcategories whenever Plataforma changes in Vitrine
  useEffect(() => {
    if (mode !== 'vitrine') return;
    let cancelled = false;
    const immediateFallback =
      FALLBACK_PLATFORM_CATEGORIES[platformFilter] ||
      FALLBACK_PLATFORM_CATEGORIES['Todas as Plataformas'];
    setPlatformCategories(immediateFallback);
    setIsLoadingCategories(true);

    fetchPlatformCategoriesApi(platformFilter)
      .then((res) => {
        if (!cancelled && res.ok && Array.isArray(res.categories) && res.categories.length > 0) {
          setPlatformCategories(res.categories);
        }
      })
      .catch(() => {
        // Keep immediate fallback
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCategories(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, platformFilter]);

  const activeSubcategories = useMemo(() => {
    if (categoryFilter === 'Todas as Categorias') return [];
    const found = platformCategories.find((c) => c.name === categoryFilter);
    return found?.subcategories || [];
  }, [platformCategories, categoryFilter]);

  const searchSeqRef = useRef<number>(0);

  const runLiveMarketplaceSearch = useCallback(
    async (options?: {
      customTerm?: string;
      customPlatform?: string;
      customCategory?: string;
      customSubcategory?: string;
      page?: number;
      limit?: number;
      forceRefresh?: boolean;
      notifyOnResult?: boolean;
    }) => {
      const targetPage = Math.max(1, options?.page ?? 1);
      const targetLimit = Math.max(1, options?.limit ?? pageSize);
      const rawSearch = (
        options?.customTerm !== undefined ? options.customTerm : searchQuery || globalSearch
      ).trim();
      const plat =
        options?.customPlatform !== undefined ? options.customPlatform : platformFilter;
      const cat =
        options?.customCategory !== undefined ? options.customCategory : categoryFilter;
      const sub =
        options?.customSubcategory !== undefined ? options.customSubcategory : subcategoryFilter;

      if (targetPage > 1 && !options?.forceRefresh && vitrinePages[targetPage]) {
        searchSeqRef.current += 1;
        setLiveOffers(vitrinePages[targetPage].offers);
        setCurrentPage(targetPage);
        setSelectedIds([]);
        setIsSearchingLive(false);
        return;
      }

      const cursorForPage =
        targetPage > 1 ? vitrinePages[targetPage - 1]?.nextCursor || null : null;

      const reqSeq = ++searchSeqRef.current;
      setIsSearchingLive(true);
      setLiveWarnings([]);
      try {
        const res = await searchPlatformsApi({
          query: rawSearch,
          platform: plat,
          category: cat,
          subcategory: sub,
          credentials: integrations,
          page: targetPage,
          limit: targetLimit,
          cursor: cursorForPage,
        });
        if (reqSeq !== searchSeqRef.current) return;
        if (res.ok && Array.isArray(res.offers)) {
          const mapped: Product[] = res.offers.map((item, idx) => ({
            id: item.id,
            title: item.title,
            ctaHighlight: `🔥 ${item.title}`,
            platform: item.platform,
            category: item.category || 'Vitrine ao Vivo',
            originalPrice: item.originalPrice,
            discountPrice: item.discountPrice,
            discountPercent: item.discountPercent,
            commissionPercent: item.commissionPercent,
            commissionValue: item.commissionValue,
            affiliateUrl: item.affiliateUrl,
            originalUrl: item.originalUrl,
            extraInfo: item.extraInfo,
            artworkKey: 'earbuds',
            customImageUrl: item.imageUrl || undefined,
            isFavorite: products.some(
              (p) =>
                matchesSegment(p.segment, activeSegment) &&
                (p.id === item.id || p.originalUrl === item.originalUrl) &&
                p.isFavorite
            ),
            isPrioritized: false,
            salesRank: (targetPage - 1) * targetLimit + idx + 1,
            segment: normalizeSegmentName(activeSegment),
            createdAt: new Date().toISOString(),
          }));

          const pageEntry = {
            offers: mapped,
            nextCursor: res.nextCursor || null,
            hasMore: Boolean(res.hasMore),
          };
          setVitrinePages((prev) =>
            targetPage === 1 ? { 1: pageEntry } : { ...prev, [targetPage]: pageEntry }
          );
          setLiveOffers(mapped);
          setCurrentPage(targetPage);
          setSelectedIds([]);
          if (res.warnings?.length) setLiveWarnings(res.warnings);
          if (options?.notifyOnResult) {
            const label =
              rawSearch ||
              (sub !== 'Todas as Subcategorias'
                ? sub
                : cat !== 'Todas as Categorias'
                ? cat
                : '');
            notify(
              `${mapped.length} oferta(s) carregadas na página ${targetPage}!`,
              label ? `Filtro aplicado: "${label}".` : 'Ofertas ao vivo sincronizadas.'
            );
          }
        } else if (res.error) {
          notify('Erro ao buscar nas plataformas', res.error, 'error');
        }
      } catch {
        if (reqSeq !== searchSeqRef.current) return;
        notify('Falha de conexão ao buscar ofertas ao vivo', undefined, 'error');
      } finally {
        if (reqSeq === searchSeqRef.current) {
          setIsSearchingLive(false);
        }
      }
    },
    [
      pageSize,
      searchQuery,
      globalSearch,
      categoryFilter,
      subcategoryFilter,
      platformFilter,
      vitrinePages,
      integrations,
      products,
      activeSegment,
      notify,
    ]
  );

  // Auto-fetch page 1 when opening Vitrine or changing filters / pageSize
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
    if (mode === 'vitrine') {
      setVitrinePages({});
      void runLiveMarketplaceSearch({ page: 1, limit: pageSize, forceRefresh: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, platformFilter, categoryFilter, subcategoryFilter, pageSize]);

  const effectiveQuery = (searchQuery || globalSearch).trim().toLowerCase();

  useEffect(() => {
    if (mode !== 'vitrine') {
      setCurrentPage(1);
      setSelectedIds([]);
    }
  }, [mode, activeSegment, priorityFilter, effectiveQuery, sortBy]);

  const segmentProducts = useMemo(
    () => products.filter((p) => matchesSegment(p.segment, activeSegment)),
    [products, activeSegment]
  );

  const sourceList = useMemo(() => {
    if (mode === 'vitrine') {
      return liveOffers.length > 0 ? liveOffers : [];
    }
    return segmentProducts;
  }, [mode, liveOffers, segmentProducts]);

  const catalogBaseList = useMemo(() => {
    if (mode === 'favoritos') {
      return segmentProducts.filter((p) => p.isFavorite);
    }
    return segmentProducts;
  }, [mode, segmentProducts]);

  const platformCounts = useMemo(() => {
    const counts: Record<Marketplace, number> = {
      Shopee: 0,
      'Mercado Livre': 0,
      Amazon: 0,
      Magalu: 0,
      Netshoes: 0,
      AliExpress: 0,
    };
    for (const p of catalogBaseList) {
      if (p.platform in counts) {
        counts[p.platform] += 1;
      }
    }
    return counts;
  }, [catalogBaseList]);

  const totalCatalogCount = catalogBaseList.length;

  const filteredProducts = useMemo(() => {
    let list = [...sourceList];

    if (mode === 'favoritos') {
      list = list.filter((p) => p.isFavorite);
    }

    if (platformFilter !== 'Todas as Plataformas' && mode !== 'vitrine') {
      list = list.filter((p) => p.platform === platformFilter);
    }

    if (mode === 'produtos') {
      if (priorityFilter === 'Priorizados') {
        list = list.filter((p) => p.isPrioritized);
      } else if (priorityFilter === 'Não Priorizados') {
        list = list.filter((p) => !p.isPrioritized);
      }
    }

    if (effectiveQuery && mode !== 'vitrine') {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(effectiveQuery) ||
          p.platform.toLowerCase().includes(effectiveQuery) ||
          p.category.toLowerCase().includes(effectiveQuery)
      );
    }

    if (sortBy === 'Maior Comissão') {
      list.sort((a, b) => b.commissionValue - a.commissionValue);
    } else if (sortBy === 'Menor Comissão') {
      list.sort((a, b) => a.commissionValue - b.commissionValue);
    } else if (sortBy === 'Maior Preço' || sortBy === 'Preço: Maior para Menor') {
      list.sort((a, b) => b.discountPrice - a.discountPrice);
    } else if (sortBy === 'Menor Preço' || sortBy === 'Preço: Menor para Maior') {
      list.sort((a, b) => a.discountPrice - b.discountPrice);
    } else if (sortBy === 'Mais vendidos') {
      list.sort((a, b) => a.salesRank - b.salesRank);
    }

    return list;
  }, [
    sourceList,
    mode,
    platformFilter,
    priorityFilter,
    effectiveQuery,
    sortBy,
  ]);

  const displayedProducts = useMemo(() => {
    if (mode === 'vitrine') {
      return filteredProducts.slice(0, pageSize);
    }
    const start = (currentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [mode, filteredProducts, currentPage, pageSize]);

  const hasPrevPage = currentPage > 1;
  const hasNextPage =
    mode === 'vitrine'
      ? Boolean(vitrinePages[currentPage]?.hasMore || vitrinePages[currentPage + 1])
      : currentPage * pageSize < filteredProducts.length;

  const handlePrevPage = () => {
    if (!hasPrevPage || isSearchingLive) return;
    const prevPage = currentPage - 1;
    if (mode === 'vitrine') {
      void runLiveMarketplaceSearch({ page: prevPage, limit: pageSize });
    } else {
      setCurrentPage(prevPage);
      setSelectedIds([]);
    }
  };

  const handleNextPage = () => {
    if (!hasNextPage || isSearchingLive) return;
    const nextPage = currentPage + 1;
    if (mode === 'vitrine') {
      void runLiveMarketplaceSearch({ page: nextPage, limit: pageSize });
    } else {
      setCurrentPage(nextPage);
      setSelectedIds([]);
    }
  };

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

  const toggleSelectAll = () => {
    const visibleIds = displayedProducts.map((p) => p.id);
    if (visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleIds);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const saveLiveOfferToCatalog = (offer: Product) => {
    const seg = normalizeSegmentName(activeSegment);
    if (
      segmentProducts.some(
        (p) =>
          p.id === offer.id ||
          (p.originalUrl && offer.originalUrl && p.originalUrl === offer.originalUrl)
      )
    ) {
      notify(`Já está nos Produtos de "${seg}"`, offer.title, 'info');
      return;
    }
    const idExistsGlobally = products.some((p) => p.id === offer.id);
    const savedCopy: Product = {
      ...offer,
      id: idExistsGlobally
        ? `${offer.id}-${Date.now().toString(36).slice(-4)}`
        : offer.id,
      segment: seg,
      createdAt: new Date().toISOString(),
    };
    setProducts((prev) => [savedCopy, ...prev]);
    notify(`Oferta salva em "${seg}"!`, offer.title);
  };

  const toggleFavorite = (id: string) => {
    const seg = normalizeSegmentName(activeSegment);
    const inSegmentCatalog = segmentProducts.find((p) => p.id === id);
    if (!inSegmentCatalog) {
      const fromLive = liveOffers.find((o) => o.id === id);
      if (fromLive) {
        const existingByUrl = segmentProducts.find(
          (p) => p.originalUrl && fromLive.originalUrl && p.originalUrl === fromLive.originalUrl
        );
        if (existingByUrl) {
          const nextFav = !existingByUrl.isFavorite;
          setProducts((prev) =>
            prev.map((p) => (p.id === existingByUrl.id ? { ...p, isFavorite: nextFav } : p))
          );
          setLiveOffers((prev) =>
            prev.map((o) => (o.id === id ? { ...o, isFavorite: nextFav } : o))
          );
          notify('Favoritos atualizados');
          return;
        }
        const idExistsGlobally = products.some((p) => p.id === fromLive.id);
        setProducts((prev) => [
          {
            ...fromLive,
            id: idExistsGlobally
              ? `${fromLive.id}-${Date.now().toString(36).slice(-4)}`
              : fromLive.id,
            segment: seg,
            isFavorite: true,
          },
          ...prev,
        ]);
        setLiveOffers((prev) =>
          prev.map((o) => (o.id === id ? { ...o, isFavorite: true } : o))
        );
        notify(`Salvo nos Favoritos de "${seg}"!`, fromLive.title);
        return;
      }
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p))
    );
    setLiveOffers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p))
    );
    notify('Favoritos atualizados');
  };

  const togglePriority = (id: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isPrioritized: !p.isPrioritized } : p))
    );
    notify('Prioridade atualizada');
  };

  const addProductToFirstQueue = (product: Product) => {
    const seg = normalizeSegmentName(activeSegment);
    let targetProdId = product.id;
    if (!segmentProducts.some((p) => p.id === product.id)) {
      const idExistsGlobally = products.some((p) => p.id === product.id);
      targetProdId = idExistsGlobally
        ? `${product.id}-${Date.now().toString(36).slice(-4)}`
        : product.id;
      setProducts((prev) => [{ ...product, id: targetProdId, segment: seg }, ...prev]);
    }
    const segQueues = queues.filter((q) => matchesSegment(q.segment, seg));
    if (segQueues.length === 0) {
      notify(
        'Crie uma fila neste segmento primeiro',
        `Vá em Filas de disparo no segmento "${seg}" para criar uma fila.`,
        'info'
      );
      return;
    }
    const targetQueue = segQueues[0];
    setQueues((prev) =>
      prev.map((q) =>
        q.id === targetQueue.id
          ? {
              ...q,
              productIds: [...q.productIds, targetProdId],
              totalCount: q.totalCount + 1,
            }
          : q
      )
    );
    notify('Adicionado à fila', `Produto incluído na fila "${targetQueue.name}".`);
  };

  const handleDeleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setLiveOffers((prev) => prev.filter((p) => p.id !== id));
    notify('Produto removido', undefined, 'info');
  };

  const handleBulkDispatch = async () => {
    const selected = filteredProducts.filter((p) => selectedIds.includes(p.id));
    let successProducts = 0;
    for (const p of selected) {
      const res = await dispatchOfferNow(p, [activeSegment]);
      if (res.ok) successProducts += 1;
    }
    if (successProducts > 0) {
      setSelectedIds([]);
      notify(
        `${successProducts} produto(s) enviado(s) automaticamente`,
        'Disparados internamente via Baileys/Telegram e salvos em Envios.'
      );
    }
  };

  const ensureShortAffiliateForModal = async (
    product: Product,
    onUpdated: (updated: Product) => void
  ) => {
    if (!needsAffiliateReconversion(product, integrations.mercadoLivre.etiqueta)) return;
    try {
      const conv = await convertLinkApi({
        url: product.originalUrl || product.affiliateUrl,
        credentials: integrations,
      });
      if (
        conv.ok &&
        conv.affiliateUrl &&
        !/mercadolivre\.com\.br\/social\//i.test(conv.affiliateUrl)
      ) {
        const updated: Product = {
          ...product,
          affiliateUrl: conv.affiliateUrl,
          originalUrl: conv.originalProductUrl || product.originalUrl,
        };
        setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
        onUpdated(updated);
      }
    } catch {
      // Keep current product if offline
    }
  };

  const handleOpenPreviewModal = (product: Product) => {
    setPreviewProduct(product);
    void ensureShortAffiliateForModal(product, (updated) => {
      setPreviewProduct((cur) => (cur?.id === updated.id ? updated : cur));
    });
  };

  const handleOpenSendModal = (product: Product) => {
    setSendModalProduct(product);
    setSendTiming('now');
    setSelectedSegments([activeSegment]);
    setIsSendingNow(false);
    void ensureShortAffiliateForModal(product, (updated) => {
      setSendModalProduct((cur) => (cur?.id === updated.id ? updated : cur));
    });
  };

  const handleConfirmSendModal = async () => {
    if (!sendModalProduct || isSendingNow) return;
    const tpl = getTemplateForPlatform(sendModalProduct.platform);
    const rendered = renderProductMessage(sendModalProduct, tpl, integrations);

    if (sendTiming === 'schedule') {
      const targets = selectedSegments.length > 0 ? selectedSegments : [activeSegment];
      const targetGroupIds = dispatchGroups
        .filter((g) => targets.some((seg) => isGroupActiveInSegment(g, seg)))
        .map((g) => g.id);
      setSchedules((prev) => [
        {
          id: `sch-${Date.now()}`,
          title: sendModalProduct.title,
          message: rendered,
          groupIds: targetGroupIds,
          scheduledAt: scheduleDateTime,
          recurrence: 'Único',
          status: 'Pendente',
          platform: sendModalProduct.platform,
          segment: normalizeSegmentName(targets[0] || activeSegment),
        },
        ...prev,
      ]);
      notify('Disparo agendado', 'Confira em Agendamentos.');
      setSendModalProduct(null);
      return;
    }

    setIsSendingNow(true);
    try {
      const res = await dispatchOfferNow(sendModalProduct, selectedSegments);
      if (res.ok) {
        setSendModalProduct(null);
      }
    } finally {
      setIsSendingNow(false);
    }
  };

  const handleExtractFromUrl = async () => {
    if (!npUrl.trim()) {
      notify('Cole o link do produto primeiro', undefined, 'info');
      return;
    }
    setIsExtractingUrl(true);
    try {
      const res = await extractOfferUrlApi({
        url: npUrl.trim(),
        credentials: integrations,
      });
      if (res.ok && res.offer) {
        setNpTitle(res.offer.title);
        setNpPlatform(res.offer.platform);
        setNpOriginal(res.offer.originalPrice.toFixed(2));
        setNpDiscount(res.offer.discountPrice.toFixed(2));
        if (res.offer.imageUrl) setNpCustomImage(res.offer.imageUrl);
        if (res.offer.affiliateUrl) setNpExtractedAffUrl(res.offer.affiliateUrl);
        notify('Dados extraídos da plataforma!', res.offer.title);
      } else {
        notify('Não foi possível extrair tudo automaticamente', res.error, 'error');
      }
    } catch {
      notify('Erro ao consultar URL do produto', undefined, 'error');
    } finally {
      setIsExtractingUrl(false);
    }
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!npTitle.trim()) return;
    const orig = Math.max(0.01, parseFloat(npOriginal.replace(',', '.')) || 99.9);
    const disc = Math.max(0.01, parseFloat(npDiscount.replace(',', '.')) || 59.9);
    const pct = Math.max(0, Math.round(((orig - disc) / orig) * 100));
    const commPct = Math.max(1, parseFloat(npCommissionPct.replace(',', '.')) || 10);
    const commVal = Number(((disc * commPct) / 100).toFixed(2));
    const aff =
      npExtractedAffUrl ||
      buildAffiliateLink(
        npUrl || 'https://shopee.com.br/novo-produto',
        npPlatform,
        integrations
      );

    const created: Product = {
      id: `prod-${Date.now()}`,
      title: npTitle.trim(),
      ctaHighlight: `💥 ${npTitle.trim()} em oferta especial!`,
      platform: npPlatform,
      category: npCategory,
      originalPrice: orig,
      discountPrice: disc,
      discountPercent: pct,
      commissionPercent: commPct,
      commissionValue: commVal,
      affiliateUrl: aff,
      originalUrl: npUrl || aff,
      couponCode: npCoupon.trim() || undefined,
      artworkKey: npArtwork,
      customImageUrl: npCustomImage || undefined,
      isFavorite: mode === 'favoritos',
      isPrioritized: false,
      salesRank: products.length + 1,
      segment: activeSegment,
      createdAt: new Date().toISOString(),
    };

    setProducts((prev) => [created, ...prev]);
    setNewProductOpen(false);
    setNpTitle('');
    setNpUrl('');
    setNpExtractedAffUrl('');
    setNpCoupon('');
    setNpCustomImage('');
    notify('Produto cadastrado!', 'Link de afiliado gerado automaticamente.');
  };

  const handleUploadProductImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNpCustomImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {mode === 'produtos' && (
            <Package className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          )}
          {mode === 'favoritos' && (
            <Star className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          )}
          {mode === 'vitrine' && (
            <Tag className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          )}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {mode === 'produtos'
              ? 'Produtos'
              : mode === 'favoritos'
              ? 'Produtos Favoritos'
              : 'Vitrine de Ofertas'}
          </h1>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {activeSegment}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNewProductOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Produto</span>
          </button>
          <button
            type="button"
            disabled={isSearchingLive}
            onClick={() => {
              if (mode === 'vitrine') {
                setVitrinePages({});
                void runLiveMarketplaceSearch({
                  customTerm: searchQuery,
                  page: 1,
                  limit: pageSize,
                  forceRefresh: true,
                  notifyOnResult: true,
                });
              } else {
                notify('Lista atualizada', `${filteredProducts.length} produto(s) listado(s).`, 'info');
              }
            }}
            title="Atualizar lista de ofertas"
            className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSearchingLive ? 'animate-spin text-[#15803D]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters Stack */}
      <div
        className={`grid grid-cols-1 gap-3 ${
          mode === 'vitrine' ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
        }`}
      >
        <select
          aria-label="Plataforma"
          value={platformFilter}
          onChange={(e) => {
            setPlatformFilter(e.target.value);
            setCategoryFilter('Todas as Categorias');
            setSubcategoryFilter('Todas as Subcategorias');
          }}
          className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
        >
          <option value="Todas as Plataformas">
            {mode === 'vitrine'
              ? 'Todas as Plataformas'
              : `Todas as Plataformas (${totalCatalogCount})`}
          </option>
          {MARKETPLACES.map((m) => (
            <option key={m} value={m}>
              {mode === 'vitrine' ? m : `${m} (${platformCounts[m] || 0})`}
            </option>
          ))}
        </select>

        {mode === 'vitrine' ? (
          <select
            aria-label="Categoria"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setSubcategoryFilter('Todas as Subcategorias');
            }}
            className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          >
            <option value="Todas as Categorias">
              {isLoadingCategories ? 'Carregando categorias...' : 'Todas as Categorias'}
            </option>
            {platformCategories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Ordenar por"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          >
            <option value="Ordenar por">Ordenar por</option>
            <option value="Maior Comissão">Maior Comissão</option>
            <option value="Menor Comissão">Menor Comissão</option>
            <option value="Maior Preço">Maior Preço</option>
            <option value="Menor Preço">Menor Preço</option>
          </select>
        )}

        {mode === 'vitrine' && (
          <select
            aria-label="Subcategoria"
            value={subcategoryFilter}
            disabled={categoryFilter === 'Todas as Categorias' || activeSubcategories.length === 0}
            onChange={(e) => setSubcategoryFilter(e.target.value)}
            className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="Todas as Subcategorias">
              {categoryFilter === 'Todas as Categorias'
                ? 'Todas as Subcategorias'
                : `Todas as Subcategorias (${activeSubcategories.length})`}
            </option>
            {activeSubcategories.map((sub) => (
              <option key={sub.id} value={sub.name}>
                {sub.name}
              </option>
            ))}
          </select>
        )}

        {mode === 'vitrine' ? (
          <select
            aria-label="Ordenação"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          >
            <option value="Relevância">Relevância</option>
            <option value="Mais vendidos">Mais vendidos</option>
            <option value="Preço: Menor para Maior">Preço: Menor para Maior</option>
            <option value="Preço: Maior para Menor">Preço: Maior para Menor</option>
            <option value="Maior Comissão">Maior Comissão</option>
          </select>
        ) : mode === 'produtos' ? (
          <select
            aria-label="Prioridade"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          >
            <option value="Todos os Produtos">Todos os Produtos</option>
            <option value="Priorizados">Priorizados</option>
            <option value="Não Priorizados">Não Priorizados</option>
          </select>
        ) : null}
      </div>

      {/* Search Row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'vitrine') {
            setVitrinePages({});
            void runLiveMarketplaceSearch({
              customTerm: searchQuery,
              page: 1,
              limit: pageSize,
              forceRefresh: true,
              notifyOnResult: true,
            });
          } else {
            setCurrentPage(1);
            notify('Filtro aplicado', `${filteredProducts.length} produto(s) listado(s).`, 'info');
          }
        }}
        className="flex flex-wrap sm:flex-nowrap items-center gap-2.5"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              mode === 'vitrine'
                ? 'Buscar ofertas reais nas plataformas (ex: airfryer, fone jbl, tenis)...'
                : 'Pesquisar por nome...'
            }
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          />
        </div>
        <button
          type="submit"
          disabled={isSearchingLive}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          {isSearchingLive ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span>{mode === 'vitrine' ? 'Buscar nas Plataformas' : 'Pesquisar'}</span>
        </button>
      </form>

      {mode === 'vitrine' && (
        <div className="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#15803D] dark:text-emerald-400 shrink-0" />
            <span>
              {isSearchingLive
                ? `Buscando página ${currentPage} nas plataformas...`
                : displayedProducts.length > 0
                ? `Página ${currentPage} · Exibindo ${displayedProducts.length} oferta(s) ao vivo com seu link de afiliado.`
                : 'Conectado à busca em tempo real de ofertas.'}
            </span>
          </div>
          {liveWarnings.length > 0 && (
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              {liveWarnings[0]}
            </span>
          )}
        </div>
      )}

      {/* Select All, Page Size & Bulk Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {displayedProducts.length > 0 ? (
          <label className="inline-flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={
                displayedProducts.length > 0 &&
                displayedProducts.every((p) => selectedIds.includes(p.id))
              }
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-[#15803D] focus:ring-emerald-600"
            />
            <span>Selecionar página ({displayedProducts.length} produtos)</span>
          </label>
        ) : (
          <div />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap">Exibir:</span>
            <select
              value={customPageSizeMode ? 'custom' : [5, 10, 15, 20, 50].includes(pageSize) ? String(pageSize) : 'custom'}
              onChange={(e) => handlePageSizeSelect(e.target.value)}
              className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium tabular-nums"
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
                  className="w-16 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs tabular-nums"
                />
                <button
                  type="button"
                  onClick={applyCustomPageSize}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold"
                >
                  OK
                </button>
              </div>
            )}
          </div>

          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDispatch}
              className="px-3.5 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Disparar selecionados ({selectedIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {displayedProducts.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-16 px-6 text-center">
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {isSearchingLive
              ? 'Buscando ofertas ao vivo...'
              : mode === 'favoritos'
              ? 'Nenhum produto favorito encontrado.'
              : 'Nenhum produto encontrado para os filtros atuais.'}
          </p>
          {mode === 'favoritos' && (
            <p className="text-xs text-slate-400 mt-1">
              Marque a estrela nos cards da aba Produtos ou Vitrine para salvá-los aqui.
            </p>
          )}
        </div>
      ) : (
        /* Product Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedProducts.map((product) => {
            const isSelected = selectedIds.includes(product.id);
            const isSavedInCatalog = segmentProducts.some(
              (p) =>
                p.id === product.id ||
                (p.originalUrl && product.originalUrl && p.originalUrl === product.originalUrl)
            );
            const isFavoritedInSegment =
              mode === 'vitrine'
                ? segmentProducts.some(
                    (p) =>
                      p.isFavorite &&
                      (p.id === product.id ||
                        (p.originalUrl &&
                          product.originalUrl &&
                          p.originalUrl === product.originalUrl))
                  )
                : product.isFavorite;
            return (
              <div
                key={product.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden flex flex-col justify-between transition-colors hover:border-emerald-500/40"
              >
                <div>
                  {/* Image Header */}
                  <div className="relative bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                    <ProductArtwork
                      artworkKey={product.artworkKey}
                      customImageUrl={product.customImageUrl}
                      alt={product.title}
                      className="w-full h-64 p-3"
                    />

                    {/* Top Left Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOne(product.id)}
                      aria-label={`Selecionar ${product.title}`}
                      className="absolute top-3 left-3 w-5 h-5 rounded-full border-slate-300 text-[#15803D] focus:ring-emerald-600 cursor-pointer bg-white/95"
                    />

                    {/* Top Right Discount Tag */}
                    {product.discountPercent > 0 && (
                      <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-md bg-[#EF4444] text-white text-xs font-bold tabular-nums shadow-xs">
                        -{product.discountPercent}% OFF
                      </span>
                    )}

                    {/* Bottom Left Marketplace Label */}
                    <span
                      className={`absolute bottom-3 left-3 px-2.5 py-0.5 rounded-md text-xs font-semibold shadow-xs ${getPlatformAccent(
                        product.platform
                      )}`}
                    >
                      {product.platform}
                    </span>

                    {/* Bottom Right Favorite Star */}
                    <button
                      type="button"
                      onClick={() => toggleFavorite(product.id)}
                      title={isFavoritedInSegment ? 'Remover dos favoritos' : 'Favoritar'}
                      className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center shadow-xs hover:scale-105 transition-transform"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          isFavoritedInSegment
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-400'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white line-clamp-2 leading-snug">
                      {product.title}
                    </h3>

                    <div className="mt-3 flex items-baseline gap-2 tabular-nums">
                      {product.originalPrice > product.discountPrice && (
                        <span className="text-xs text-slate-400 line-through">
                          R$ {formatBRL(product.originalPrice)}
                        </span>
                      )}
                      <span className="text-xl font-bold text-[#15803D] dark:text-emerald-400">
                        R$ {formatBRL(product.discountPrice)}
                      </span>
                    </div>

                    <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      $ Comissão: {product.commissionPercent}% (R${' '}
                      {formatBRL(product.commissionValue)})
                      {product.isPrioritized ? ' · Priorizado' : ''}
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="px-4 pb-4 pt-1 flex items-center gap-2 relative">
                  {mode === 'vitrine' ? (
                    <button
                      type="button"
                      onClick={() => saveLiveOfferToCatalog(product)}
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                        isSavedInCatalog
                          ? 'border-emerald-300 bg-emerald-50/70 text-[#15803D] dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isSavedInCatalog ? (
                        <BookmarkCheck className="w-4 h-4" />
                      ) : (
                        <Bookmark className="w-4 h-4" />
                      )}
                      <span>{isSavedInCatalog ? 'Salvo' : 'Salvar'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenPreviewModal(product)}
                      className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Visualizar</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenSendModal(product)}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Send className="w-4 h-4" />
                    <span>Enviar</span>
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenuId((prev) => (prev === product.id ? null : product.id))
                      }
                      aria-label="Mais opções"
                      className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {openMenuId === product.id && (
                      <div className="absolute right-0 bottom-10 w-52 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-20 text-xs">
                        {mode === 'vitrine' && (
                          <button
                            type="button"
                            onClick={() => {
                              saveLiveOfferToCatalog(product);
                              setOpenMenuId(null);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 text-[#15803D] dark:text-emerald-400 font-semibold flex items-center gap-2"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Salvar em Produtos</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            togglePriority(product.id);
                            setOpenMenuId(null);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200"
                        >
                          {product.isPrioritized
                            ? 'Remover prioridade'
                            : 'Marcar como priorizado'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            addProductToFirstQueue(product);
                            setOpenMenuId(null);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 flex items-center gap-2"
                        >
                          <ListOrdered className="w-3.5 h-3.5" />
                          <span>Adicionar à Fila</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(product.affiliateUrl);
                            notify('Link copiado!', product.affiliateUrl);
                            setOpenMenuId(null);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 flex items-center gap-2"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar link afiliado</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteProduct(product.id);
                            setOpenMenuId(null);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Excluir produto</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unlimited Pagination Bar */}
      {(displayedProducts.length > 0 || currentPage > 1) && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 tabular-nums">
          <span>
            {mode === 'vitrine'
              ? `${displayedProducts.length} oferta(s) nesta página`
              : `${displayedProducts.length} de ${filteredProducts.length} produto(s)`}
          </span>
          <span className="font-semibold text-slate-900 dark:text-white">
            Página {currentPage}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasPrevPage || isSearchingLive}
              onClick={handlePrevPage}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
            <button
              type="button"
              disabled={!hasNextPage || isSearchingLive}
              onClick={handleNextPage}
              className="px-3 py-1.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <span>{isSearchingLive ? 'Carregando...' : 'Próximo'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Product Counter by Platform (Produtos & Favoritos) */}
      {mode !== 'vitrine' && (
        <div
          data-testid="platform-product-counter"
          className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-4 sm:px-5 py-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#15803D] dark:text-emerald-400 shrink-0" />
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                {platformFilter === 'Todas as Plataformas'
                  ? `Total em todas as plataformas: ${totalCatalogCount} ${
                      totalCatalogCount === 1 ? 'produto' : 'produtos'
                    }`
                  : `${platformFilter}: ${platformCounts[platformFilter as Marketplace] || 0} ${
                      (platformCounts[platformFilter as Marketplace] || 0) === 1
                        ? 'produto'
                        : 'produtos'
                    }`}
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {platformFilter === 'Todas as Plataformas'
                ? 'Clique em uma plataforma abaixo para filtrar'
                : `Total geral em todas as plataformas: ${totalCatalogCount}`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 tabular-nums">
            <button
              type="button"
              onClick={() => setPlatformFilter('Todas as Plataformas')}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                platformFilter === 'Todas as Plataformas'
                  ? 'border-[#15803D] bg-emerald-50/90 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="truncate">Todas</span>
              <span className="font-bold">{totalCatalogCount}</span>
            </button>
            {MARKETPLACES.map((m) => {
              const count = platformCounts[m] || 0;
              const isActive = platformFilter === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPlatformFilter(m)}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                    isActive
                      ? 'border-[#15803D] bg-emerald-50/90 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span className="truncate">{m}</span>
                  <span
                    className={`font-bold ${
                      count === 0 ? 'text-slate-400 dark:text-slate-500' : ''
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Visualizar no WhatsApp (matching page 16) */}
      {previewProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Preview no WhatsApp
              </h3>
              <button
                type="button"
                onClick={() => setPreviewProduct(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const tpl = getTemplateForPlatform(previewProduct.platform);
              const rendered = renderProductMessage(previewProduct, tpl, integrations);
              return (
                <>
                  <WhatsAppMockup
                    message={rendered}
                    artworkKey={previewProduct.artworkKey}
                    customImageUrl={previewProduct.customImageUrl}
                    showMedia
                    enableLinkPreview={tpl.enableLinkPreview}
                    includeLinkPreviewDetails={Boolean(tpl.includeLinkPreviewDetails)}
                    previewDomain={getPreviewDomain(previewProduct.platform)}
                    time="22:54"
                  />
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(rendered);
                        notify('Copy copiada!', 'Pronta para colar no grupo.');
                      }}
                      className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Copy className="w-4 h-4" />
                      <span>Copiar Mensagem</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const prod = previewProduct;
                        setPreviewProduct(null);
                        handleOpenSendModal(prod);
                      }}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-4 h-4" />
                      <span>Enviar Produto</span>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal: Enviar Produto (matching pages 17-18) */}
      {sendModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl my-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                    Enviar produto
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Escolha quando enviar e para quais segmentos.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSendModalProduct(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Product Summary */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0">
                <ProductArtwork
                  artworkKey={sendModalProduct.artworkKey}
                  customImageUrl={sendModalProduct.customImageUrl}
                  alt={sendModalProduct.title}
                  className="w-14 h-14"
                />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {sendModalProduct.title}
                </div>
                <div className="text-xs mt-0.5 tabular-nums">
                  <span className="text-slate-400 line-through mr-1.5">
                    R$ {formatBRL(sendModalProduct.originalPrice)}
                  </span>
                  <span className="font-bold text-[#15803D] dark:text-emerald-400">
                    R$ {formatBRL(sendModalProduct.discountPrice)}
                  </span>
                </div>
                <div className="text-xs text-[#15803D] dark:text-emerald-400 font-medium tabular-nums">
                  Comissão {sendModalProduct.commissionPercent}% (R${' '}
                  {formatBRL(sendModalProduct.commissionValue)})
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Quando deseja enviar?
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                O disparo automático será feito via Baileys para os grupos ativos do segmento escolhido.
              </p>
            </div>

            <div className="mt-3 space-y-2.5">
              <button
                type="button"
                disabled={isSendingNow}
                onClick={() => setSendTiming('now')}
                className={`w-full text-left rounded-xl p-3.5 border transition-colors ${
                  sendTiming === 'now'
                    ? 'border-[#15803D] bg-emerald-50/50 dark:bg-emerald-950/30'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="w-8 h-8 rounded-full bg-[#15803D] text-white flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </span>
                  {sendTiming === 'now' && (
                    <span className="text-[#15803D] dark:text-emerald-400 font-bold">✓</span>
                  )}
                </div>
                <div className="mt-2 font-semibold text-sm text-slate-900 dark:text-white">
                  Enviar agora
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Envia automaticamente pelos canais conectados sem precisar abrir o WhatsApp.
                </div>
              </button>

              <button
                type="button"
                disabled={isSendingNow}
                onClick={() => setSendTiming('schedule')}
                className={`w-full text-left rounded-xl p-3.5 border transition-colors ${
                  sendTiming === 'schedule'
                    ? 'border-[#15803D] bg-emerald-50/50 dark:bg-emerald-950/30'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </span>
                  {sendTiming === 'schedule' && (
                    <span className="text-[#15803D] dark:text-emerald-400 font-bold">✓</span>
                  )}
                </div>
                <div className="mt-2 font-semibold text-sm text-slate-900 dark:text-white">
                  Agendar disparo
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Defina uma data e horário para enviar depois.
                </div>
              </button>
            </div>

            {sendTiming === 'schedule' && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Data e horário do disparo
                </label>
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            )}

            {/* Segments Selection */}
            <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/70 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Selecione os segmentos
                </span>
                <button
                  type="button"
                  disabled={isSendingNow}
                  onClick={() => setSelectedSegments([])}
                  className="text-[#15803D] dark:text-emerald-400 hover:underline"
                >
                  Limpar seleção
                </button>
              </div>
              <div className="space-y-1.5">
                {segments.map((seg) => {
                  const checked = selectedSegments.includes(seg);
                  return (
                    <label
                      key={seg}
                      className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        disabled={isSendingNow}
                        checked={checked}
                        onChange={() =>
                          setSelectedSegments((prev) =>
                            prev.includes(seg)
                              ? prev.filter((s) => s !== seg)
                              : [...prev, seg]
                          )
                        }
                        className="w-4 h-4 rounded text-[#15803D] focus:ring-emerald-600"
                      />
                      <span>{seg}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 tabular-nums">
                {selectedSegments.length} segmento(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSendingNow}
                  onClick={() => setSendModalProduct(null)}
                  className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={selectedSegments.length === 0 || isSendingNow}
                  onClick={handleConfirmSendModal}
                  className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-1.5"
                >
                  {isSendingNow && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {isSendingNow
                      ? 'Enviando...'
                      : sendTiming === 'now'
                      ? 'Enviar agora'
                      : 'Salvar agendamento'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cadastrar Novo Produto */}
      {newProductOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleCreateProduct}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl my-auto space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                Cadastrar Produto / Oferta
              </h3>
              <button
                type="button"
                onClick={() => setNewProductOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Link do Produto (cole e clique em Extrair para puxar foto, título e preço)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={npUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNpUrl(val);
                      setNpExtractedAffUrl('');
                      if (val) setNpPlatform(detectMarketplaceFromUrl(val));
                    }}
                    placeholder="https://produto.mercadolivre.com.br/... ou https://shopee.com.br/..."
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={isExtractingUrl || !npUrl.trim()}
                    onClick={() => void handleExtractFromUrl()}
                    className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {isExtractingUrl ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Extrair Dados</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Nome do Produto *
                </label>
                <input
                  type="text"
                  required
                  value={npTitle}
                  onChange={(e) => setNpTitle(e.target.value)}
                  placeholder="Ex: Fone Bluetooth JBL Tune 520BT"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Plataforma
                  </label>
                  <select
                    value={npPlatform}
                    onChange={(e) => setNpPlatform(e.target.value as Marketplace)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    {MARKETPLACES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Categoria
                  </label>
                  <select
                    value={npCategory}
                    onChange={(e) => setNpCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    {VITRINE_CATEGORIES.filter((c) => c !== 'Todas as Categorias').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Preço De (R$)
                  </label>
                  <input
                    type="text"
                    value={npOriginal}
                    onChange={(e) => setNpOriginal(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Preço Por (R$)
                  </label>
                  <input
                    type="text"
                    value={npDiscount}
                    onChange={(e) => setNpDiscount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Comissão (%)
                  </label>
                  <input
                    type="text"
                    value={npCommissionPct}
                    onChange={(e) => setNpCommissionPct(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Cupom (opcional)
                  </label>
                  <input
                    type="text"
                    value={npCoupon}
                    onChange={(e) => setNpCoupon(e.target.value.toUpperCase())}
                    placeholder="Ex: OFERTA20"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Ilustração Padrão
                  </label>
                  <select
                    value={npArtwork}
                    onChange={(e) => setNpArtwork(e.target.value as ProductArtworkKey)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    <option value="sneaker">Tênis / Calçado</option>
                    <option value="shorts">Moda / Fitness</option>
                    <option value="flipflops">Chinelo / Verão</option>
                    <option value="earbuds">Áudio / Fone</option>
                    <option value="speaker">Smart Speaker / Tech</option>
                    <option value="airfryer">Eletrodoméstico</option>
                    <option value="mug">Casa / Presentes</option>
                    <option value="cap">Acessórios / Boné</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Ou envie foto do produto (PNG/JPG)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadProductImage}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-semibold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewProductOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                Salvar Produto
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * CUPONS VIEW (Telas 26–29)
 * ========================================================================== */
export const CouponsView: React.FC = () => {
  const {
    coupons,
    setCoupons,
    setProducts,
    autoDispatch,
    setAutoDispatch,
    dispatchGroups,
    dispatchCustomMessage,
    activeSegment,
    notify,
  } = useApp();
  const [tab, setTab] = useState<'meus' | 'vitrine'>('meus');
  const [codeSearch, setCodeSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('Todas plataformas');
  const [statusFilter, setStatusFilter] = useState('Ativos');
  const [typeFilter, setTypeFilter] = useState('Todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [cleaningMlCoupons, setCleaningMlCoupons] = useState(false);

  // Form
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDiscountText, setNewDiscountText] = useState('R$ 20 OFF');
  const [newPlatform, setNewPlatform] = useState<Marketplace>('Shopee');
  const [newMinSpend, setNewMinSpend] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('2026-12-31');
  const [newSiteWide, setNewSiteWide] = useState(false);

  const mlCouponMaxAgeHours =
    typeof autoDispatch.mlCouponMaxAgeHours === 'number'
      ? autoDispatch.mlCouponMaxAgeHours
      : DEFAULT_ML_COUPON_MAX_AGE_HOURS;
  const prioritizeCouponProducts = autoDispatch.prioritizeCouponProducts !== false;

  const handleCleanupExpiredMl = async () => {
    setCleaningMlCoupons(true);
    try {
      const res = await cleanupExpiredMlCouponsApi({
        maxAgeHours: mlCouponMaxAgeHours,
        segment: activeSegment,
      });
      if (!res.ok) {
        notify('Não foi possível limpar os cupons', res.error || 'Tente novamente.', 'error');
        return;
      }
      if (Array.isArray(res.products)) {
        setProducts(res.products);
      }
      if (Array.isArray(res.coupons)) {
        setCoupons(res.coupons);
      }
      const removed = res.removedCount ?? 0;
      const replaced = res.replacedCount ?? 0;
      const kept = res.keptCount ?? 0;
      notify(
        'Limpeza de cupons vencidos concluída',
        `${removed} expirado(s) removido(s), ${replaced} de site inteiro aplicado(s), ${kept} recente(s) mantido(s).`
      );
    } finally {
      setCleaningMlCoupons(false);
    }
  };

  const toggleCouponSiteWide = (coupon: Coupon) => {
    const nextVal = !coupon.isSiteWide;
    setCoupons((prev) =>
      prev.map((item) =>
        item.id === coupon.id
          ? { ...item, isSiteWide: nextVal, isAutomatic: nextVal }
          : item
      )
    );
    notify(
      nextVal
        ? `${coupon.code} marcado como Site Inteiro`
        : `${coupon.code} voltou para disparo manual`,
      nextVal
        ? 'Será aplicado automaticamente nas ofertas do Mercado Livre sem cupom (respeitando valor mínimo e validade).'
        : 'Não será mais colado automaticamente em produtos; continua disponível para disparo manual.'
    );
  };

  const visibleCoupons = coupons.filter((c) => {
    if (tab === 'meus') {
      if (c.isShowcase) return false;
      if (!matchesSegment(c.segment, activeSegment)) return false;
    }
    if (tab === 'vitrine' && !c.isShowcase) return false;
    if (codeSearch.trim() && !c.code.toLowerCase().includes(codeSearch.trim().toLowerCase())) {
      return false;
    }
    if (platformFilter !== 'Todas plataformas' && c.platform !== platformFilter) {
      return false;
    }
    if (statusFilter === 'Ativos' && !c.active) return false;
    if (statusFilter === 'Inativos (expirados)' && c.active) return false;
    if (typeFilter === 'Site inteiro' && !c.isSiteWide) return false;
    return true;
  });

  const handleAddCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) return;
    const parsedMinSpend = Number(newMinSpend.replace(',', '.'));
    const item: Coupon = {
      id: `cup-${Date.now()}`,
      code: newCode.trim().toUpperCase(),
      description: newDesc.trim() || 'Cupom exclusivo para membros do grupo',
      discountText: newDiscountText.trim() || 'Desconto Especial',
      platform: newPlatform,
      active: true,
      isAutomatic: newSiteWide,
      isSiteWide: newSiteWide,
      isShowcase: false,
      minSpend: Number.isFinite(parsedMinSpend) && parsedMinSpend > 0 ? parsedMinSpend : undefined,
      expiresAt: newExpiresAt.trim() || '2026-12-31',
      segment: normalizeSegmentName(activeSegment),
    };
    setCoupons((prev) => [item, ...prev]);
    setTab('meus');
    setModalOpen(false);
    setNewCode('');
    setNewDesc('');
    setNewMinSpend('');
    setNewSiteWide(false);
    notify('Cupom cadastrado!', `Código ${item.code} adicionado em "${activeSegment}".`);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <Ticket className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Cupons
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Cadastre seus cupons reais e gerencie a proteção contra cupons expirados nas ofertas.
        </p>
      </div>

      {/* Proteção de Cupons do Mercado Livre (Soluções 1 + 2 + Prioridade) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Proteção de Cupons do Mercado Livre
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Mantém apenas o cupom original capturado junto com a oferta dentro do prazo limite
              (removendo datas vencidas, palavras falsas e cupons de outros dias). Cupons de{' '}
              <strong>Meus Cupons</strong> nunca são colados em produtos aleatórios, a menos que
              você marque explicitamente <strong>Vale no site inteiro</strong>.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* TTL selector */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-1.5">
            <label
              htmlFor="ml-coupon-ttl-select"
              className="block text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              Validade do cupom capturado na oferta
            </label>
            <select
              id="ml-coupon-ttl-select"
              value={String(mlCouponMaxAgeHours)}
              onChange={(e) => {
                const hours = Number(e.target.value);
                setAutoDispatch((prev) => ({ ...prev, mlCouponMaxAgeHours: hours }));
                notify(
                  'Prazo de validade atualizado',
                  hours > 0
                    ? `Cupons capturados no ML expiram automaticamente após ${hours} hora(s).`
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
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Passou desse prazo, o cupom é removido e a oferta sai limpa sem cupom.
            </p>
          </div>

          {/* Prioritize fresh coupon products toggle */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Priorizar ofertas com cupom ativo no envio
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Produtos recém-capturados com cupom válido passam na frente da fila automática para
                serem enviados antes de expirarem.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prioritizeCouponProducts}
              aria-label="Priorizar ofertas com cupom ativo no envio"
              onClick={() => {
                const next = !prioritizeCouponProducts;
                setAutoDispatch((prev) => ({ ...prev, prioritizeCouponProducts: next }));
                notify(
                  next
                    ? 'Prioridade para ofertas com cupom ativada'
                    : 'Prioridade para ofertas com cupom desativada'
                );
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                prioritizeCouponProducts ? 'bg-[#15803D]' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  prioritizeCouponProducts ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
          <button
            type="button"
            disabled={cleaningMlCoupons}
            onClick={() => void handleCleanupExpiredMl()}
            className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors"
          >
            {cleaningMlCoupons ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>Limpar cupons vencidos agora</span>
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span>Novo Cupom</span>
      </button>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setTab('meus')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'meus'
              ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Meus Cupons
        </button>
        <button
          type="button"
          onClick={() => setTab('vitrine')}
          className={`pb-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'vitrine'
              ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Vitrine de Cupons
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={codeSearch}
            onChange={(e) => setCodeSearch(e.target.value)}
            placeholder="Filtrar por código..."
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>

        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todas plataformas">Todas plataformas</option>
          {MARKETPLACES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Ativos">Ativos</option>
          <option value="Inativos (expirados)">Inativos (expirados)</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todos">Todos</option>
          <option value="Site inteiro">Site inteiro (auto)</option>
        </select>
      </div>

      {/* List or Empty */}
      {visibleCoupons.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-14 px-6 flex flex-col items-center text-center">
          <Ticket className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Nenhum cupom cadastrado.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleCoupons.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {c.platform} · {c.discountText}{' '}
                    {c.minSpend ? `· Mín. R$ ${c.minSpend}` : ''}
                    {c.expiresAt ? ` · Até ${c.expiresAt}` : ''}
                    {c.isSiteWide ? ' · Site inteiro (auto)' : ''}
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white">
                    {c.code}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    {c.description}
                  </p>
                </div>
                {!c.isShowcase && (
                  <button
                    type="button"
                    onClick={() =>
                      setCoupons((prev) => prev.filter((item) => item.id !== c.id))
                    }
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {!c.isShowcase && c.platform === 'Mercado Livre' && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2">
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    {c.isSiteWide
                      ? 'Vale no site inteiro (aplica em ofertas ML sem cupom)'
                      : 'Somente disparo manual (não cola em produtos)'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(c.isSiteWide)}
                    onClick={() => toggleCouponSiteWide(c)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      c.isSiteWide ? 'bg-[#15803D]' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        c.isSiteWide ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(c.code);
                    notify('Código copiado!', c.code);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar Código</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const activeGroups = dispatchGroups.filter((g) =>
                      isGroupActiveInSegment(g, activeSegment)
                    );
                    if (activeGroups.length === 0) {
                      notify(
                        `Nenhum grupo ativo em "${activeSegment}"`,
                        'Ative pelo menos um grupo em Grupos de Envio neste segmento para disparar.',
                        'info'
                      );
                      return;
                    }
                    const msg = `🎟️ *CUPOM LIBERADO NA ${c.platform.toUpperCase()}!*\n\n✨ ${c.description}\n📋 Código: *${c.code}*${
                      c.link ? `\n🔗 Ative aqui: ${c.link}` : ''
                    }`;
                    await dispatchCustomMessage({
                      title: `Cupom ${c.code} (${c.platform})`,
                      message: msg,
                      groupsNames: activeGroups.map((g) => g.name),
                      groupIds: activeGroups.map((g) => g.id),
                      platform: c.platform,
                      segment: activeSegment,
                    });
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Disparar Cupom</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Novo Cupom */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleAddCoupon}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                Novo Cupom de Desconto
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Código do Cupom *
                </label>
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="Ex: DIVULGA20"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Plataforma
                  </label>
                  <select
                    value={newPlatform}
                    onChange={(e) => setNewPlatform(e.target.value as Marketplace)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    {MARKETPLACES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Benefício
                  </label>
                  <input
                    type="text"
                    value={newDiscountText}
                    onChange={(e) => setNewDiscountText(e.target.value)}
                    placeholder="Ex: 15% OFF"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Valor mínimo (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newMinSpend}
                    onChange={(e) => setNewMinSpend(e.target.value)}
                    placeholder="Opcional (ex: 79)"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Validade
                  </label>
                  <input
                    type="date"
                    value={newExpiresAt}
                    onChange={(e) => setNewExpiresAt(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Regras / Descrição
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Ex: Válido para compras acima de R$ 79 no app"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3">
                <input
                  type="checkbox"
                  checked={newSiteWide}
                  onChange={(e) => setNewSiteWide(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-[#15803D]"
                />
                <span>
                  <strong>Vale no site inteiro</strong> — aplicar automaticamente nas ofertas sem
                  cupom (marque apenas se você confirmou que o cupom não é restrito a produtos
                  selecionados).
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                Salvar Cupom
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
