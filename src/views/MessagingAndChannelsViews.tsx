import React, { useRef, useState } from 'react';
import {
  MessageCircle,
  Send,
  Search,
  Plus,
  Pencil,
  Trash2,
  Wifi,
  Users,
  MessageSquare,
  RefreshCw,
  Calendar,
  ListOrdered,
  Image as ImageIcon,
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  Quote,
  FileText,
  Smile,
  X,
  Copy,
  Package,
  Play,
  QrCode,
  CheckCircle2,
  Loader2,
  PlugZap,
  Smartphone,
  LogOut,
  MoreVertical,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  ChannelAccount,
  DispatchGroup,
  DispatchQueue,
  Marketplace,
  MonitoringGroup,
} from '../types';
import { WhatsAppMockup } from '../components/WhatsAppMockup';
import { renderProductMessage } from '../utils/templateEngine';
import {
  connectBaileysApi,
  getBaileysStatusApi,
  getWhatsAppQrApi,
  logoutBaileysApi,
  sendTelegramApi,
  sendWhatsAppApi,
  verifyTelegramBotApi,
} from '../utils/apiClient';

/* ============================================================================
 * 1. WHATSAPP & TELEGRAM ACCOUNTS VIEW (Telas 6–7 + Conexão Real QR/Bot API)
 * ========================================================================== */
