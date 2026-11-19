import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  MessageCircle,
  Send,
  Package,
  Star,
  Tag,
  Ticket,
  Users,
  Calendar,
  ListOrdered,
  Download,
  Link2,
  DollarSign,
  FileText,
  BarChart3,
  Settings,
  Gift,
  Menu,
  Search,
  Moon,
  Sun,
  HelpCircle,
  ChevronDown,
  Store,
  X,
  CheckCircle2,
  Info,
  AlertCircle,
  Layers,
  User,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { NavRoute } from '../types';

interface NavItemDef {
  id: NavRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: 'top' | 'essencial' | 'relatorios' | 'configuracoes';
}

const NAV_ITEMS: NavItemDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, section: 'top' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, section: 'essencial' },
  { id: 'telegram', label: 'Telegram', icon: MessageCircle, section: 'essencial' },
  { id: 'enviar-mensagens', label: 'Enviar Mensagens', icon: Send, section: 'essencial' },
  { id: 'produtos', label: 'Produtos', icon: Package, section: 'essencial' },
  { id: 'produtos-favoritos', label: 'Produtos Favoritos', icon: Star, section: 'essencial' },
  { id: 'vitrine-ofertas', label: 'Vitrine de Ofertas', icon: Tag, section: 'essencial' },
  { id: 'cupons', label: 'Cupons', icon: Ticket, section: 'essencial' },
  { id: 'grupos-envio', label: 'Grupos de Envio', icon: Users, section: 'essencial' },
  { id: 'grupos-monitoramento', label: 'Grupos de Monitoramento', icon: Users, section: 'essencial' },
  { id: 'agendamentos', label: 'Agendamentos', icon: Calendar, section: 'essencial' },
  { id: 'filas-disparo', label: 'Filas de disparo', icon: ListOrdered, section: 'essencial' },
  { id: 'download-videos', label: 'Download de Vídeos', icon: Download, section: 'essencial' },
  { id: 'conversao-link', label: 'Conversão de Link', icon: Link2, section: 'essencial' },
  { id: 'comissao', label: 'Comissão', icon: DollarSign, section: 'relatorios' },
  { id: 'envios', label: 'Envios', icon: FileText, section: 'relatorios' },
  { id: 'monitor-membros', label: 'Monitor de Membros', icon: BarChart3, section: 'relatorios' },
  { id: 'configuracoes', label: 'Configurações', icon: Settings, section: 'configuracoes' },
  { id: 'indicacoes', label: 'Indicações', icon: Users, section: 'configuracoes' },
];

export const OwlLogo: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
    <path
      d="M7 7 C7 7, 14 11, 20 11 C26 11, 33 7, 33 7 L33 23 C33 31, 27 36, 20 36 C13 36, 7 31, 7 23 Z"
      fill="#15803D"
    />
    <circle cx="14.5" cy="21" r="4.8" fill="#FFFFFF" />
    <circle cx="25.5" cy="21" r="4.8" fill="#FFFFFF" />
    <circle cx="14.8" cy="21" r="2.2" fill="#0F172A" />
    <circle cx="25.2" cy="21" r="2.2" fill="#0F172A" />
    <path d="M18 25 L22 25 L20 29 Z" fill="#DCFCE7" />
  </svg>
);

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    route,
    setRoute,
    darkMode,
    toggleDarkMode,
    segments,
    activeSegment,
    setActiveSegment,
    globalSearch,
    setGlobalSearch,
    profile,
    toasts,
    dismissToast,
    exportBackupJson,
    notify,
  } = useApp();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [segmentMenuOpen, setSegmentMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigate = (nextRoute: NavRoute) => {
    setRoute(nextRoute);
    setMobileMenuOpen(false);
    setProfileMenuOpen(false);
    setSearchDropdownOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isRouteActive = (itemRoute: NavRoute) => {
    if (itemRoute === 'configuracoes' && route.startsWith('config-')) return true;
    return route === itemRoute;
  };

  const initials = profile.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'PS';

  const filteredNavMatches = globalSearch.trim()
    ? NAV_ITEMS.filter((i) =>
        i.label.toLowerCase().includes(globalSearch.trim().toLowerCase())
      )
    : [];

  const handleDownloadBackup = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `buboflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setProfileMenuOpen(false);
    notify('Backup exportado', 'Arquivo JSON salvo no seu dispositivo.');
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
      {/* Segment Selector */}
      <div className="p-3 border-b border-slate-100 dark:border-slate-800 relative">
        <button
          type="button"
          onClick={() => setSegmentMenuOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4" />
            </span>
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
              {activeSegment}
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              segmentMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {segmentMenuOpen && (
          <div className="mt-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1.5 z-20">
            {segments.map((seg) => (
              <button
                key={seg}
                type="button"
                onClick={() => {
                  setActiveSegment(seg);
                  setSegmentMenuOpen(false);
                }}
                className={`w-full px-3.5 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  activeSegment === seg
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <span className="truncate">{seg}</span>
                {activeSegment === seg && <span className="text-xs">✓</span>}
              </button>
            ))}
            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
            <button
              type="button"
              onClick={() => {
                setSegmentMenuOpen(false);
                navigate('segmentos');
              }}
              className="w-full px-3.5 py-2 text-left text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/40 flex items-center gap-2"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Gerenciar Segmentos</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {/* Top Dashboard */}
        <div className="space-y-1">
          {NAV_ITEMS.filter((i) => i.section === 'top').map((item) => {
            const Icon = item.icon;
            const active = isRouteActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#E6F4EC] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 font-medium'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Essencial */}
        <div>
          <div className="px-3.5 mb-2 text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-500">
            Essencial
          </div>
          <div className="space-y-0.5">
            {NAV_ITEMS.filter((i) => i.section === 'essencial').map((item) => {
              const Icon = item.icon;
              const active = isRouteActive(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#E6F4EC] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Relatórios */}
        <div>
          <div className="px-3.5 mb-2 text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-500">
            Relatórios
          </div>
          <div className="space-y-0.5">
            {NAV_ITEMS.filter((i) => i.section === 'relatorios').map((item) => {
              const Icon = item.icon;
              const active = isRouteActive(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#E6F4EC] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Configurações */}
        <div>
          <div className="px-3.5 mb-2 text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-500">
            Configurações
          </div>
          <div className="space-y-0.5">
            {NAV_ITEMS.filter((i) => i.section === 'configuracoes').map((item) => {
              const Icon = item.icon;
              const active = isRouteActive(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#E6F4EC] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col overflow-x-clip bg-[#F4F7F5] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-30 h-15 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-3 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Hamburger + Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Abrir menu lateral"
            className="lg:hidden p-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 focus:outline-none"
          >
            <OwlLogo className="w-8 h-8 shrink-0" />
            <span className="hidden sm:inline text-base font-bold tracking-tight text-slate-900 dark:text-white">
              BuboFlow
            </span>
          </button>
        </div>

        {/* Center: Quick Search */}
        <div ref={searchRef} className="relative flex-1 max-w-md">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={globalSearch}
              onFocus={() => setSearchDropdownOpen(true)}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setSearchDropdownOpen(true);
              }}
              placeholder="Pesquisar..."
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-xl bg-slate-100/90 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => setGlobalSearch('')}
                className="absolute right-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchDropdownOpen && filteredNavMatches.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg py-1.5 z-40">
              <div className="px-3 py-1 text-[11px] text-slate-400">Ir para módulo</div>
              {filteredNavMatches.slice(0, 6).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setGlobalSearch('');
                      navigate(m.id);
                    }}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60"
                  >
                    <Icon className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Actions + Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('indicacoes')}
            title="Programa de Indicações"
            className="w-9 h-9 rounded-full bg-[#15803D] hover:bg-emerald-800 text-white flex items-center justify-center transition-colors shadow-xs shrink-0"
          >
            <Gift className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleDarkMode}
            title={darkMode ? 'Modo Claro' : 'Modo Escuro'}
            className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Ajuda Rápida"
            className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors shrink-0"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Profile Avatar Dropdown */}
          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              className="w-9 h-9 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 text-xs font-bold flex items-center justify-center hover:ring-2 hover:ring-emerald-600/30 transition-all shrink-0"
            >
              {initials}
            </button>

            {profileMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-50">
                <button
                  type="button"
                  onClick={() => navigate('perfil')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5"
                >
                  <User className="w-4 h-4 text-slate-400" />
                  <span>Perfil</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('configuracoes')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span>Configurações</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('segmentos')}
                  className="w-full px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center gap-2.5"
                >
                  <Layers className="w-4 h-4 text-slate-400" />
                  <span>Segmentos</span>
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="w-full px-4 py-2 text-left text-sm text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/40 flex items-center gap-2.5"
                >
                  <Download className="w-4 h-4" />
                  <span>Exportar Backup (.json)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-66 shrink-0 sticky top-15 h-[calc(100vh-3.75rem)]">
          {renderSidebarContent()}
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] h-full z-50 flex flex-col">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fechar menu"
                className="absolute top-3.5 right-3 z-10 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
              {renderSidebarContent()}
            </div>
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 px-3.5 py-5 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full overflow-x-clip">
          {children}
        </main>
      </div>

      {/* Quick Help Modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Guia Rápido do Painel
              </h2>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <p>
                <strong>1. Configure suas Tags:</strong> Em{' '}
                <em>Configurações &rarr; Plataformas</em>, salve sua etiqueta do Mercado Livre,
                ID Amazon, Shopee e Magalu.
              </p>
              <p>
                <strong>2. Personalize os Templates:</strong> Em{' '}
                <em>Configurações &rarr; Templates</em>, ajuste os blocos condicionais{' '}
                <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                  SE/SENÃO
                </code>{' '}
                e veja o preview ao vivo no celular.
              </p>
              <p>
                <strong>3. Dispare no WhatsApp ou Telegram:</strong> Em <em>Produtos</em> ou{' '}
                <em>Enviar Mensagens</em>, envie direto para os grupos reais sincronizados da sua
                conta conectada via Baileys ou Bot API.
              </p>
              <p>
                <strong>4. Salve seu Backup:</strong> Todos os dados ficam salvos localmente no
                seu navegador sem precisar de login. Exporte um backup JSON pelo menu do perfil
                sempre que quiser.
              </p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 shadow-lg"
          >
            {t.variant === 'success' && (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            )}
            {t.variant === 'info' && (
              <Info className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            )}
            {t.variant === 'error' && (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {t.title}
              </div>
              {t.description && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t.description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