export const ChannelAccountsView: React.FC<{ channel: 'WhatsApp' | 'Telegram' }> = ({
  channel,
}) => {
  const {
    accounts,
    setAccounts,
    dispatchGroups,
    setDispatchGroups,
    setMonitoringGroups,
    syncWhatsAppGroupsFromAccount,
    activeSegment,
    notify,
  } = useApp();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAcc, setEditingAcc] = useState<ChannelAccount | null>(null);

  // Account Form Fields
  const [accName, setAccName] = useState('');
  const [accPhone, setAccPhone] = useState('');
  const [accProvider, setAccProvider] = useState<
    'baileys' | 'evolution' | 'zapi' | 'webhook' | 'telegram-bot'
  >(channel === 'WhatsApp' ? 'baileys' : 'telegram-bot');
  const [accBaseUrl, setAccBaseUrl] = useState('');
  const [accInstanceName, setAccInstanceName] = useState('');
  const [accToken, setAccToken] = useState('');
  const [accClientToken, setAccClientToken] = useState('');
  const [defaultTargetId, setDefaultTargetId] = useState('');

  // Async Connection, QR Code & Pairing Code States
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [connectTab, setConnectTab] = useState<'qr' | 'pairing'>('qr');
  const [pairingPhoneInput, setPairingPhoneInput] = useState('');
  const [qrModalData, setQrModalData] = useState<{
    accountId: string;
    accountName: string;
    provider: 'baileys' | 'evolution' | 'zapi' | 'webhook';
    qrBase64: string | null;
    pairingCode?: string | null;
    connected?: boolean;
    state?: string;
    error?: string;
  } | null>(null);

  const resolveEffectiveWaProvider = (
    acc: ChannelAccount
  ): 'baileys' | 'evolution' | 'zapi' | 'webhook' => {
    if (acc.provider === 'zapi' || acc.provider === 'webhook' || acc.provider === 'evolution') {
      return acc.provider;
    }
    if (acc.webhookUrl) return 'webhook';
    if (acc.baseUrl && acc.apiToken) return 'evolution';
    return 'baileys';
  };

  // Poll live Baileys WebSocket status every 2.5s while connection modal is open
  React.useEffect(() => {
    if (!qrModalData || qrModalData.provider !== 'baileys' || qrModalData.connected) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await getBaileysStatusApi(qrModalData.accountId);
        if (!res.ok) return;

        if (res.connected) {
          setQrModalData((prev) =>
            prev
              ? {
                  ...prev,
                  connected: true,
                  state: 'open',
                  qrBase64: null,
                  pairingCode: null,
                  error: undefined,
                }
              : null
          );
          const connectedAcc: ChannelAccount = {
            id: qrModalData.accountId,
            name: res.name || qrModalData.accountName,
            channel: 'WhatsApp',
            phoneOrHandle: res.phone || 'Conectado via Baileys',
            connected: true,
            provider: 'baileys',
          };
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === qrModalData.accountId
                ? {
                    ...a,
                    name: res.name || a.name,
                    provider: 'baileys',
                    connected: true,
                    phoneOrHandle: res.phone || a.phoneOrHandle,
                  }
                : a
            )
          );
          notify(
            'WhatsApp conectado! Puxando seus grupos reais...',
            res.phone ? `Sessão ativa em ${res.phone}` : qrModalData.accountName
          );
          void syncWhatsAppGroupsFromAccount(connectedAcc, { silent: false });
        } else {
          setQrModalData((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              qrBase64: connectTab === 'qr' ? res.qrBase64 || prev.qrBase64 : prev.qrBase64,
              pairingCode:
                connectTab === 'pairing'
                  ? res.pairingCode || prev.pairingCode
                  : prev.pairingCode,
              state: res.status,
              error: res.error || prev.error,
            };
          });
        }
      } catch {
        // Ignore transient poll error
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [qrModalData, connectTab, setAccounts, notify, syncWhatsAppGroupsFromAccount]);

  const list = accounts.filter(
    (a) =>
      a.channel === channel &&
      (!search.trim() ||
        a.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        a.phoneOrHandle.toLowerCase().includes(search.trim().toLowerCase()))
  );

  const openCreate = () => {
    setEditingAcc(null);
    setAccName(
      channel === 'WhatsApp' ? `CONTA 0${list.length + 1}` : `BOT TELEGRAM 0${list.length + 1}`
    );
    setAccPhone(channel === 'WhatsApp' ? 'Aguardando conexão' : '@meu_bot_ofertas');
    setAccProvider(channel === 'WhatsApp' ? 'baileys' : 'telegram-bot');
    setAccBaseUrl('');
    setAccInstanceName(channel === 'WhatsApp' ? `conta0${list.length + 1}` : '');
    setAccToken('');
    setAccClientToken('');
    setDefaultTargetId('');
    setModalOpen(true);
  };

  const openEdit = (acc: ChannelAccount) => {
    setEditingAcc(acc);
    setAccName(acc.name);
    setAccPhone(acc.phoneOrHandle);
    setAccProvider(
      channel === 'WhatsApp'
        ? resolveEffectiveWaProvider(acc)
        : acc.provider || 'telegram-bot'
    );
    setAccBaseUrl(acc.baseUrl || acc.webhookUrl || '');
    setAccInstanceName(acc.instanceName || '');
    setAccToken(acc.apiToken || '');
    setAccClientToken(acc.clientToken || '');
    setDefaultTargetId('');
    setModalOpen(true);
  };

  const importDiscoveredTelegramChats = (
    accId: string,
    accLabel: string,
    chats: { id: string; title: string; type: string; username?: string }[],
    manualChatId?: string
  ) => {
    const itemsToMerge = [...chats];
    if (manualChatId?.trim() && !itemsToMerge.some((c) => c.id === manualChatId.trim())) {
      itemsToMerge.push({
        id: manualChatId.trim(),
        title: manualChatId.trim().startsWith('@')
          ? `Canal ${manualChatId.trim()}`
          : `Grupo Telegram (${manualChatId.trim()})`,
        type: 'channel',
      });
    }

    if (itemsToMerge.length === 0) return 0;

    let added = 0;
    setDispatchGroups((prev) => {
      const next = [...prev];
      for (const ch of itemsToMerge) {
        const existsIdx = next.findIndex(
          (g) => g.remoteJid === ch.id || (g.channel === 'Telegram' && g.name === ch.title)
        );
        if (existsIdx >= 0) {
          next[existsIdx] = {
            ...next[existsIdx],
            remoteJid: ch.id,
            accountId: accId,
            accountName: accLabel,
          };
        } else {
          added++;
          next.push({
            id: `grp-tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: ch.title,
            channel: 'Telegram',
            accountId: accId,
            accountName: accLabel,
            remoteJid: ch.id,
            isChannel: ch.type === 'channel',
            activeForOffers: next.filter((g) => g.activeForOffers).length < 5,
            membersCount: 1,
            maxCapacity: 200000,
            inviteUrl: ch.username ? `https://t.me/${ch.username}` : 'https://t.me/',
            segment: activeSegment,
          });
        }
      }
      return next;
    });
    return added;
  };

  const handleVerifyTelegramInModal = async () => {
    if (!accToken.trim()) {
      notify('Informe o Bot Token', 'Crie ou copie seu token no @BotFather do Telegram.', 'error');
      return;
    }
    setBusyAction('verify-tg');
    try {
      const res = await verifyTelegramBotApi(accToken.trim());
      if (!res.ok || !res.bot) {
        notify('Falha ao conectar Bot', res.error || 'Token inválido.', 'error');
        return;
      }
      setAccPhone(res.bot.username);
      if (!accName.trim() || accName.startsWith('BOT TELEGRAM')) {
        setAccName(res.bot.name || res.bot.username);
      }

      const targetAccId = editingAcc?.id || `acc-tg-${Date.now()}`;
      const added = importDiscoveredTelegramChats(
        targetAccId,
        res.bot.name || accName,
        res.discoveredChats || [],
        defaultTargetId
      );

      notify(
        `Bot ${res.bot.username} autenticado!`,
        added > 0
          ? `${added} grupo(s)/canal(is) do Telegram importados automaticamente!`
          : (res.discoveredChats?.length || 0) > 0
          ? `${res.discoveredChats!.length} canal/grupo sincronizado.`
          : 'Adicione o bot como administrador no seu grupo/canal ou preencha o @canal abaixo.'
      );
    } catch {
      notify('Erro de rede ao validar Telegram Bot', undefined, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;

    const targetId = editingAcc?.id || `acc-${Date.now()}`;
    let resolvedHandle = accPhone.trim();

    // Auto-verify Telegram token if provided
    if (channel === 'Telegram' && accToken.trim()) {
      try {
        const check = await verifyTelegramBotApi(accToken.trim());
        if (check.ok && check.bot) {
          resolvedHandle = check.bot.username;
          importDiscoveredTelegramChats(
            targetId,
            accName.trim(),
            check.discoveredChats || [],
            defaultTargetId
          );
        }
      } catch {
        // Save anyway
      }
    } else if (channel === 'Telegram' && defaultTargetId.trim()) {
      importDiscoveredTelegramChats(targetId, accName.trim(), [], defaultTargetId);
    }

    const isBaileys = channel === 'WhatsApp' && accProvider === 'baileys';

    const payload: ChannelAccount = {
      id: targetId,
      name: accName.trim(),
      channel,
      phoneOrHandle: resolvedHandle,
      connected: isBaileys ? Boolean(editingAcc?.connected) : true,
      provider: accProvider,
      baseUrl: accBaseUrl.trim(),
      instanceName: accInstanceName.trim(),
      webhookUrl: accProvider === 'webhook' ? accBaseUrl.trim() : '',
      apiToken: accToken.trim(),
      clientToken: accClientToken.trim(),
    };

    if (editingAcc) {
      setAccounts((prev) => prev.map((a) => (a.id === editingAcc.id ? payload : a)));
      notify('Conta atualizada!', payload.name);
    } else {
      setAccounts((prev) => [...prev, payload]);
      notify(
        isBaileys
          ? 'Conta criada! Clique em QR Code ou Número para parear.'
          : 'Nova conta salva!',
        payload.name
      );
    }
    setModalOpen(false);

    if (isBaileys && !payload.connected) {
      void handleOpenQrCode(payload, 'qr');
    }
  };

  const handleOpenQrCode = async (
    acc: ChannelAccount,
    initialTab: 'qr' | 'pairing' = 'qr',
    forceNew: boolean = false
  ) => {
    const provider = resolveEffectiveWaProvider(acc);

    if (provider === 'webhook') {
      notify('Modo Webhook ativo', 'Webhooks não utilizam leitura de QR Code.', 'info');
      return;
    }

    if (provider === 'baileys') {
      setConnectTab(initialTab);
      setPairingPhoneInput(
        acc.phoneOrHandle && acc.phoneOrHandle !== 'Aguardando conexão' ? acc.phoneOrHandle : ''
      );
      setQrModalData({
        accountId: acc.id,
        accountName: acc.name,
        provider: 'baileys',
        qrBase64: null,
        pairingCode: null,
        connected: false,
        state: 'connecting',
      });

      if (initialTab === 'pairing') {
        const statusSnap = await getBaileysStatusApi(acc.id);
        if (statusSnap.connected) {
          setQrModalData((prev) => (prev ? { ...prev, connected: true, state: 'open' } : null));
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === acc.id
                ? { ...a, connected: true, phoneOrHandle: statusSnap.phone || a.phoneOrHandle }
                : a
            )
          );
          void syncWhatsAppGroupsFromAccount({ ...acc, connected: true }, { silent: false });
        }
        return;
      }

      setBusyAction(`qr-${acc.id}`);
      try {
        const res = await connectBaileysApi({
          accountId: acc.id,
          mode: 'qr',
          forceNew,
        });
        setQrModalData({
          accountId: acc.id,
          accountName: acc.name,
          provider: 'baileys',
          qrBase64: res.qrBase64 || null,
          pairingCode: res.pairingCode || null,
          connected: res.connected,
          state: res.status,
          error: res.error || undefined,
        });
        if (res.connected) {
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === acc.id
                ? { ...a, connected: true, phoneOrHandle: res.phone || a.phoneOrHandle }
                : a
            )
          );
          void syncWhatsAppGroupsFromAccount({ ...acc, connected: true }, { silent: false });
        }
      } catch {
        setQrModalData((prev) =>
          prev ? { ...prev, error: 'Falha ao iniciar WebSocket do Baileys.' } : null
        );
      } finally {
        setBusyAction(null);
      }
      return;
    }

    if (provider === 'evolution' && (!acc.baseUrl || !acc.instanceName || !acc.apiToken)) {
      openEdit(acc);
      notify(
        'Configure sua Evolution API primeiro',
        'Informe a URL do servidor, Nome da Instância e API Key para gerar o QR Code.',
        'info'
      );
      return;
    }
    if (provider === 'zapi' && (!acc.instanceName || !acc.apiToken)) {
      openEdit(acc);
      notify(
        'Configure sua Z-API primeiro',
        'Informe o Instance ID e Token da Z-API para exibir o QR Code.',
        'info'
      );
      return;
    }

    setBusyAction(`qr-${acc.id}`);
    try {
      const res = await getWhatsAppQrApi({
        provider,
        accountId: acc.id,
        baseUrl: acc.baseUrl,
        instanceName: acc.instanceName,
        apiToken: acc.apiToken,
        clientToken: acc.clientToken,
      });
      setConnectTab('qr');
      setQrModalData({
        accountId: acc.id,
        accountName: acc.name,
        provider,
        qrBase64: res.qrBase64 || null,
        pairingCode: res.pairingCode,
        connected: res.connected,
        state: res.state,
        error: res.error,
      });
      if (res.connected) {
        setAccounts((prev) =>
          prev.map((a) => (a.id === acc.id ? { ...a, connected: true } : a))
        );
      }
    } catch {
      notify('Falha ao obter QR Code', 'Verifique se a URL da sua API está acessível.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestBaileysPairingCode = async () => {
    if (!qrModalData) return;
    if (!pairingPhoneInput.trim()) {
      notify('Digite o número do WhatsApp', 'Informe DDI + DDD + Número.', 'error');
      return;
    }
    setBusyAction('pairing-code');
    setQrModalData((prev) =>
      prev ? { ...prev, pairingCode: null, error: undefined, state: 'connecting' } : null
    );
    try {
      const res = await connectBaileysApi({
        accountId: qrModalData.accountId,
        mode: 'pairing',
        phoneNumber: pairingPhoneInput.trim(),
        forceNew: true,
      });
      setQrModalData((prev) =>
        prev
          ? {
              ...prev,
              pairingCode: res.pairingCode || null,
              qrBase64: null,
              connected: res.connected,
              state: res.status,
              error: res.error || undefined,
            }
          : null
      );
      if (res.pairingCode) {
        notify(
          `Código gerado: ${res.pairingCode}`,
          'Digite este código em Aparelhos Conectados no seu WhatsApp.'
        );
      } else if (res.error) {
        notify('Erro ao gerar código', res.error, 'error');
      }
    } catch {
      notify('Falha ao solicitar código de pareamento', undefined, 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogoutBaileys = async (acc: ChannelAccount) => {
    setBusyAction(`logout-${acc.id}`);
    try {
      await logoutBaileysApi(acc.id);
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === acc.id
            ? { ...a, connected: false, phoneOrHandle: 'Aguardando conexão' }
            : a
        )
      );
      setDispatchGroups((prev) => prev.filter((g) => g.accountId !== acc.id));
      setMonitoringGroups((prev) => prev.filter((m) => m.accountId !== acc.id));
      void syncWhatsAppGroupsFromAccount(undefined, { silent: true });
      notify(
        'Sessão WhatsApp desconectada',
        `${acc.name} desconectada. Os grupos foram ocultados mantendo suas preferências salvas para quando reconectar.`,
        'info'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncAccountGroups = async (acc: ChannelAccount) => {
    if (acc.channel === 'Telegram') {
      if (!acc.apiToken) {
        openEdit(acc);
        notify('Informe o Bot Token', 'Adicione o token do @BotFather para sincronizar.', 'info');
        return;
      }
      setBusyAction(`sync-${acc.id}`);
      try {
        const res = await verifyTelegramBotApi(acc.apiToken);
        if (res.ok && res.bot) {
          const added = importDiscoveredTelegramChats(
            acc.id,
            acc.name,
            res.discoveredChats || []
          );
          notify(
            `Telegram sincronizado (${res.bot.username})`,
            `${res.discoveredChats?.length || 0} chat(s) detectados (${added} novos adicionados em Grupos de Envio).`
          );
        } else {
          notify('Erro no Bot Telegram', res.error || 'Token inválido', 'error');
        }
      } finally {
        setBusyAction(null);
      }
      return;
    }

    // WhatsApp Group Sync (strict reconciliation from live connected session)
    const provider = resolveEffectiveWaProvider(acc);
    if (
      (provider === 'evolution' && (!acc.baseUrl || !acc.instanceName || !acc.apiToken)) ||
      (provider === 'zapi' && (!acc.instanceName || !acc.apiToken))
    ) {
      openEdit(acc);
      notify(
        'Configure a API do WhatsApp',
        'Preencha URL, Instância e API Key para importar seus grupos reais.',
        'info'
      );
      return;
    }

    setBusyAction(`sync-${acc.id}`);
    try {
      const result = await syncWhatsAppGroupsFromAccount(acc, { silent: false });
      if (!result.ok && provider === 'baileys') {
        void handleOpenQrCode(acc, 'qr');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleQuickTestSend = async (acc: ChannelAccount) => {
    const linkedGroups = dispatchGroups.filter(
      (g) => g.accountId === acc.id && g.remoteJid?.trim()
    );
    if (linkedGroups.length === 0) {
      notify(
        'Puxe seus grupos primeiro',
        acc.channel === 'Telegram'
          ? 'Clique em "Sincronizar Canais" ou informe o @canal / Chat ID em Grupos de Envio.'
          : 'Conecte o WhatsApp (QR Code ou Número) e clique em "Puxar Grupos" para importar o JID real.',
        'info'
      );
      return;
    }

    setBusyAction(`test-${acc.id}`);
    try {
      const sampleMsg = `✅ *Teste de conexão BuboFlow*\nCanal *${acc.name}* conectado e pronto para disparar ofertas automaticamente!`;
      if (acc.channel === 'Telegram') {
        const res = await sendTelegramApi({
          botToken: acc.apiToken || '',
          chatIds: [linkedGroups[0].remoteJid!],
          message: sampleMsg,
        });
        if (res.ok) {
          notify('Mensagem enviada no Telegram!', `Entregue em ${linkedGroups[0].name}.`);
        } else {
          notify(
            'Erro ao enviar no Telegram',
            res.results?.[0]?.error || res.error || 'Verifique se o bot é admin do canal.',
            'error'
          );
        }
      } else {
        const provider = resolveEffectiveWaProvider(acc);
        const res = await sendWhatsAppApi({
          provider,
          accountId: acc.id,
          baseUrl: acc.baseUrl || acc.webhookUrl,
          instanceName: acc.instanceName,
          apiToken: acc.apiToken,
          clientToken: acc.clientToken,
          remoteJids: [linkedGroups[0].remoteJid!],
          message: sampleMsg,
        });
        if (res.ok) {
          notify('Mensagem enviada no WhatsApp!', `Entregue em ${linkedGroups[0].name}.`);
        } else {
          notify(
            'Erro ao enviar no WhatsApp',
            res.results?.[0]?.error || res.error || 'Verifique a conexão da sessão.',
            'error'
          );
        }
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              channel === 'WhatsApp'
                ? 'bg-emerald-100 text-[#15803D] dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400'
            }`}
          >
            {channel === 'WhatsApp' ? (
              <MessageCircle className="w-5 h-5" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {channel}
          </h1>
          <Wifi className="w-4 h-4 text-[#15803D] dark:text-emerald-400 ml-1" />
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Conectar {channel}</span>
        </button>
      </div>

      {/* Info Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
        {channel === 'WhatsApp' ? (
          <span>
            Conexão direta integrada via <strong>Baileys (WhatsApp Multi-Device)</strong>: conecte
            lendo o <strong>QR Code</strong> ou digitando seu <strong>Número de Telefone</strong>{' '}
            (código de 8 dígitos), puxe todos os seus grupos reais e dispare ofertas com foto sem
            precisar de API externa.
          </span>
        ) : (
          <span>
            Conecte seu <strong>Bot do Telegram (@BotFather)</strong> para descobrir seus canais/grupos
            automaticamente e disparar ofertas com foto e formatação HTML direto pela API oficial do Telegram.
          </span>
        )}
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2.5 max-w-xl">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => notify('Lista atualizada', `${list.length} instância(s) encontrada(s).`, 'info')}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Search className="w-4 h-4" />
          <span>Pesquisar</span>
        </button>
      </div>

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {list.map((acc) => {
          const waProvider = channel === 'WhatsApp' ? resolveEffectiveWaProvider(acc) : null;
          const isApiReady =
            acc.channel === 'Telegram'
              ? Boolean(acc.apiToken)
              : waProvider === 'baileys'
              ? acc.connected
              : Boolean(acc.apiToken && (acc.baseUrl || acc.instanceName || acc.webhookUrl));

          const badgeLabel =
            acc.channel === 'Telegram'
              ? isApiReady
                ? 'Bot API Ativa'
                : 'Aguardando Token @BotFather'
              : waProvider === 'baileys'
              ? acc.connected
                ? 'Baileys Conectado'
                : 'Baileys · Parear QR ou Número'
              : isApiReady
              ? `${waProvider?.toUpperCase()} Configurada`
              : 'Aguardando Credenciais';

          return (
            <div
              key={acc.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 flex flex-col justify-between gap-4"
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                    channel === 'WhatsApp'
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400'
                  }`}
                >
                  {channel === 'WhatsApp' ? (
                    <MessageCircle className="w-6 h-6" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base text-slate-900 dark:text-white">
                      {acc.name}
                    </span>
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${
                        isApiReady
                          ? 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/70 dark:text-emerald-300'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {badgeLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        acc.connected
                          ? 'text-[#15803D] dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {acc.connected ? '✓ Conectado' : '● Desconectado'}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                      {acc.phoneOrHandle}
                    </span>
                  </div>
                  {waProvider !== 'baileys' && (acc.baseUrl || acc.instanceName) && (
                    <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
                      {acc.instanceName ? `Instância: ${acc.instanceName}` : ''}{' '}
                      {acc.baseUrl ? `· ${acc.baseUrl}` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  {channel === 'WhatsApp' && (
                    <>
                      <button
                        type="button"
                        disabled={busyAction === `qr-${acc.id}`}
                        onClick={() => void handleOpenQrCode(acc, 'qr')}
                        className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        {busyAction === `qr-${acc.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <QrCode className="w-3.5 h-3.5" />
                        )}
                        <span>QR Code</span>
                      </button>

                      {waProvider === 'baileys' && (
                        <button
                          type="button"
                          onClick={() => void handleOpenQrCode(acc, 'pairing')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>Conectar por Número</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    disabled={busyAction === `sync-${acc.id}`}
                    onClick={() => void handleSyncAccountGroups(acc)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        busyAction === `sync-${acc.id}` ? 'animate-spin text-[#15803D]' : ''
                      }`}
                    />
                    <span>{channel === 'Telegram' ? 'Sincronizar Canais' : 'Puxar Grupos'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction === `test-${acc.id}`}
                    onClick={() => void handleQuickTestSend(acc)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <PlugZap className="w-3.5 h-3.5 text-[#15803D] dark:text-emerald-400" />
                    <span>Testar Envio</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {channel === 'WhatsApp' && waProvider === 'baileys' && acc.connected && (
                    <button
                      type="button"
                      disabled={busyAction === `logout-${acc.id}`}
                      onClick={() => void handleLogoutBaileys(acc)}
                      title="Desconectar sessão Baileys"
                      className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(acc)}
                    title="Configurar Conta"
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        if (channel === 'WhatsApp' && waProvider === 'baileys') {
                          await logoutBaileysApi(acc.id);
                        }
                        setAccounts((prev) => prev.filter((a) => a.id !== acc.id));
                        setDispatchGroups((prev) => prev.filter((g) => g.accountId !== acc.id));
                        setMonitoringGroups((prev) => prev.filter((m) => m.accountId !== acc.id));
                        if (channel === 'WhatsApp') {
                          void syncWhatsAppGroupsFromAccount(undefined, { silent: true });
                        }
                        notify('Conta removida', acc.name, 'info');
                      })();
                    }}
                    title="Remover conta"
                    className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Dashed + Nova Conta Card */}
        <button
          type="button"
          onClick={openCreate}
          className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 hover:border-[#15803D] p-8 flex flex-col items-center justify-center gap-2.5 transition-colors min-h-[160px]"
        >
          <span className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center">
            <Plus className="w-6 h-6" />
          </span>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Nova Conta {channel}
          </span>
        </button>
      </div>

      {/* Modal Conexão WhatsApp (Baileys QR Code + Código de Pareamento por Número) */}
      {qrModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Conectar WhatsApp · {qrModalData.accountName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrModalData(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Method Switcher (QR Code vs Phone Number Pairing Code) */}
            {qrModalData.provider === 'baileys' && !qrModalData.connected && (
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setConnectTab('qr');
                    const targetAcc = accounts.find((a) => a.id === qrModalData.accountId);
                    if (targetAcc && !qrModalData.qrBase64) {
                      void handleOpenQrCode(targetAcc, 'qr', true);
                    }
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    connectTab === 'qr'
                      ? 'bg-white dark:bg-slate-900 text-[#15803D] dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConnectTab('pairing')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    connectTab === 'pairing'
                      ? 'bg-white dark:bg-slate-900 text-[#15803D] dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Número de Telefone</span>
                </button>
              </div>
            )}

            {qrModalData.connected ? (
              <div className="py-6 space-y-4 text-center">
                <CheckCircle2 className="w-12 h-12 text-[#15803D] mx-auto" />
                <div className="space-y-1">
                  <div className="font-bold text-base text-[#15803D] dark:text-emerald-400">
                    WhatsApp Conectado com Sucesso!
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sessão multi-dispositivo Baileys ativa. Clique abaixo para importar seus grupos
                    reais e começar a enviar ofertas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const targetAcc = accounts.find((a) => a.id === qrModalData.accountId);
                    setQrModalData(null);
                    if (targetAcc) {
                      void handleSyncAccountGroups({ ...targetAcc, connected: true });
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Puxar Meus Grupos Agora</span>
                </button>
              </div>
            ) : connectTab === 'pairing' && qrModalData.provider === 'baileys' ? (
              <div className="space-y-3.5">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">
                    Ideal se você está acessando pelo próprio celular:
                  </p>
                  <p>
                    1. Digite seu número com DDD abaixo e clique em <strong>Gerar Código</strong>.
                  </p>
                  <p>
                    2. No WhatsApp, toque em <strong>Aparelhos conectados → Conectar aparelho → Conectar com número de telefone</strong>.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Número do WhatsApp (DDI 55 + DDD + Número)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={pairingPhoneInput}
                      onChange={(e) => setPairingPhoneInput(e.target.value)}
                      placeholder="Ex: 5587996109189"
                      className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono tabular-nums"
                    />
                    <button
                      type="button"
                      disabled={busyAction === 'pairing-code'}
                      onClick={() => void handleRequestBaileysPairingCode()}
                      className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
                    >
                      {busyAction === 'pairing-code' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Smartphone className="w-3.5 h-3.5" />
                      )}
                      <span>Gerar Código</span>
                    </button>
                  </div>
                </div>

                {qrModalData.pairingCode && (
                  <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 text-center space-y-2.5">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                      Seu Código de Pareamento WhatsApp
                    </div>
                    <div className="text-2xl sm:text-3xl font-mono font-bold tracking-[0.22em] text-[#15803D] dark:text-emerald-400 select-all">
                      {qrModalData.pairingCode}
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            qrModalData.pairingCode!.replace(/[^A-Z0-9]/gi, '')
                          );
                          notify('Código copiado!', qrModalData.pairingCode!);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Código</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 pt-1">
                      <Loader2 className="w-3 h-3 animate-spin text-[#15803D]" />
                      <span>Aguardando você digitar o código no WhatsApp...</span>
                    </div>
                  </div>
                )}

                {qrModalData.error && (
                  <div className="text-xs text-rose-600 dark:text-rose-400 text-center">
                    {qrModalData.error}
                  </div>
                )}
              </div>
            ) : qrModalData.qrBase64 ? (
              <div className="space-y-3 text-center">
                <div className="bg-white p-3 rounded-xl inline-block border border-slate-200 shadow-xs">
                  <img
                    src={
                      qrModalData.qrBase64.startsWith('data:image')
                        ? qrModalData.qrBase64
                        : `data:image/png;base64,${qrModalData.qrBase64}`
                    }
                    alt="WhatsApp QR Code"
                    className="w-56 h-56 object-contain mx-auto"
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Abra o WhatsApp no celular → <strong>Aparelhos conectados → Conectar um aparelho</strong> e aponte a câmera.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin text-[#15803D]" />
                    Aguardando leitura em tempo real...
                  </span>
                  {qrModalData.provider === 'baileys' && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetAcc = accounts.find((a) => a.id === qrModalData.accountId);
                        if (targetAcc) void handleOpenQrCode(targetAcc, 'qr', true);
                      }}
                      className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
                    >
                      Atualizar QR
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center space-y-2.5">
                {busyAction?.startsWith('qr-') || qrModalData.state === 'connecting' ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin text-[#15803D] mx-auto" />
                    <p className="text-xs text-slate-500">
                      Iniciando sessão segura Baileys com os servidores do WhatsApp...
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                      {qrModalData.error || 'Sessão expirada ou indisponível.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const targetAcc = accounts.find((a) => a.id === qrModalData.accountId);
                        if (targetAcc) void handleOpenQrCode(targetAcc, 'qr', true);
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 text-xs font-semibold"
                    >
                      Gerar Novo QR Code
                    </button>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setQrModalData(null)}
              className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal Add / Edit Account */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4 my-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {editingAcc ? `Configurar ${editingAcc.name}` : `Conectar ${channel}`}
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
                  Identificação da Conta
                </label>
                <input
                  type="text"
                  required
                  value={accName}
                  onChange={(e) => setAccName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  {channel === 'WhatsApp' ? 'Número do WhatsApp (com DDD)' : 'Username do Bot (@handle)'}
                </label>
                <input
                  type="text"
                  required
                  value={accPhone}
                  onChange={(e) => setAccPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
                />
              </div>

              {channel === 'WhatsApp' ? (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Modo de Conexão WhatsApp
                  </div>
                  <select
                    value={accProvider}
                    onChange={(e) =>
                      setAccProvider(
                        e.target.value as 'baileys' | 'evolution' | 'zapi' | 'webhook'
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold"
                  >
                    <option value="baileys">
                      Baileys Nativo Integrado (QR Code ou Número de Telefone — Recomendado)
                    </option>
                    <option value="evolution">Evolution API Externa (v1 / v2)</option>
                    <option value="zapi">Z-API Externa (Instância + Token)</option>
                    <option value="webhook">Webhook HTTP Próprio (n8n / Typebot / Make)</option>
                  </select>

                  {accProvider === 'baileys' ? (
                    <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 p-3 text-xs text-slate-600 dark:text-slate-300">
                      Nenhuma chave ou servidor externo necessário. Ao salvar, você poderá conectar
                      direto pelo <strong>QR Code</strong> ou digitando seu{' '}
                      <strong>Número de Telefone</strong>.
                    </div>
                  ) : (
                    <>
                      {accProvider !== 'zapi' && (
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            {accProvider === 'evolution'
                              ? 'URL Base da Evolution API'
                              : 'URL do Webhook (POST)'}
                          </label>
                          <input
                            type="url"
                            value={accBaseUrl}
                            onChange={(e) => setAccBaseUrl(e.target.value)}
                            placeholder={
                              accProvider === 'evolution'
                                ? 'https://evolution.seudominio.com.br'
                                : 'https://seu-n8n.com/webhook/whatsapp'
                            }
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                          />
                        </div>
                      )}

                      {accProvider !== 'webhook' && (
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            {accProvider === 'evolution'
                              ? 'Nome da Instância (instanceName)'
                              : 'ID da Instância Z-API'}
                          </label>
                          <input
                            type="text"
                            value={accInstanceName}
                            onChange={(e) => setAccInstanceName(e.target.value)}
                            placeholder="Ex: divulgatudo01"
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] text-slate-500 mb-1">
                          {accProvider === 'evolution'
                            ? 'Global / Instance API Key (apikey)'
                            : accProvider === 'zapi'
                            ? 'Token da Instância Z-API'
                            : 'Bearer Token (opcional)'}
                        </label>
                        <input
                          type="password"
                          value={accToken}
                          onChange={(e) => setAccToken(e.target.value)}
                          placeholder="Cole sua chave de API aqui"
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                        />
                      </div>

                      {accProvider === 'zapi' && (
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Client-Token de Segurança Z-API (opcional)
                          </label>
                          <input
                            type="password"
                            value={accClientToken}
                            onChange={(e) => setAccClientToken(e.target.value)}
                            placeholder="Client-Token do painel Z-API"
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Token Oficial do Bot (@BotFather)
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Crie um bot no <strong>@BotFather</strong>, adicione-o como administrador no seu
                    canal ou grupo de ofertas e clique em Verificar abaixo.
                  </p>
                  <input
                    type="password"
                    value={accToken}
                    onChange={(e) => setAccToken(e.target.value)}
                    placeholder="Ex: 748291038:AAHxyz1234567890..."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                  />

                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Canal ou Chat ID padrão (opcional — ex: @divulgatudo ou -100123456789)
                    </label>
                    <input
                      type="text"
                      value={defaultTargetId}
                      onChange={(e) => setDefaultTargetId(e.target.value)}
                      placeholder="Ex: @divulgatudoofertas ou -1001987654321"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busyAction === 'verify-tg'}
                    onClick={() => void handleVerifyTelegramInModal()}
                    className="w-full py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    {busyAction === 'verify-tg' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>Verificar Bot & Descobrir Canais</span>
                  </button>
                </div>
              )}
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
                Salvar Conexão
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 2. ENVIAR MENSAGENS COMPOSER VIEW (Telas 8–10)
 * ========================================================================== */
const QUICK_EMOJIS = ['💥', '🔥', '💸', '✨', '🎟️', '🔗', '⚡', '🏃', '✅', '⚠️'];

export const SendMessageComposerView: React.FC = () => {
  const {
    dispatchGroups,
    products,
    integrations,
    getTemplateForPlatform,
    dispatchCustomMessage,
    setSchedules,
    notify,
  } = useApp();

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() =>
    dispatchGroups.filter((g) => g.activeForOffers).map((g) => g.id)
  );
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [mentionAll, setMentionAll] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [recurrence, setRecurrence] = useState<'Único' | 'Recorrente'>('Único');
  const [uploadedImage, setUploadedImage] = useState<string>('');
  const [linkPreview, setLinkPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [lastSentText, setLastSentText] = useState<string | null>(null);

  React.useEffect(() => {
    setSelectedGroupIds((prev) => {
      const valid = prev.filter((id) => dispatchGroups.some((g) => g.id === id));
      if (valid.length > 0) return valid;
      return dispatchGroups.filter((g) => g.activeForOffers).map((g) => g.id);
    });
  }, [dispatchGroups]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wrapSelection = (prefix: string, suffix: string = prefix) => {
    const el = textareaRef.current;
    if (!el) {
      setMessage((prev) => `${prev}${prefix}texto${suffix}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = message.slice(start, end) || 'texto';
    const updated =
      message.slice(0, start) + prefix + selected + suffix + message.slice(end);
    setMessage(updated);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setUploadedImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setUploadedImage(reader.result);
            notify('Imagem colada da área de transferência!');
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const selectedGroups = dispatchGroups.filter((g) => selectedGroupIds.includes(g.id));
  const primaryGroupName =
    selectedGroups[0]?.name || dispatchGroups[0]?.name || 'Grupo WhatsApp';

  const handleSend = async () => {
    if (isSending) return;
    if (!message.trim()) {
      notify('Digite uma mensagem', 'O campo de mensagem não pode estar vazio.', 'error');
      return;
    }
    if (selectedGroups.length === 0) {
      notify(
        'Selecione pelo menos um grupo',
        dispatchGroups.length === 0
          ? 'Conecte seu WhatsApp para carregar automaticamente seus grupos reais.'
          : 'Clique no campo Grupos acima e escolha onde enviar.',
        'info'
      );
      return;
    }

    const finalMsg = mentionAll ? `@todos\n\n${message.trim()}` : message.trim();
    const targetNames = selectedGroups.map((g) => g.name);

    if (scheduleDateTime) {
      setSchedules((prev) => [
        {
          id: `sch-${Date.now()}`,
          title: finalMsg.split('\n')[0].slice(0, 48) || 'Mensagem Agendada',
          message: finalMsg,
          groupIds: selectedGroups.map((g) => g.id),
          scheduledAt: scheduleDateTime,
          recurrence,
          status: 'Pendente',
          imageUrl: uploadedImage || undefined,
        },
        ...prev,
      ]);
      notify('Mensagem agendada!', 'Disponível na aba Agendamentos.');
      return;
    }

    setIsSending(true);
    try {
      const res = await dispatchCustomMessage({
        title: finalMsg.split('\n')[0].slice(0, 50) || 'Comunicado de Oferta',
        message: finalMsg,
        groupsNames: targetNames,
        groupIds: selectedGroups.map((g) => g.id),
        customImageUrl: uploadedImage || undefined,
        enableLinkPreview: linkPreview,
        mentionAll,
      });
      if (res.ok) {
        setLastSentText(finalMsg);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-5" onPaste={handlePaste}>
      <div className="flex items-center gap-2.5">
        <Send className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Enviar Mensagens
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Composer Card */}
        <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Compor Mensagem
          </h2>

          {/* Grupos Selector */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              Grupos
            </label>
            <div
              onClick={() => setGroupDropdownOpen((prev) => !prev)}
              className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 flex flex-wrap items-center gap-1.5 cursor-pointer"
            >
              {selectedGroups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-1.5 bg-[#15803D] text-white text-xs font-mono px-2.5 py-1 rounded-lg"
                >
                  <span className="truncate max-w-[180px]">{g.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedGroupIds((prev) => prev.filter((id) => id !== g.id));
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {selectedGroups.length === 0 && (
                <span className="text-sm text-slate-400">Selecione um ou mais grupos...</span>
              )}
            </div>

            {groupDropdownOpen && (
              <div className="mt-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1.5 z-20">
                {dispatchGroups.map((g) => {
                  const selected = selectedGroupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setSelectedGroupIds((prev) =>
                          prev.includes(g.id)
                            ? prev.filter((id) => id !== g.id)
                            : [...prev, g.id]
                        )
                      }
                      className="w-full px-3.5 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/60"
                    >
                      <span>{g.name}</span>
                      {selected && (
                        <span className="text-[#15803D] dark:text-emerald-400 font-bold">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mencionar todos */}
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={mentionAll}
              onChange={(e) => setMentionAll(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#15803D]"
            />
            <span>Mencionar todos</span>
          </label>

          {/* Agendamento opcional */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Agendamento (opcional)
              </label>
              <button
                type="button"
                onClick={() =>
                  setRecurrence((prev) => (prev === 'Único' ? 'Recorrente' : 'Único'))
                }
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {recurrence === 'Único' ? 'Não repetir' : 'Repetir diariamente'}
              </button>
            </div>
            <input
              type="datetime-local"
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm tabular-nums"
            />
          </div>

          {/* Imagem opcional */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              Imagem (opcional)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            {uploadedImage ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img
                  src={uploadedImage}
                  alt="Upload preview"
                  className="w-full h-44 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setUploadedImage('')}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-900/75 text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 py-7 px-4 flex flex-col items-center justify-center text-center hover:border-[#15803D] transition-colors"
              >
                <ImageIcon className="w-7 h-7 text-slate-400 mb-2" />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Clique, arraste ou cole uma imagem aqui
                </span>
                <span className="text-xs text-slate-400 mt-1">Ctrl+V / ⌘V para colar</span>
              </button>
            )}
          </div>

          {/* Enviar imagem com preview de link */}
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={linkPreview}
              onChange={(e) => setLinkPreview(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#15803D]"
            />
            <span>Enviar imagem com preview de link</span>
          </label>

          {/* Mensagem + Formatting Toolbar */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              Mensagem
            </label>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
              <textarea
                ref={textareaRef}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite sua mensagem aqui..."
                className="w-full p-3.5 text-sm bg-transparent focus:outline-none resize-y"
              />

              {/* Toolbar */}
              <div className="bg-slate-50 dark:bg-slate-800/90 border-t border-slate-200 dark:border-slate-700 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => wrapSelection('*')}
                    title="Negrito (*texto*)"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapSelection('_')}
                    title="Itálico (_texto_)"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapSelection('~')}
                    title="Tachado (~texto~)"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Strikethrough className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapSelection('`')}
                    title="Monoespaçado (`código`)"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Code className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessage((prev) => `${prev}\n• Item da lista`)}
                    title="Lista"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <List className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessage((prev) => `${prev}\n> Destaque da oferta`)}
                    title="Citação"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Quote className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowProductPicker((prev) => !prev)}
                    title="Preencher com oferta do catálogo"
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Puxar Oferta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmojis((prev) => !prev)}
                    title="Inserir Emoji"
                    className="p-1.5 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {showEmojis && (
              <div className="mt-2 flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                {QUICK_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setMessage((prev) => `${prev}${em}`)}
                    className="w-8 h-8 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-base"
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}

            {showProductPicker && (
              <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 space-y-1 max-h-44 overflow-y-auto">
                <div className="text-[11px] font-semibold text-slate-500 px-2 py-1">
                  Clique em um produto para preencher a copy formatada:
                </div>
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const tpl = getTemplateForPlatform(p.platform);
                      const text = renderProductMessage(p, tpl, integrations);
                      setMessage(text);
                      setShowProductPicker(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white dark:hover:bg-slate-700 flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-medium">{p.title}</span>
                    <span className="text-slate-400 shrink-0">{p.platform}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isSending}
            onClick={handleSend}
            className="w-full py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
          >
            {isSending && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {isSending
                ? 'Enviando automaticamente...'
                : scheduleDateTime
                ? 'Agendar Mensagem'
                : 'Enviar Agora'}
            </span>
          </button>

          {lastSentText && (
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(lastSentText);
                  notify('Texto copiado!');
                }}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar texto enviado</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: Live WhatsApp Preview */}
        <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
          <h2 className="font-bold text-base text-slate-900 dark:text-white mb-4">
            Preview WhatsApp
          </h2>
          <WhatsAppMockup
            groupName={primaryGroupName}
            message={mentionAll && message.trim() ? `@todos\n\n${message}` : message}
            customImageUrl={uploadedImage || undefined}
            showMedia={Boolean(uploadedImage)}
            enableLinkPreview={linkPreview}
            time="22:53"
          />
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. GRUPOS DE ENVIO & GRUPOS DE MONITORAMENTO (Telas 30–38)
 * ========================================================================== */
export const GroupsManagementView: React.FC<{ mode: 'envio' | 'monitoramento' }> = ({
  mode,
}) => {
  const {
    dispatchGroups,
    setDispatchGroups,
    monitoringGroups,
    setMonitoringGroups,
    accounts,
    activeSegment,
    syncWhatsAppGroupsFromAccount,
    setRoute,
    notify,
  } = useApp();

  const [statusFilter, setStatusFilter] = useState('Todos os Status');
  const [platformFilter, setPlatformFilter] = useState('Todas as Plataformas');
  const [accountFilter, setAccountFilter] = useState('Todas as Contas');
  const [search, setSearch] = useState('');
  const [addGroupModal, setAddGroupModal] = useState(false);

  const [newName, setNewName] = useState('');
  const [newChannel, setNewChannel] = useState<'WhatsApp' | 'Telegram'>('WhatsApp');
  const [newAccountId, setNewAccountId] = useState(accounts[0]?.id || '');
  const [newRemoteJid, setNewRemoteJid] = useState('');
  const [newInvite, setNewInvite] = useState('https://chat.whatsapp.com/');
  const [newIsChannel, setNewIsChannel] = useState(false);
  const [syncingGroups, setSyncingGroups] = useState(false);

  const MONITORING_MARKETPLACES: Marketplace[] = [
    'Shopee',
    'Amazon',
    'Mercado Livre',
    'Netshoes',
    'Magalu',
    'AliExpress',
  ];
  const [editingMonGroup, setEditingMonGroup] = useState<MonitoringGroup | null>(null);
  const [editUseGroupImage, setEditUseGroupImage] = useState(false);
  const [editMarketplaces, setEditMarketplaces] = useState<Marketplace[]>(MONITORING_MARKETPLACES);

  const openMonitoringConfigModal = (group: MonitoringGroup) => {
    setEditingMonGroup(group);
    setEditUseGroupImage(Boolean(group.useGroupImage));
    setEditMarketplaces(
      group.allowedMarketplaces && group.allowedMarketplaces.length > 0
        ? [...group.allowedMarketplaces]
        : [...MONITORING_MARKETPLACES]
    );
  };

  const toggleEditMarketplace = (marketplace: Marketplace) => {
    setEditMarketplaces((prev) =>
      prev.includes(marketplace)
        ? prev.filter((m) => m !== marketplace)
        : [...prev, marketplace]
    );
  };

  const handleSaveMonitoringConfig = () => {
    if (!editingMonGroup) return;
    if (editMarketplaces.length === 0) {
      notify(
        'Selecione ao menos um marketplace',
        'Escolha pelo menos uma plataforma para monitorar neste grupo.',
        'error'
      );
      return;
    }
    setMonitoringGroups((prev) =>
      prev.map((m) =>
        m.id === editingMonGroup.id
          ? {
              ...m,
              useGroupImage: editUseGroupImage,
              allowedMarketplaces: editMarketplaces,
            }
          : m
      )
    );
    notify(
      'Configuração do grupo salva!',
      `${editingMonGroup.name}: ${editMarketplaces.join(', ')}${
        editUseGroupImage ? ' • Foto do grupo ativada' : ''
      }`
    );
    setEditingMonGroup(null);
  };

  const maxLimit = 5;

  // Automatically pull real groups whenever opening Grupos de Envio or Monitoramento
  React.useEffect(() => {
    void syncWhatsAppGroupsFromAccount(undefined, { silent: true });
  }, [mode, syncWhatsAppGroupsFromAccount]);

  const syncAllConnectedChannels = async () => {
    setSyncingGroups(true);
    let totalFound = 0;
    try {
      const waResult = await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
      if (waResult.ok) {
        totalFound += waResult.count;
      }

      for (const acc of accounts) {
        if (!acc.connected) continue;
        if (acc.channel === 'Telegram' && acc.apiToken) {
          const tgRes = await verifyTelegramBotApi(acc.apiToken);
          if (tgRes.ok && tgRes.discoveredChats?.length) {
            totalFound += tgRes.discoveredChats.length;
            setDispatchGroups((prev) => {
              const next = [...prev];
              for (const ch of tgRes.discoveredChats!) {
                const idx = next.findIndex(
                  (g) => g.remoteJid === ch.id || (g.channel === 'Telegram' && g.name === ch.title)
                );
                if (idx >= 0) {
                  next[idx] = { ...next[idx], remoteJid: ch.id, accountId: acc.id, accountName: acc.name };
                } else {
                  next.push({
                    id: `grp-tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name: ch.title,
                    channel: 'Telegram',
                    accountId: acc.id,
                    accountName: acc.name,
                    remoteJid: ch.id,
                    isChannel: ch.type === 'channel',
                    activeForOffers: false,
                    membersCount: 1,
                    maxCapacity: 200000,
                    inviteUrl: ch.username ? `https://t.me/${ch.username}` : 'https://t.me/',
                    segment: activeSegment,
                  });
                }
              }
              return next;
            });
          }
        }
      }

      if (totalFound > 0) {
        notify(
          'Grupos reais sincronizados!',
          `${totalFound} grupo(s)/canal(is) puxados diretamente da sua conta conectada.`
        );
      } else {
        notify(
          'Nenhum grupo encontrado na sessão atual',
          'Verifique se o seu WhatsApp está conectado em Canais → WhatsApp.',
          'info'
        );
      }
    } catch {
      notify('Erro ao sincronizar grupos', undefined, 'error');
    } finally {
      setSyncingGroups(false);
    }
  };

  if (mode === 'envio') {
    const activeCount = dispatchGroups.filter((g) => g.activeForOffers).length;
    const filtered = dispatchGroups.filter((g) => {
      if (statusFilter === 'Enviar Ofertas' && !g.activeForOffers) return false;
      if (statusFilter === 'Não Enviar Ofertas' && g.activeForOffers) return false;
      if (platformFilter !== 'Todas as Plataformas' && g.channel !== platformFilter) {
        return false;
      }
      if (accountFilter !== 'Todas as Contas' && !accountFilter.includes(g.accountName)) {
        return false;
      }
      if (search.trim() && !g.name.toLowerCase().includes(search.trim().toLowerCase())) {
        return false;
      }
      return true;
    });

    const toggleGroupActive = (group: DispatchGroup) => {
      if (!group.activeForOffers && activeCount >= maxLimit) {
        notify('Limite atingido', `Máximo de ${maxLimit} grupos ativos simultâneos.`, 'error');
        return;
      }
      setDispatchGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, activeForOffers: !g.activeForOffers } : g
        )
      );
      notify(
        !group.activeForOffers ? 'Envio ativado no grupo' : 'Envio pausado no grupo',
        group.name
      );
    };

    const handleAddDispatchGroup = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newName.trim()) return;
      const matchingAcc =
        accounts.find((a) => a.id === newAccountId) ||
        accounts.find((a) => a.channel === newChannel) ||
        accounts[0] || { id: 'acc-wa-1', name: 'CONTA 01' };

      setDispatchGroups((prev) => [
        ...prev,
        {
          id: `grp-${Date.now()}`,
          name: newName.trim(),
          channel: newChannel,
          accountId: matchingAcc.id,
          accountName: matchingAcc.name,
          remoteJid: newRemoteJid.trim() || undefined,
          isChannel: newIsChannel,
          activeForOffers: activeCount < maxLimit,
          membersCount: 1,
          maxCapacity: newChannel === 'Telegram' ? 200000 : newIsChannel ? 5000 : 1024,
          inviteUrl: newInvite.trim(),
          segment: activeSegment,
        },
      ]);
      setNewName('');
      setNewRemoteJid('');
      setAddGroupModal(false);
      notify('Grupo/Canal adicionado!', newName.trim());
    };

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Users className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Grupos de Envio
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={syncingGroups}
              onClick={() => void syncAllConnectedChannels()}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${syncingGroups ? 'animate-spin text-[#15803D]' : ''}`} />
              <span>Sincronizar da API</span>
            </button>
            <button
              type="button"
              onClick={() => setAddGroupModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Grupo / Canal</span>
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
              {dispatchGroups.length}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Total de Grupos / Canais
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center mb-3">
              <Users className="w-5 h-5" />
            </div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
              {activeCount} / {maxLimit}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Grupos Ativos / Limite
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
          >
            <option value="Todos os Status">Todos os Status</option>
            <option value="Enviar Ofertas">Enviar Ofertas</option>
            <option value="Não Enviar Ofertas">Não Enviar Ofertas</option>
          </select>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
          >
            <option value="Todas as Plataformas">Todas as Plataformas</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Telegram">Telegram</option>
          </select>

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
          >
            <option value="Todas as Contas">Todas as Contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={`${a.name} (${a.channel})`}>
                {a.name} ({a.channel})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome do grupo..."
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => notify('Grupos filtrados', `${filtered.length} grupo(s) exibido(s).`, 'info')}
            className="w-full py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
          >
            <Search className="w-4 h-4" />
            <span>Pesquisar</span>
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500">
                  <th className="py-3.5 px-4">Nome do Grupo / Destino API</th>
                  <th className="py-3.5 px-3">App</th>
                  <th className="py-3.5 px-3">Conta</th>
                  <th className="py-3.5 px-3 text-right">Membros</th>
                  <th className="py-3.5 px-4 text-right">Enviar Ofertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 px-6 text-center">
                      <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2.5" />
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                        {dispatchGroups.length === 0
                          ? 'Nenhum grupo puxado ainda'
                          : 'Nenhum grupo corresponde aos filtros'}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                        {accounts.some((a) => a.connected)
                          ? 'Clique em "Sincronizar da API" acima para puxar agora todos os grupos reais existentes no seu WhatsApp conectado.'
                          : 'Conecte seu WhatsApp via QR Code ou Número de Telefone em Canais → WhatsApp para carregar automaticamente seus grupos reais.'}
                      </p>
                      {dispatchGroups.length === 0 && (
                        <div className="mt-3 flex items-center justify-center gap-2">
                          {accounts.some((a) => a.connected) ? (
                            <button
                              type="button"
                              onClick={() => void syncAllConnectedChannels()}
                              className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs font-semibold"
                            >
                              Puxar Meus Grupos Agora
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRoute('whatsapp')}
                              className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-xs font-semibold"
                            >
                              Conectar WhatsApp
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map((g) => (
                    <tr
                      key={g.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                        <div>{g.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {g.isChannel && (
                            <span className="text-xs text-sky-600 dark:text-sky-400 font-medium">
                              Canal
                            </span>
                          )}
                          {g.remoteJid ? (
                            <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                              ID: {g.remoteJid}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Sem JID/Chat ID (sincronize para envio automático)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        {g.channel === 'Telegram' ? (
                          <Send className="w-4 h-4 text-sky-500" />
                        ) : (
                          <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {g.accountName}
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {g.membersCount}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={g.activeForOffers}
                          onClick={() => toggleGroupActive(g)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            g.activeForOffers
                              ? 'bg-[#15803D]'
                              : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              g.activeForOffers ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>{filtered.length} Resultado(s)</span>
            <span>Página 1 de 1</span>
          </div>
        </div>

        {/* Modal Add Group */}
        {addGroupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
            <form
              onSubmit={handleAddDispatchGroup}
              className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4 my-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                  Cadastrar Grupo / Canal de Envio
                </h3>
                <button
                  type="button"
                  onClick={() => setAddGroupModal(false)}
                  className="p-1.5 rounded-lg text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Aplicativo
                    </label>
                    <select
                      value={newChannel}
                      onChange={(e) => {
                        const ch = e.target.value as 'WhatsApp' | 'Telegram';
                        setNewChannel(ch);
                        const matching = accounts.find((a) => a.channel === ch);
                        if (matching) setNewAccountId(matching.id);
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                    >
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="Telegram">Telegram</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Conta Conectada
                    </label>
                    <select
                      value={newAccountId}
                      onChange={(e) => setNewAccountId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                    >
                      {accounts
                        .filter((a) => a.channel === newChannel)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      {accounts.filter((a) => a.channel === newChannel).length === 0 && (
                        <option value="">Padrão ({newChannel})</option>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Nome do Grupo ou Canal *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Meu Grupo de Ofertas"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {newChannel === 'Telegram'
                      ? 'Chat ID ou @username do Canal (para envio via Bot API)'
                      : 'JID do Grupo no WhatsApp (ex: 12036304...@g.us)'}
                  </label>
                  <input
                    type="text"
                    value={newRemoteJid}
                    onChange={(e) => setNewRemoteJid(e.target.value)}
                    placeholder={
                      newChannel === 'Telegram'
                        ? 'Ex: @divulgatudoofertas ou -1001987654321'
                        : 'Ex: 120363192837465@g.us'
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Link de Convite Público (usado na Página de Captura)
                  </label>
                  <input
                    type="url"
                    value={newInvite}
                    onChange={(e) => setNewInvite(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsChannel}
                    onChange={(e) => setNewIsChannel(e.target.checked)}
                    className="w-4 h-4 rounded text-[#15803D]"
                  />
                  <span>É um Canal de Transmissão</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddGroupModal(false)}
                  className="px-4 py-2 rounded-xl text-sm text-slate-600"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-sm font-semibold"
                >
                  Salvar Grupo
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // MONITORAMENTO MODE
  const monitoredCount = monitoringGroups.filter((g) => g.monitored).length;
  const filteredMon = monitoringGroups.filter((g) => {
    if (statusFilter === 'Monitorados' && !g.monitored) return false;
    if (statusFilter === 'Não Monitorados' && g.monitored) return false;
    if (platformFilter !== 'Todas as Plataformas' && g.channel !== platformFilter) {
      return false;
    }
    if (accountFilter !== 'Todas as Contas' && !accountFilter.includes(g.accountName)) {
      return false;
    }
    if (search.trim() && !g.name.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Users className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Grupos de Monitoramento
          </h1>
        </div>
        <button
          type="button"
          disabled={syncingGroups}
          onClick={() => void syncAllConnectedChannels()}
          className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`w-4 h-4 ${syncingGroups ? 'animate-spin text-[#15803D]' : ''}`} />
          <span>Sincronizar</span>
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
            <Users className="w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {monitoringGroups.length}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">Total de Grupos</div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
            <Users className="w-5 h-5" />
          </div>
          <div className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {monitoredCount} / {maxLimit}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">Grupos Monitorados / Limite</div>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todos os Status">Todos os Status</option>
          <option value="Monitorados">Monitorados</option>
          <option value="Não Monitorados">Não Monitorados</option>
        </select>

        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todas as Plataformas">Todas as Plataformas</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="Telegram">Telegram</option>
        </select>

        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
        >
          <option value="Todas as Contas">Todas as Contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.name}>
              {a.name} ({a.channel})
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar por nome do grupo..."
          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
        />
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500">
                <th className="py-3.5 px-4">Nome do Grupo Real</th>
                <th className="py-3.5 px-3">App</th>
                <th className="py-3.5 px-3">Conta</th>
                <th className="py-3.5 px-3 text-right">Links Hoje</th>
                <th className="py-3.5 px-3 text-right">Monitorar</th>
                <th className="py-3.5 px-3 text-right">Config.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {filteredMon.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 px-6 text-center">
                    <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2.5" />
                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                      {monitoringGroups.length === 0
                        ? 'Nenhum grupo de monitoramento sincronizado'
                        : 'Nenhum grupo corresponde aos filtros'}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                      {accounts.some((a) => a.connected)
                        ? 'Clique em "Sincronizar" acima para carregar todos os grupos reais do seu WhatsApp conectado.'
                        : 'Conecte seu WhatsApp em Canais → WhatsApp para listar seus grupos reais aqui.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredMon.map((g) => {
                  const activeMarkets =
                    g.allowedMarketplaces && g.allowedMarketplaces.length > 0
                      ? g.allowedMarketplaces
                      : MONITORING_MARKETPLACES;
                  const marketSummary =
                    activeMarkets.length === MONITORING_MARKETPLACES.length
                      ? 'Todos os marketplaces'
                      : activeMarkets.join(', ');
                  return (
                    <tr key={g.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                        <div>{g.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{marketSummary}</span>
                          {g.useGroupImage && (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                              • Foto do grupo
                            </span>
                          )}
                        </div>
                        {g.remoteJid && (
                          <div className="text-[11px] font-mono text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                            ID: {g.remoteJid}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </td>
                      <td className="py-3.5 px-3 font-mono text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {g.accountName}
                      </td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {g.capturedToday || 0}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={g.monitored}
                          onClick={() => {
                            if (!g.monitored && monitoredCount >= maxLimit) {
                              notify(
                                'Limite atingido',
                                `Máximo de ${maxLimit} grupos monitorados.`,
                                'error'
                              );
                              return;
                            }
                            setMonitoringGroups((prev) =>
                              prev.map((m) =>
                                m.id === g.id ? { ...m, monitored: !m.monitored } : m
                              )
                            );
                            notify('Monitoramento atualizado', g.name);
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            g.monitored ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              g.monitored ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openMonitoringConfigModal(g)}
                          aria-label={`Configurar ${g.name}`}
                          title="Configurar marketplaces e imagem do grupo"
                          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
          <span>{filteredMon.length} Resultado(s)</span>
          <span>Página 1 de 1</span>
        </div>
      </div>

      {/* Modal: Configurar Grupo Monitorado */}
      {editingMonGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
          onClick={() => setEditingMonGroup(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight text-slate-900 dark:text-white">
                    Configurar Grupo Monitorado
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[230px]">
                    {editingMonGroup.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingMonGroup(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 pb-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Card 1: Usar imagem divulgada pelo grupo */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">
                    Usar imagem divulgada pelo grupo?
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={editUseGroupImage}
                    onClick={() => setEditUseGroupImage((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      editUseGroupImage
                        ? 'bg-[#15803D]'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        editUseGroupImage ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Quando ativado, a imagem original coletada deste grupo será utilizada nas
                  suas publicações.
                </p>
                <p className="text-[11px] italic text-slate-500 dark:text-slate-400 leading-relaxed">
                  <strong className="font-semibold not-italic">Atenção:</strong> O BuboFlow
                  não se responsabiliza pelas imagens importadas que contenham marcas d&apos;água
                  ou elementos visuais associados ao grupo monitorado.
                </p>
              </div>

              {/* Card 2: Marketplaces */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                    Marketplaces
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Defina os marketplaces que serão considerados no monitoramento deste grupo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  {MONITORING_MARKETPLACES.map((mp) => {
                    const checked = editMarketplaces.includes(mp);
                    return (
                      <button
                        key={mp}
                        type="button"
                        onClick={() => toggleEditMarketplace(mp)}
                        className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                      >
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                            checked
                              ? 'bg-[#15803D] border-[#15803D] text-white'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </span>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {mp}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingMonGroup(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveMonitoringConfig}
                className="px-5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 4. AGENDAMENTOS & FILAS DE DISPARO (Telas 39–42)
 * ========================================================================== */
export const SchedulesView: React.FC = () => {
  const { schedules, setSchedules, dispatchGroups, dispatchCustomMessage, setRoute, notify } =
    useApp();
  const [filter, setFilter] = useState('Todos');
  const [search, setSearch] = useState('');

  const filtered = schedules.filter((s) => {
    if (filter !== 'Todos' && s.recurrence !== filter) return false;
    if (
      search.trim() &&
      !s.title.toLowerCase().includes(search.trim().toLowerCase()) &&
      !s.message.toLowerCase().includes(search.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Calendar className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Agendamentos
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setRoute('enviar-mensagens')}
          className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Agendar Mensagem</span>
        </button>
      </div>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full sm:w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
      >
        <option value="Todos">Todos</option>
        <option value="Único">Único</option>
        <option value="Recorrente">Recorrente</option>
      </select>

      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por mensagem ou nome..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => notify('Busca atualizada', `${filtered.length} agendamento(s).`, 'info')}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-sm font-semibold flex items-center gap-2 shrink-0"
        >
          <Search className="w-4 h-4" />
          <span>Pesquisar</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-16 px-6 text-center text-sm text-slate-500">
          Nenhum agendamento encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((sch) => (
            <div
              key={sch.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="text-xs text-slate-500 tabular-nums">
                  {sch.recurrence} · Programado para {sch.scheduledAt.replace('T', ' às ')} ·{' '}
                  <strong>{sch.status}</strong>
                </div>
                <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">
                  {sch.title}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mt-1">
                  {sch.message}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {sch.status === 'Pendente' && (
                  <button
                    type="button"
                    onClick={() => {
                      const matched =
                        sch.groupIds.length > 0
                          ? dispatchGroups.filter((g) => sch.groupIds.includes(g.id))
                          : dispatchGroups.filter((g) => g.activeForOffers);
                      if (matched.length === 0) {
                        notify(
                          'Ative um grupo real antes de disparar',
                          'Nenhum grupo conectado ativo encontrado.',
                          'info'
                        );
                        return;
                      }
                      dispatchCustomMessage({
                        title: sch.title,
                        message: sch.message,
                        groupsNames: matched.map((g) => g.name),
                        groupIds: matched.map((g) => g.id),
                        platform: sch.platform,
                      });
                      setSchedules((prev) =>
                        prev.map((item) =>
                          item.id === sch.id ? { ...item, status: 'Enviado' } : item
                        )
                      );
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Disparar agora</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSchedules((prev) => prev.filter((item) => item.id !== sch.id))
                  }
                  className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DispatchQueuesView: React.FC = () => {
  const { queues, setQueues, products, dispatchOfferNow, activeSegment, notify } = useApp();
  const [statusFilter, setStatusFilter] = useState('Todos os status');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [manageQueue, setManageQueue] = useState<DispatchQueue | null>(null);

  const [newQueueName, setNewQueueName] = useState('');
  const [newQueueInterval, setNewQueueInterval] = useState('15');

  const filtered = queues.filter((q) => {
    if (statusFilter === 'Ativa' && !q.active) return false;
    if (statusFilter === 'Pausada' && q.active) return false;
    if (search.trim() && !q.name.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const handleCreateQueue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQueueName.trim()) return;
    const item: DispatchQueue = {
      id: `q-${Date.now()}`,
      name: newQueueName.trim(),
      sentCount: 0,
      totalCount: 0,
      active: true,
      productIds: [],
      intervalMinutes: Math.max(1, parseInt(newQueueInterval, 10) || 15),
      segment: activeSegment,
    };
    setQueues((prev) => [item, ...prev]);
    setNewQueueName('');
    setCreateOpen(false);
    notify('Fila criada!', item.name);
  };

  const triggerNextFromQueue = (q: DispatchQueue) => {
    if (q.productIds.length === 0 || q.sentCount >= q.totalCount) {
      notify('Fila vazia ou concluída', 'Adicione produtos clicando no ícone de caixa.', 'info');
      return;
    }
    const nextProdId = q.productIds[q.sentCount];
    const prod = products.find((p) => p.id === nextProdId) || products[0];
    if (prod) {
      dispatchOfferNow(prod, [q.segment]);
      setQueues((prev) =>
        prev.map((item) =>
          item.id === q.id
            ? { ...item, sentCount: Math.min(item.totalCount, item.sentCount + 1) }
            : item
        )
      );
      notify('Próximo item disparado!', prod.title);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <ListOrdered className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Filas de disparo
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Organize seus produtos em filas e programe o disparo automático.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          title="Nova Fila"
          className="w-11 h-11 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white flex items-center justify-center shrink-0 shadow-xs"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="w-full sm:w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-sm"
      >
        <option value="Todos os status">Todos os status</option>
        <option value="Ativa">Ativa</option>
        <option value="Pausada">Pausada</option>
      </select>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => notify('Filas atualizadas')}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] text-white text-sm font-semibold flex items-center gap-2 shrink-0"
        >
          <Search className="w-4 h-4" />
          <span>Pesquisar</span>
        </button>
      </div>

      {/* Queues Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500">
                <th className="py-3.5 px-4">Nome</th>
                <th className="py-3.5 px-4">Envios</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {filtered.map((q) => {
                const pct =
                  q.totalCount === 0
                    ? 0
                    : Math.round((q.sentCount / q.totalCount) * 100);
                return (
                  <tr key={q.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                      {q.name}
                    </td>
                    <td className="py-3.5 px-4 tabular-nums">
                      <div className="text-xs">
                        <strong className="text-[#15803D] dark:text-emerald-400">
                          {q.sentCount}
                        </strong>{' '}
                        de {q.totalCount} envios
                      </div>
                      <div className="mt-1.5 w-28 h-1.5 rounded-full bg-emerald-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${pct}%` }}
                          className="h-full bg-[#15803D] transition-all"
                        />
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={q.active}
                        onClick={() =>
                          setQueues((prev) =>
                            prev.map((item) =>
                              item.id === q.id ? { ...item, active: !item.active } : item
                            )
                          )
                        }
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          q.active ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            q.active ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setManageQueue(q)}
                          title="Gerenciar produtos da fila"
                          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Package className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerNextFromQueue(q)}
                          title="Disparar próximo item agora"
                          className="p-2 rounded-lg text-[#15803D] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQueues((prev) => prev.filter((item) => item.id !== q.id))
                          }
                          title="Excluir fila"
                          className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
          <span>{filtered.length} Resultado(s)</span>
          <span>Página 1 de 1</span>
        </div>
      </div>

      {/* Modal Create Queue */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateQueue}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Nova Fila de Disparo</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 rounded-lg text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Nome da Fila *
                </label>
                <input
                  type="text"
                  required
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  placeholder="Ex: Esquenta 11.11 Shopee"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Intervalo entre envios (minutos)
                </label>
                <input
                  type="number"
                  min={1}
                  value={newQueueInterval}
                  onChange={(e) => setNewQueueInterval(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-sm font-semibold"
              >
                Criar Fila
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Manage Queue Products */}
      {manageQueue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">
                Produtos na fila: {manageQueue.name}
              </h3>
              <button
                type="button"
                onClick={() => setManageQueue(null)}
                className="p-1.5 rounded-lg text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {products.map((p) => {
                const currentQueue =
                  queues.find((item) => item.id === manageQueue.id) || manageQueue;
                const included = currentQueue.productIds.includes(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {p.title}
                      </div>
                      <div className="text-slate-500">{p.platform}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQueues((prev) =>
                          prev.map((qItem) => {
                            if (qItem.id !== manageQueue.id) return qItem;
                            const nextIds = included
                              ? qItem.productIds.filter((id) => id !== p.id)
                              : [...qItem.productIds, p.id];
                            return {
                              ...qItem,
                              productIds: nextIds,
                              totalCount: nextIds.length,
                              sentCount: Math.min(qItem.sentCount, nextIds.length),
                            };
                          })
                        );
                      }}
                      className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 ${
                        included
                          ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40'
                          : 'bg-emerald-50 text-[#15803D] dark:bg-emerald-950/60 dark:text-emerald-400'
                      }`}
                    >
                      {included ? 'Remover' : '+ Incluir'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setManageQueue(null)}
                className="px-4 py-2 rounded-xl bg-[#15803D] text-white text-sm font-semibold"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
