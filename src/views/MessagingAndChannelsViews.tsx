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
  AlertTriangle,
  RotateCcw,
  AtSign,
  Repeat,
  Clock,
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
  resolveTelegramChatsApi,
  runDispatchQueueNextApi,
  sendTelegramApi,
  sendWhatsAppApi,
  verifyTelegramBotApi,
} from '../utils/apiClient';
import {
  getGroupActiveSegments,
  getGroupMonitoredSegments,
  isGroupActiveInSegment,
  isGroupMonitoredInSegment,
  matchesSegment,
  normalizeSegmentName,
  toggleGroupSegmentMembership,
} from '../utils/segmentScoping';
import {
  getGroupAllMatchKeys,
  mergeTelegramResolvedChats,
  parseTelegramTargetList,
  type ResolvedTelegramChat,
  type TelegramTargetFailure,
} from '../utils/telegramSync';

/* ============================================================================
 * 1. WHATSAPP & TELEGRAM ACCOUNTS VIEW (Telas 6–7 + Conexão Real QR/Bot API)
 * ========================================================================== */
export const ChannelAccountsView: React.FC<{ channel: 'WhatsApp' | 'Telegram' }> = ({
  channel,
}) => {
  const {
    accounts,
    setAccounts,
    whatsappRotationEnabled,
    setWhatsappRotationEnabled,
    dispatchGroups,
    setDispatchGroups,
    setMonitoringGroups,
    excludedDispatchGroupKeys,
    unexcludeDispatchGroupKeys,
    syncWhatsAppGroupsFromAccount,
    activeSegment,
    notify,
  } = useApp();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAcc, setEditingAcc] = useState<ChannelAccount | null>(null);
  const [pendingDeleteAcc, setPendingDeleteAcc] = useState<ChannelAccount | null>(null);
  const [deletingAccBusy, setDeletingAccBusy] = useState(false);
  const [pendingDisconnectAcc, setPendingDisconnectAcc] = useState<ChannelAccount | null>(null);
  const [disconnectingAccBusy, setDisconnectingAccBusy] = useState(false);

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
  const [tgSyncDiagByAcc, setTgSyncDiagByAcc] = useState<
    Record<
      string,
      {
        webhookActive?: boolean;
        webhookHost?: string;
        updatesConflict?: boolean;
        syncNote?: string;
        validatedCount?: number;
      }
    >
  >({});
  const [tgImportAcc, setTgImportAcc] = useState<ChannelAccount | null>(null);
  const [tgImportInput, setTgImportInput] = useState('');
  const [tgImportResult, setTgImportResult] = useState<{
    resolved: ResolvedTelegramChat[];
    failed: TelegramTargetFailure[];
    syncNote?: string;
  } | null>(null);
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

  const getKnownTelegramChatIds = (accId?: string): string[] => {
    const ids: string[] = [];
    for (const g of dispatchGroups) {
      if (g.channel !== 'Telegram') continue;
      if (accId && g.accountId !== accId) continue;
      if (g.remoteJid?.trim()) ids.push(g.remoteJid.trim());
      if (g.username?.trim()) ids.push(`@${g.username.trim().replace(/^@/, '')}`);
    }
    return Array.from(new Set(ids));
  };

  const applyResolvedTelegramChats = (
    accId: string,
    accLabel: string,
    chats: ResolvedTelegramChat[],
    options?: { forceInclude?: boolean }
  ) => {
    if (chats.length === 0) {
      return { addedCount: 0, updatedCount: 0, mergedDuplicatesCount: 0 };
    }

    const forceKeys = new Set<string>();
    if (options?.forceInclude) {
      for (const ch of chats) {
        for (const k of getGroupAllMatchKeys({
          channel: 'Telegram',
          remoteJid: ch.id,
          username: ch.username,
          inviteUrl: ch.inviteUrl,
        })) {
          forceKeys.add(k);
        }
      }
      if (forceKeys.size > 0) {
        unexcludeDispatchGroupKeys(Array.from(forceKeys));
      }
    }

    const excludedSet = new Set(excludedDispatchGroupKeys || []);
    let summary = { addedCount: 0, updatedCount: 0, mergedDuplicatesCount: 0 };
    setDispatchGroups((prev) => {
      const merged = mergeTelegramResolvedChats({
        existing: prev,
        resolvedChats: chats,
        accountId: accId,
        accountName: accLabel,
        defaultSegment: activeSegment,
        excludedKeys: options?.forceInclude ? undefined : excludedSet,
        forceIncludeKeys: forceKeys.size > 0 ? forceKeys : undefined,
        autoActivateIfUnderLimit: 5,
      });
      summary = {
        addedCount: merged.addedCount,
        updatedCount: merged.updatedCount,
        mergedDuplicatesCount: merged.mergedDuplicatesCount,
      };
      return merged.groups;
    });
    return summary;
  };

  const handleVerifyTelegramInModal = async () => {
    if (!accToken.trim()) {
      notify('Informe o Bot Token', 'Crie ou copie seu token no @BotFather do Telegram.', 'error');
      return;
    }
    setBusyAction('verify-tg');
    try {
      const parsedTargets = parseTelegramTargetList(defaultTargetId);
      const knownIds = editingAcc ? getKnownTelegramChatIds(editingAcc.id) : [];
      const res = await verifyTelegramBotApi(accToken.trim(), {
        knownChatIds: knownIds,
        targetInputs: parsedTargets.valid,
      });
      if (!res.ok || !res.bot) {
        notify('Falha ao conectar Bot', res.error || 'Token inválido.', 'error');
        return;
      }
      setAccPhone(res.bot.username);
      if (!accName.trim() || accName.startsWith('BOT TELEGRAM')) {
        setAccName(res.bot.name || res.bot.username);
      }

      const targetAccId = editingAcc?.id || `acc-tg-${Date.now()}`;
      const chats = res.discoveredChats || [];
      const merged = applyResolvedTelegramChats(
        targetAccId,
        res.bot.name || accName || res.bot.username,
        chats,
        { forceInclude: parsedTargets.valid.length > 0 }
      );

      setTgSyncDiagByAcc((prev) => ({
        ...prev,
        [targetAccId]: {
          webhookActive: res.webhookActive,
          webhookHost: res.webhookHost,
          updatesConflict: res.updatesConflict,
          syncNote: res.syncNote,
          validatedCount: chats.length,
        },
      }));

      const failCount = (res.failedTargets?.length || 0) + parsedTargets.invalid.length;
      notify(
        `Bot ${res.bot.username} autenticado!`,
        merged.addedCount > 0
          ? `${merged.addedCount} canal(is)/grupo(s) importado(s) e validado(s) pela API oficial.${failCount > 0 ? ` ${failCount} não encontrado(s).` : ''}`
          : chats.length > 0
          ? `${chats.length} canal(is)/grupo(s) validado(s) com dados reais.${merged.mergedDuplicatesCount > 0 ? ` ${merged.mergedDuplicatesCount} duplicado(s) unificado(s).` : ''}`
          : res.webhookActive
          ? 'Webhook externo detectado e mantido intacto. Use "Importar Canais por @" para adicionar seus canais.'
          : 'Nenhum canal novo nos eventos recentes. Informe os @canais no campo abaixo ou use "Importar Canais por @".'
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
        const parsedTargets = parseTelegramTargetList(defaultTargetId);
        const knownIds = editingAcc ? getKnownTelegramChatIds(editingAcc.id) : [];
        const check = await verifyTelegramBotApi(accToken.trim(), {
          knownChatIds: knownIds,
          targetInputs: parsedTargets.valid,
        });
        if (check.ok && check.bot) {
          resolvedHandle = check.bot.username;
          applyResolvedTelegramChats(
            targetId,
            accName.trim(),
            check.discoveredChats || [],
            { forceInclude: parsedTargets.valid.length > 0 }
          );
          setTgSyncDiagByAcc((prev) => ({
            ...prev,
            [targetId]: {
              webhookActive: check.webhookActive,
              webhookHost: check.webhookHost,
              updatesConflict: check.updatesConflict,
              syncNote: check.syncNote,
              validatedCount: check.discoveredChats?.length || 0,
            },
          }));
        }
      } catch {
        // Save anyway
      }
    }

    const isBaileys = channel === 'WhatsApp' && accProvider === 'baileys';

    const payload: ChannelAccount = {
      id: targetId,
      name: accName.trim(),
      channel,
      phoneOrHandle: resolvedHandle,
      connected: isBaileys ? Boolean(editingAcc?.connected) : true,
      activeForDispatch: editingAcc?.activeForDispatch ?? true,
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

  const handleToggleDispatchActive = (acc: ChannelAccount) => {
    const nextActive = acc.activeForDispatch === false;
    setAccounts((prev) =>
      prev.map((a) => (a.id === acc.id ? { ...a, activeForDispatch: nextActive } : a))
    );
    notify(
      nextActive ? 'WhatsApp ativado para envios' : 'WhatsApp desativado para envios',
      nextActive
        ? `"${acc.name}" agora pode enviar ofertas (manuais, automáticas e agendadas).`
        : `"${acc.name}" permanece conectado, mas não enviará ofertas até ser reativado.`,
      nextActive ? 'success' : 'info'
    );
  };

  const handleBatchImportTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tgImportAcc?.apiToken) {
      notify('Bot sem token', 'Configure o Bot Token do @BotFather primeiro.', 'error');
      return;
    }
    const parsed = parseTelegramTargetList(tgImportInput);
    if (parsed.valid.length === 0 && parsed.invalid.length === 0) {
      notify(
        'Informe ao menos um canal',
        'Digite um ou mais @canais, links t.me/canal ou IDs -100...',
        'info'
      );
      return;
    }

    setBusyAction('import-tg-batch');
    try {
      const localInvalid: TelegramTargetFailure[] = parsed.invalid.map((raw) => ({
        input: raw,
        reason: /t\.me\/(\+|joinchat)/i.test(raw)
          ? 'Link de convite privado (t.me/+...) não é aceito pela Bot API. Use @usuario ou ID -100...'
          : 'Formato inválido. Use @usuario, https://t.me/usuario ou -100...',
      }));

      if (parsed.valid.length === 0) {
        setTgImportResult({ resolved: [], failed: localInvalid });
        return;
      }

      const res = await resolveTelegramChatsApi(tgImportAcc.apiToken, parsed.valid);
      if (!res.ok) {
        notify('Erro ao validar canais', res.error || 'Não foi possível consultar a API do Telegram.', 'error');
        return;
      }

      const resolved = res.discoveredChats || [];
      const failed = [...localInvalid, ...(res.failedTargets || [])];

      if (resolved.length > 0) {
        const summary = applyResolvedTelegramChats(tgImportAcc.id, tgImportAcc.name, resolved, {
          forceInclude: true,
        });
        notify(
          `${resolved.length} canal(is) validado(s) no Telegram!`,
          summary.addedCount > 0
            ? `${summary.addedCount} novo(s) adicionado(s) em Grupos de Envio${summary.mergedDuplicatesCount > 0 ? ` e ${summary.mergedDuplicatesCount} duplicado(s) unificado(s)` : ''}.`
            : `Dados, permissões e inscritos atualizados em Grupos de Envio.`
        );
      } else if (failed.length > 0) {
        notify(
          'Nenhum canal válido encontrado',
          'Verifique os detalhes abaixo para corrigir o @usuario ou as permissões do bot.',
          'error'
        );
      }

      setTgSyncDiagByAcc((prev) => ({
        ...prev,
        [tgImportAcc.id]: {
          webhookActive: res.webhookActive,
          webhookHost: res.webhookHost,
          updatesConflict: res.updatesConflict,
          syncNote: res.syncNote,
          validatedCount: resolved.length,
        },
      }));
      setTgImportResult({ resolved, failed, syncNote: res.syncNote });
    } catch {
      notify('Erro de rede ao consultar Telegram', undefined, 'error');
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
        const knownIds = getKnownTelegramChatIds(acc.id);
        const res = await verifyTelegramBotApi(acc.apiToken, { knownChatIds: knownIds });
        if (res.ok && res.bot) {
          const chats = res.discoveredChats || [];
          const summary = applyResolvedTelegramChats(acc.id, acc.name, chats);
          setTgSyncDiagByAcc((prev) => ({
            ...prev,
            [acc.id]: {
              webhookActive: res.webhookActive,
              webhookHost: res.webhookHost,
              updatesConflict: res.updatesConflict,
              syncNote: res.syncNote,
              validatedCount: chats.length,
            },
          }));
          notify(
            `Telegram sincronizado (${res.bot.username})`,
            chats.length > 0
              ? `${chats.length} canal(is) validado(s) (${summary.addedCount} novo(s)${summary.mergedDuplicatesCount > 0 ? `, ${summary.mergedDuplicatesCount} duplicado(s) unificado(s)` : ''}).`
              : res.webhookActive
              ? 'Webhook externo preservado. Clique em "Importar Canais por @" para adicionar seus canais.'
              : 'Nenhum canal novo em eventos recentes. Use "Importar Canais por @" para cadastrar e validar seus canais.',
            chats.length > 0 ? 'success' : 'info'
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
          allowInactiveAccount: true,
        });
        if (res.ok) {
          notify(
            'Mensagem enviada no WhatsApp!',
            acc.activeForDispatch === false
              ? `Entregue em ${linkedGroups[0].name}. Obs.: este número está desativado para envio de ofertas.`
              : `Entregue em ${linkedGroups[0].name}.`
          );
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
            Conecte seu <strong>Bot do Telegram (@BotFather)</strong> para disparar ofertas com foto e
            formatação HTML pela API oficial. Como o Telegram não possui um comando que liste todos os
            canais antigos automaticamente (e protege webhooks de outras automações), use{' '}
            <strong>Importar Canais por @</strong> para validar e puxar todos os seus canais de uma vez.
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

      {/* WhatsApp Automatic Account Rotation Bar */}
      {channel === 'WhatsApp' && (() => {
        const activeConnectedWaCount = accounts.filter(
          (a) => a.channel === 'WhatsApp' && a.connected && a.activeForDispatch !== false
        ).length;
        return (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Repeat className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-slate-900 dark:text-white">
                    Rodízio automático entre números
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    · {activeConnectedWaCount} número(s) ativo(s) conectado(s)
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {whatsappRotationEnabled
                    ? activeConnectedWaCount >= 2
                      ? 'Alternando automaticamente cada disparo entre os números conectados e ativos para envios.'
                      : 'Ativado · conecte e mantenha 2 ou mais números ativos para alternar os disparos.'
                    : 'Quando ativado, alterna cada oferta entre todos os números conectados e liberados para envio (manuais, filas e disparo automático).'}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={whatsappRotationEnabled}
              aria-label="Alternar rodízio automático entre números de WhatsApp"
              onClick={() => {
                const next = !whatsappRotationEnabled;
                setWhatsappRotationEnabled(next);
                notify(
                  next
                    ? 'Rodízio automático ativado!'
                    : 'Rodízio automático desativado',
                  next
                    ? 'Os próximos envios alternarão entre todos os números de WhatsApp conectados e ativos.'
                    : 'Cada grupo voltará a usar preferencialmente seu número vinculado.'
                );
              }}
              className="inline-flex items-center gap-2 min-h-[40px] px-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] shrink-0 self-end sm:self-center"
            >
              <span
                className={`text-xs font-semibold whitespace-nowrap ${
                  whatsappRotationEnabled
                    ? 'text-[#15803D] dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {whatsappRotationEnabled ? 'Ativado' : 'Desativado'}
              </span>
              <span
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  whatsappRotationEnabled
                    ? 'bg-[#15803D] dark:bg-emerald-600'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                    whatsappRotationEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          </div>
        );
      })()}

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
                  {channel === 'Telegram' && (() => {
                    const diag = tgSyncDiagByAcc[acc.id];
                    const linkedCount = dispatchGroups.filter(
                      (g) => g.channel === 'Telegram' && g.accountId === acc.id
                    ).length;
                    return (
                      <div className="mt-2 space-y-1.5">
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {linkedCount} canal(is)/grupo(s) vinculado(s) em Grupos de Envio
                        </div>
                        {diag?.syncNote && (
                          <div className="rounded-xl border border-amber-200/80 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <span>{diag.syncNote}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {channel === 'WhatsApp' && (() => {
                const isDispatchActive = acc.activeForDispatch !== false;
                return (
                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        Envio de ofertas
                      </div>
                      <div
                        className={`text-xs mt-0.5 ${
                          isDispatchActive
                            ? 'text-[#15803D] dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {isDispatchActive
                          ? 'Ativo · liberado para enviar ofertas'
                          : 'Desativado · pausado para envios'}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isDispatchActive}
                      aria-label={`Alternar envio de ofertas para ${acc.name}`}
                      onClick={() => handleToggleDispatchActive(acc)}
                      className="inline-flex items-center gap-2 min-h-[40px] px-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] shrink-0"
                    >
                      <span
                        className={`text-xs font-semibold whitespace-nowrap ${
                          isDispatchActive
                            ? 'text-[#15803D] dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {isDispatchActive ? 'Ativo' : 'Inativo'}
                      </span>
                      <span
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isDispatchActive
                            ? 'bg-[#15803D] dark:bg-emerald-600'
                            : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                            isDispatchActive ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                );
              })()}

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

                  {channel === 'Telegram' && (
                    <button
                      type="button"
                      onClick={() => {
                        setTgImportAcc(acc);
                        setTgImportInput('');
                        setTgImportResult(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <AtSign className="w-3.5 h-3.5" />
                      <span>Importar Canais por @</span>
                    </button>
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
                      onClick={() => setPendingDisconnectAcc(acc)}
                      aria-label={`Desconectar sessão ${acc.name}`}
                      title="Desconectar sessão WhatsApp"
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
                    onClick={() => setPendingDeleteAcc(acc)}
                    aria-label={`Remover conta ${acc.name}`}
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
                      Canais / Chat IDs para validar (opcional — um por linha ou separados por vírgula)
                    </label>
                    <textarea
                      rows={3}
                      value={defaultTargetId}
                      onChange={(e) => setDefaultTargetId(e.target.value)}
                      placeholder={'@divulgatudoofertas\n@meusegundocanal\n@meuterceirocanal'}
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
                    <span>Verificar Bot & Validar Canais</span>
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

      {/* Batch Import Telegram Channels by @ Modal */}
      {tgImportAcc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
          onClick={() => setTgImportAcc(null)}
        >
          <form
            onSubmit={handleBatchImportTelegram}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4 my-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                  Importar Canais do Telegram por @
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Bot <span className="font-mono">{tgImportAcc.phoneOrHandle || tgImportAcc.name}</span> · Validação direta via API oficial (seguro para bots compartilhados com webhook).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTgImportAcc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Cole os @canais, links t.me/canal ou IDs -100... (um por linha ou separados por vírgula)
              </label>
              <textarea
                rows={4}
                value={tgImportInput}
                onChange={(e) => setTgImportInput(e.target.value)}
                placeholder={'@divulgatudoofertas\n@achadosofertas\nhttps://t.me/meuterceirocanal'}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                Para cada canal informado, o sistema consulta o título oficial, converte para o ID permanente (<span className="font-mono">-100...</span>), busca o número real de inscritos e verifica se o bot tem permissão para postar.
              </p>
            </div>

            {tgImportResult && (
              <div className="space-y-2.5 max-h-60 overflow-y-auto border-t border-slate-100 dark:border-slate-800 pt-3">
                {tgImportResult.resolved.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Validados e importados ({tgImportResult.resolved.length})
                    </div>
                    {tgImportResult.resolved.map((ch) => (
                      <div
                        key={ch.id}
                        className="rounded-xl border border-slate-200/80 dark:border-slate-800 px-3 py-2 text-xs flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {ch.title}
                          </span>
                          <span
                            className={`font-semibold shrink-0 ${
                              ch.canPostMessages
                                ? 'text-[#15803D] dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {ch.statusLabel}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {ch.username && <span>@{ch.username}</span>}
                          <span>·</span>
                          <span>ID: {ch.id}</span>
                          <span>·</span>
                          <span>{ch.membersCount} inscrito(s)</span>
                        </div>
                        {ch.warningReason && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                            {ch.warningReason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {tgImportResult.failed.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                      Não encontrados / com erro ({tgImportResult.failed.length})
                    </div>
                    {tgImportResult.failed.map((f, idx) => (
                      <div
                        key={`${f.input}-${idx}`}
                        className="rounded-xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 px-3 py-2 text-xs"
                      >
                        <div className="font-mono font-semibold text-rose-800 dark:text-rose-300">
                          {f.input}
                        </div>
                        <div className="text-[11px] text-rose-700 dark:text-rose-300/90 mt-0.5">
                          {f.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTgImportAcc(null)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Fechar
              </button>
              <button
                type="submit"
                disabled={busyAction === 'import-tg-batch'}
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
              >
                {busyAction === 'import-tg-batch' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>Validar e Importar</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Confirmação de Exclusão de Conta */}
      {pendingDeleteAcc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => {
            if (!deletingAccBusy) setPendingDeleteAcc(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="delete-account-modal-title"
                  className="font-bold text-base text-slate-900 dark:text-white"
                >
                  Excluir conta conectada?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Tem certeza que deseja remover a conta{' '}
                  <strong className="text-slate-800 dark:text-slate-100">
                    {pendingDeleteAcc.name}
                  </strong>{' '}
                  ({pendingDeleteAcc.channel})? Os grupos e canais vinculados a ela também serão
                  removidos da lista.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={deletingAccBusy}
                onClick={() => setPendingDeleteAcc(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingAccBusy}
                onClick={() => {
                  const target = pendingDeleteAcc;
                  if (!target) return;
                  setDeletingAccBusy(true);
                  void (async () => {
                    try {
                      const targetWaProvider = target.provider || 'baileys';
                      if (channel === 'WhatsApp' && targetWaProvider === 'baileys') {
                        await logoutBaileysApi(target.id);
                      }
                      setAccounts((prev) => prev.filter((a) => a.id !== target.id));
                      setDispatchGroups((prev) => prev.filter((g) => g.accountId !== target.id));
                      setMonitoringGroups((prev) =>
                        prev.filter((m) => m.accountId !== target.id)
                      );
                      if (channel === 'WhatsApp') {
                        void syncWhatsAppGroupsFromAccount(undefined, { silent: true });
                      }
                      notify('Conta removida', target.name, 'info');
                    } finally {
                      setDeletingAccBusy(false);
                      setPendingDeleteAcc(null);
                    }
                  })();
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {deletingAccBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Sim, excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmação de Desconexão de Sessão WhatsApp */}
      {pendingDisconnectAcc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="disconnect-account-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={() => {
            if (!disconnectingAccBusy) setPendingDisconnectAcc(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="disconnect-account-modal-title"
                  className="font-bold text-base text-slate-900 dark:text-white"
                >
                  Desconectar sessão do WhatsApp?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Tem certeza que deseja desconectar{' '}
                  <strong className="text-slate-800 dark:text-slate-100">
                    {pendingDisconnectAcc.name}
                  </strong>{' '}
                  ({pendingDisconnectAcc.phoneOrHandle})? Para voltar a usar este número será
                  necessário ler o QR Code ou parear novamente.
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  Dica: se quiser apenas pausar os envios sem perder a conexão, desligue o botão{' '}
                  <strong className="text-slate-700 dark:text-slate-200">Envio de ofertas</strong>{' '}
                  no card da conta.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={disconnectingAccBusy}
                onClick={() => setPendingDisconnectAcc(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={disconnectingAccBusy}
                onClick={() => {
                  const target = pendingDisconnectAcc;
                  if (!target) return;
                  setDisconnectingAccBusy(true);
                  void (async () => {
                    try {
                      await handleLogoutBaileys(target);
                    } finally {
                      setDisconnectingAccBusy(false);
                      setPendingDisconnectAcc(null);
                    }
                  })();
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {disconnectingAccBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Sim, desconectar</span>
              </button>
            </div>
          </div>
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
    activeSegment,
    getTemplateForPlatform,
    dispatchCustomMessage,
    setSchedules,
    notify,
  } = useApp();

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(() =>
    dispatchGroups.filter((g) => isGroupActiveInSegment(g, activeSegment)).map((g) => g.id)
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
    setSelectedGroupIds(
      dispatchGroups.filter((g) => isGroupActiveInSegment(g, activeSegment)).map((g) => g.id)
    );
  }, [activeSegment]);

  React.useEffect(() => {
    setSelectedGroupIds((prev) => {
      const valid = prev.filter((id) => dispatchGroups.some((g) => g.id === id));
      if (valid.length > 0) return valid;
      return dispatchGroups
        .filter((g) => isGroupActiveInSegment(g, activeSegment))
        .map((g) => g.id);
    });
  }, [dispatchGroups, activeSegment]);

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
          segment: normalizeSegmentName(activeSegment),
        },
        ...prev,
      ]);
      notify('Mensagem agendada!', `Disponível na aba Agendamentos (${activeSegment}).`);
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
        segment: activeSegment,
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
    excludedDispatchGroupKeys,
    excludedMonitoringGroupKeys,
    removeDispatchGroup,
    removeMonitoringGroup,
    restoreExcludedDispatchGroups,
    restoreExcludedMonitoringGroups,
    unexcludeDispatchGroupKeys,
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
  const [addGroupBusy, setAddGroupBusy] = useState(false);
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [syncingGroups, setSyncingGroups] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<
    | { kind: 'envio'; group: DispatchGroup }
    | { kind: 'monitoramento'; group: MonitoringGroup }
    | null
  >(null);

  const renderDeleteGroupConfirmModal = () => {
    if (!pendingDeleteGroup) return null;
    const grp = pendingDeleteGroup.group;
    const isChannelItem =
      pendingDeleteGroup.kind === 'envio' && Boolean(pendingDeleteGroup.group.isChannel);
    const kindLabel = isChannelItem ? 'canal' : 'grupo';

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-group-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        onClick={() => setPendingDeleteGroup(null)}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                id="delete-group-modal-title"
                className="font-bold text-base text-slate-900 dark:text-white"
              >
                Excluir grupo ou canal?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Tem certeza que deseja excluir o {kindLabel}{' '}
                <strong className="text-slate-800 dark:text-slate-100">{grp.name}</strong> (
                {grp.channel}) da lista de{' '}
                {pendingDeleteGroup.kind === 'envio' ? 'envio' : 'monitoramento'}?
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                Ele não voltará automaticamente ao sincronizar. Se precisar dele depois, basta
                clicar em <strong>Restaurar excluídos</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setPendingDeleteGroup(null)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (pendingDeleteGroup.kind === 'envio') {
                  removeDispatchGroup(pendingDeleteGroup.group);
                } else {
                  removeMonitoringGroup(pendingDeleteGroup.group);
                }
                setPendingDeleteGroup(null);
              }}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
            >
              Sim, excluir
            </button>
          </div>
        </div>
      </div>
    );
  };

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
    let tgSharedWebhookDetected = false;
    try {
      const waResult = await syncWhatsAppGroupsFromAccount(undefined, { silent: true });
      if (waResult.ok) {
        totalFound += waResult.count;
      }

      const excludedSet = new Set(excludedDispatchGroupKeys || []);
      for (const acc of accounts) {
        if (!acc.connected) continue;
        if (acc.channel === 'Telegram' && acc.apiToken) {
          const knownIds = Array.from(
            new Set(
              dispatchGroups
                .filter((g) => g.channel === 'Telegram' && g.accountId === acc.id)
                .flatMap((g) => [
                  g.remoteJid?.trim() || '',
                  g.username?.trim() ? `@${g.username.trim().replace(/^@/, '')}` : '',
                ])
                .filter(Boolean)
            )
          );
          const tgRes = await verifyTelegramBotApi(acc.apiToken, { knownChatIds: knownIds });
          if (tgRes.webhookActive || tgRes.updatesConflict) {
            tgSharedWebhookDetected = true;
          }
          if (tgRes.ok && tgRes.discoveredChats?.length) {
            totalFound += tgRes.discoveredChats.length;
            setDispatchGroups((prev) =>
              mergeTelegramResolvedChats({
                existing: prev,
                resolvedChats: tgRes.discoveredChats!,
                accountId: acc.id,
                accountName: acc.name,
                defaultSegment: activeSegment,
                excludedKeys: excludedSet,
              }).groups
            );
          }
        }
      }

      if (totalFound > 0) {
        notify(
          'Grupos reais sincronizados!',
          tgSharedWebhookDetected
            ? `${totalFound} grupo(s)/canal(is) atualizados. Para novos canais do Telegram em bot compartilhado, use "Canais → Telegram → Importar Canais por @".`
            : `${totalFound} grupo(s)/canal(is) puxados e validados diretamente da sua conta conectada.`
        );
      } else {
        notify(
          'Nenhum grupo encontrado na sessão atual',
          tgSharedWebhookDetected
            ? 'Bot do Telegram com webhook externo detectado. Vá em Canais → Telegram e clique em "Importar Canais por @".'
            : 'Verifique se o seu WhatsApp ou Telegram está conectado em Canais.',
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
    const activeCount = dispatchGroups.filter((g) =>
      isGroupActiveInSegment(g, activeSegment)
    ).length;
    const filtered = dispatchGroups.filter((g) => {
      const activeHere = isGroupActiveInSegment(g, activeSegment);
      if (statusFilter === 'Enviar Ofertas' && !activeHere) return false;
      if (statusFilter === 'Não Enviar Ofertas' && activeHere) return false;
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
      const currentlyActive = isGroupActiveInSegment(group, activeSegment);
      if (!currentlyActive && activeCount >= maxLimit) {
        notify('Limite atingido', `Máximo de ${maxLimit} grupos ativos simultâneos.`, 'error');
        return;
      }
      setDispatchGroups((prev) =>
        prev.map((g) => {
          if (g.id !== group.id) return g;
          const nextSegs = toggleGroupSegmentMembership(
            getGroupActiveSegments(g),
            activeSegment,
            !currentlyActive
          );
          return {
            ...g,
            activeSegments: nextSegs,
            activeForOffers: nextSegs.length > 0,
            segment: nextSegs[0] || g.segment || activeSegment,
          };
        })
      );
      notify(
        !currentlyActive
          ? `Envio ativado em "${activeSegment}"`
          : `Envio pausado em "${activeSegment}"`,
        group.name
      );
    };

    const handleAddDispatchGroup = async (e: React.FormEvent) => {
      e.preventDefault();
      setAddGroupError(null);
      const matchingAcc =
        accounts.find((a) => a.id === newAccountId) ||
        accounts.find((a) => a.channel === newChannel) ||
        accounts[0] || { id: 'acc-wa-1', name: 'CONTA 01' };

      const seg = normalizeSegmentName(activeSegment);

      // When adding a Telegram channel/group with a connected bot token, validate via Bot API first
      if (newChannel === 'Telegram' && 'apiToken' in matchingAcc && matchingAcc.apiToken?.trim()) {
        const parsed = parseTelegramTargetList(newRemoteJid);
        if (parsed.valid.length === 0) {
          setAddGroupError(
            'Informe um @canal válido (ex: @divulgatudoofertas), link https://t.me/canal ou Chat ID -100...'
          );
          return;
        }
        setAddGroupBusy(true);
        try {
          const res = await resolveTelegramChatsApi(matchingAcc.apiToken.trim(), parsed.valid);
          if (!res.ok) {
            setAddGroupError(res.error || 'Falha ao consultar a API do Telegram.');
            return;
          }
          const resolved = res.discoveredChats || [];
          if (resolved.length === 0) {
            setAddGroupError(
              res.failedTargets?.[0]?.reason ||
                'Canal não encontrado no Telegram. Confira o @usuario ou adicione o bot como administrador.'
            );
            return;
          }

          const customTitle = newName.trim();
          const finalChats: ResolvedTelegramChat[] = resolved.map((ch, i) => ({
            ...ch,
            title: i === 0 && customTitle ? customTitle : ch.title,
            inviteUrl:
              i === 0 && newInvite.trim() && newInvite.trim() !== 'https://chat.whatsapp.com/'
                ? newInvite.trim()
                : ch.inviteUrl,
          }));

          const forceKeys = new Set<string>();
          for (const ch of finalChats) {
            for (const k of getGroupAllMatchKeys({
              channel: 'Telegram',
              remoteJid: ch.id,
              username: ch.username,
              inviteUrl: ch.inviteUrl,
            })) {
              forceKeys.add(k);
            }
          }
          if (forceKeys.size > 0) {
            unexcludeDispatchGroupKeys(Array.from(forceKeys));
          }

          setDispatchGroups((prev) =>
            mergeTelegramResolvedChats({
              existing: prev,
              resolvedChats: finalChats,
              accountId: matchingAcc.id,
              accountName: matchingAcc.name,
              defaultSegment: seg,
              forceIncludeKeys: forceKeys,
              autoActivateIfUnderLimit: maxLimit,
            }).groups
          );

          const firstChat = finalChats[0];
          setNewName('');
          setNewRemoteJid('');
          setAddGroupModal(false);
          notify(
            firstChat.canPostMessages ? 'Canal Telegram validado e salvo!' : 'Canal salvo com alerta de permissão',
            firstChat.canPostMessages
              ? `${firstChat.title} (${firstChat.membersCount} inscritos · ${firstChat.statusLabel})`
              : `${firstChat.title}: ${firstChat.warningReason || firstChat.statusLabel}`,
            firstChat.canPostMessages ? 'success' : 'info'
          );
          return;
        } catch {
          setAddGroupError('Erro de rede ao consultar a API do Telegram.');
          return;
        } finally {
          setAddGroupBusy(false);
        }
      }

      if (!newName.trim()) {
        setAddGroupError('Informe o nome do grupo ou canal.');
        return;
      }

      const activateNow = activeCount < maxLimit;
      const candidateGroup: DispatchGroup = {
        id: `grp-${Date.now()}`,
        name: newName.trim(),
        channel: newChannel,
        accountId: matchingAcc.id,
        accountName: matchingAcc.name,
        remoteJid: newRemoteJid.trim() || undefined,
        isChannel: newIsChannel,
        activeForOffers: activateNow,
        activeSegments: activateNow ? [seg] : [],
        membersCount: 1,
        maxCapacity: newChannel === 'Telegram' ? 200000 : newIsChannel ? 5000 : 1024,
        inviteUrl: newInvite.trim(),
        segment: seg,
      };
      unexcludeDispatchGroupKeys(getGroupAllMatchKeys(candidateGroup));
      setDispatchGroups((prev) => [...prev, candidateGroup]);
      setNewName('');
      setNewRemoteJid('');
      setAddGroupModal(false);
      notify('Grupo/Canal adicionado!', candidateGroup.name);
    };

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Users className="w-6 h-6 text-[#15803D] dark:text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Grupos de Envio
            </h1>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
              {activeSegment}
            </span>
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

        {/* Excluded Groups Restore Bar */}
        {excludedDispatchGroupKeys.length > 0 && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
            <span className="text-slate-600 dark:text-slate-300">
              Você possui itens excluídos da lista de envio (não voltarão automaticamente ao sincronizar).
            </span>
            <button
              type="button"
              onClick={() => void restoreExcludedDispatchGroups()}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar excluídos</span>
            </button>
          </div>
        )}

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
                  <th className="py-3.5 px-3 text-right">Enviar Ofertas</th>
                  <th className="py-3.5 px-4 text-right">Excluir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-14 px-6 text-center">
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
                  filtered.map((g) => {
                    const activeHere = isGroupActiveInSegment(g, activeSegment);
                    const otherSegments = getGroupActiveSegments(g).filter(
                      (s) => !matchesSegment(s, activeSegment)
                    );
                    return (
                    <tr
                      key={g.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                        <div>{g.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px]">
                          {g.isChannel && (
                            <span className="text-sky-600 dark:text-sky-400 font-medium">
                              Canal
                            </span>
                          )}
                          {g.username && (
                            <span className="font-mono text-slate-500 dark:text-slate-400">
                              @{g.username}
                            </span>
                          )}
                          {g.channel === 'Telegram' && g.canPostMessages === true && (
                            <span className="text-[#15803D] dark:text-emerald-400 font-medium">
                              · Admin OK
                            </span>
                          )}
                          {g.channel === 'Telegram' && g.canPostMessages === false && (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              · Sem permissão de postar
                            </span>
                          )}
                          {otherSegments.length > 0 && (
                            <span className="text-slate-500 dark:text-slate-400">
                              · Ativo em: {otherSegments.join(', ')}
                            </span>
                          )}
                          {g.remoteJid ? (
                            <span className="font-mono text-emerald-700 dark:text-emerald-400">
                              ID: {g.remoteJid}
                            </span>
                          ) : (
                            <span className="text-slate-400">
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
                      <td className="py-3.5 px-3 text-right">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={activeHere}
                          onClick={() => toggleGroupActive(g)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            activeHere
                              ? 'bg-[#15803D]'
                              : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              activeHere ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteGroup({ kind: 'envio', group: g })}
                          aria-label={`Excluir ${g.name}`}
                          title="Excluir grupo/canal da lista de envio"
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
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
                    {newChannel === 'Telegram'
                      ? 'Nome do Grupo ou Canal (opcional — preenchido automaticamente pela API)'
                      : 'Nome do Grupo ou Canal *'}
                  </label>
                  <input
                    type="text"
                    required={newChannel !== 'Telegram'}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={
                      newChannel === 'Telegram'
                        ? 'Deixe em branco para puxar o nome oficial do Telegram'
                        : 'Ex: Meu Grupo de Ofertas'
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    {newChannel === 'Telegram'
                      ? '@username do Canal, link t.me/canal ou Chat ID *'
                      : 'JID do Grupo no WhatsApp (ex: 12036304...@g.us)'}
                  </label>
                  <input
                    type="text"
                    required={newChannel === 'Telegram'}
                    value={newRemoteJid}
                    onChange={(e) => {
                      setNewRemoteJid(e.target.value);
                      if (addGroupError) setAddGroupError(null);
                    }}
                    placeholder={
                      newChannel === 'Telegram'
                        ? 'Ex: @divulgatudoofertas ou https://t.me/meucanal'
                        : 'Ex: 120363192837465@g.us'
                    }
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-mono"
                  />
                </div>

                {addGroupError && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    {addGroupError}
                  </div>
                )}

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
                  onClick={() => {
                    setAddGroupError(null);
                    setAddGroupModal(false);
                  }}
                  className="px-4 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addGroupBusy}
                  className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
                >
                  {addGroupBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{newChannel === 'Telegram' ? 'Validar e Salvar' : 'Salvar Grupo'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {renderDeleteGroupConfirmModal()}
      </div>
    );
  }

  // MONITORAMENTO MODE
  const monitoredCount = monitoringGroups.filter((g) =>
    isGroupMonitoredInSegment(g, activeSegment)
  ).length;
  const filteredMon = monitoringGroups.filter((g) => {
    const monHere = isGroupMonitoredInSegment(g, activeSegment);
    if (statusFilter === 'Monitorados' && !monHere) return false;
    if (statusFilter === 'Não Monitorados' && monHere) return false;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Users className="w-6 h-6 text-[#15803D] dark:text-emerald-400 shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Grupos de Monitoramento
          </h1>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {activeSegment}
          </span>
        </div>
        <button
          type="button"
          disabled={syncingGroups}
          onClick={() => void syncAllConnectedChannels()}
          className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
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

      {excludedMonitoringGroupKeys.length > 0 && (
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            Você possui grupo(s) excluído(s) do monitoramento (não voltarão automaticamente ao sincronizar).
          </span>
          <button
            type="button"
            onClick={() => void restoreExcludedMonitoringGroups()}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar excluídos</span>
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        {/* Mobile card layout so group name, Links Hoje, and Monitorar switch stay visible together */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredMon.length === 0 ? (
            <div className="py-12 px-5 text-center">
              <Users className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2.5" />
              <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                {monitoringGroups.length === 0
                  ? 'Nenhum grupo de monitoramento sincronizado'
                  : 'Nenhum grupo corresponde aos filtros'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {accounts.some((a) => a.connected)
                  ? 'Clique em "Sincronizar" acima para carregar todos os grupos reais do seu WhatsApp conectado.'
                  : 'Conecte seu WhatsApp em Canais → WhatsApp para listar seus grupos reais aqui.'}
              </p>
            </div>
          ) : (
            filteredMon.map((g) => {
              const monHere = isGroupMonitoredInSegment(g, activeSegment);
              const otherMonSegs = getGroupMonitoredSegments(g).filter(
                (s) => !matchesSegment(s, activeSegment)
              );
              const activeMarkets =
                g.allowedMarketplaces && g.allowedMarketplaces.length > 0
                  ? g.allowedMarketplaces
                  : MONITORING_MARKETPLACES;
              const marketSummary =
                activeMarkets.length === MONITORING_MARKETPLACES.length
                  ? 'Todos os marketplaces'
                  : activeMarkets.join(', ');
              return (
                <div key={`mob-${g.id}`} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-900 dark:text-white leading-snug break-words">
                        {g.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1 font-mono text-slate-600 dark:text-slate-300">
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          {g.accountName}
                        </span>
                        <span>• {marketSummary}</span>
                        {g.useGroupImage && (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            • Foto do grupo
                          </span>
                        )}
                        {otherMonSegs.length > 0 && (
                          <span>• Monitorado em: {otherMonSegs.join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={monHere}
                      aria-label={`Monitorar ${g.name}`}
                      onClick={() => {
                        if (!monHere && monitoredCount >= maxLimit) {
                          notify(
                            'Limite atingido',
                            `Máximo de ${maxLimit} grupos monitorados.`,
                            'error'
                          );
                          return;
                        }
                        setMonitoringGroups((prev) =>
                          prev.map((m) => {
                            if (m.id !== g.id) return m;
                            const nextMonSegs = toggleGroupSegmentMembership(
                              getGroupMonitoredSegments(m),
                              activeSegment,
                              !monHere
                            );
                            return {
                              ...m,
                              monitoredSegments: nextMonSegs,
                              monitored: nextMonSegs.length > 0,
                            };
                          })
                        );
                        notify(
                          !monHere
                            ? `Monitoramento ativado em "${activeSegment}"`
                            : `Monitoramento pausado em "${activeSegment}"`,
                          g.name
                        );
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        monHere ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          monHere ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span className="text-slate-400 dark:text-slate-500">Links hoje:</span>
                      <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                        {g.capturedToday || 0}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          monHere
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        • {monHere ? 'Ativo' : 'Pausado'}
                      </span>
                    </div>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openMonitoringConfigModal(g)}
                        aria-label={`Configurar ${g.name}`}
                        title="Configurar marketplaces e imagem do grupo"
                        className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingDeleteGroup({ kind: 'monitoramento', group: g })
                        }
                        aria-label={`Excluir ${g.name}`}
                        title="Excluir grupo do monitoramento"
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table layout */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500">
                <th className="py-3.5 px-4">Nome do Grupo Real</th>
                <th className="py-3.5 px-3">App</th>
                <th className="py-3.5 px-3">Conta</th>
                <th className="py-3.5 px-3 text-right">Links Hoje</th>
                <th className="py-3.5 px-3 text-right">Monitorar</th>
                <th className="py-3.5 px-3 text-right">Ações</th>
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
                  const monHere = isGroupMonitoredInSegment(g, activeSegment);
                  const otherMonSegs = getGroupMonitoredSegments(g).filter(
                    (s) => !matchesSegment(s, activeSegment)
                  );
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
                          {otherMonSegs.length > 0 && (
                            <span className="text-slate-500 dark:text-slate-400">
                              • Monitorado em: {otherMonSegs.join(', ')}
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
                          aria-checked={monHere}
                          onClick={() => {
                            if (!monHere && monitoredCount >= maxLimit) {
                              notify(
                                'Limite atingido',
                                `Máximo de ${maxLimit} grupos monitorados.`,
                                'error'
                              );
                              return;
                            }
                            setMonitoringGroups((prev) =>
                              prev.map((m) => {
                                if (m.id !== g.id) return m;
                                const nextMonSegs = toggleGroupSegmentMembership(
                                  getGroupMonitoredSegments(m),
                                  activeSegment,
                                  !monHere
                                );
                                return {
                                  ...m,
                                  monitoredSegments: nextMonSegs,
                                  monitored: nextMonSegs.length > 0,
                                };
                              })
                            );
                            notify(
                              !monHere
                                ? `Monitoramento ativado em "${activeSegment}"`
                                : `Monitoramento pausado em "${activeSegment}"`,
                              g.name
                            );
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            monHere ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              monHere ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openMonitoringConfigModal(g)}
                            aria-label={`Configurar ${g.name}`}
                            title="Configurar marketplaces e imagem do grupo"
                            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingDeleteGroup({ kind: 'monitoramento', group: g })
                            }
                            aria-label={`Excluir ${g.name}`}
                            title="Excluir grupo do monitoramento"
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
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

      {renderDeleteGroupConfirmModal()}
    </div>
  );
};

/* ============================================================================
 * 4. AGENDAMENTOS & FILAS DE DISPARO (Telas 39–42)
 * ========================================================================== */
export const SchedulesView: React.FC = () => {
  const {
    schedules,
    setSchedules,
    dispatchGroups,
    dispatchCustomMessage,
    activeSegment,
    setRoute,
    notify,
  } = useApp();
  const [filter, setFilter] = useState('Todos');
  const [search, setSearch] = useState('');

  const filtered = schedules.filter((s) => {
    if (!matchesSegment(s.segment, activeSegment)) return false;
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
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 px-2.5 py-0.5 rounded-lg">
            {activeSegment}
          </span>
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
                          : dispatchGroups.filter((g) => isGroupActiveInSegment(g, activeSegment));
                      if (matched.length === 0) {
                        notify(
                          'Ative um grupo real antes de disparar',
                          `Nenhum grupo conectado ativo encontrado no segmento "${activeSegment}".`,
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
                        segment: activeSegment,
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
  const [runningQueueId, setRunningQueueId] = useState<string | null>(null);

  const [newQueueName, setNewQueueName] = useState('');
  const [newQueueInterval, setNewQueueInterval] = useState('15');

  const segmentProducts = products.filter((p) => matchesSegment(p.segment, activeSegment));

  const filtered = queues.filter((q) => {
    if (!matchesSegment(q.segment, activeSegment)) return false;
    if (statusFilter === 'Ativa' && !q.active) return false;
    if (statusFilter === 'Pausada' && q.active) return false;
    if (search.trim() && !q.name.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const formatNextRunLabel = (q: DispatchQueue): string => {
    if (q.totalCount === 0 || q.productIds.length === 0) return 'Sem produtos na fila';
    if (q.sentCount >= q.totalCount) return 'Fila concluída';
    if (!q.active) return 'Pausada';
    if (!q.nextRunAt) return 'Pronta para o próximo ciclo automático';
    const d = new Date(q.nextRunAt);
    if (Number.isNaN(d.getTime())) return 'Pronta para o próximo ciclo automático';
    const hhmm = d.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
    const nowDay = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const runDay = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (runDay !== nowDay) {
      const ddmm = d.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
      });
      return `Próximo envio: ${ddmm} às ${hhmm}`;
    }
    return `Próximo envio: ${hhmm}`;
  };

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
    notify('Fila criada!', `${item.name} · intervalo de ${item.intervalMinutes} min.`);
  };

  const handleResetQueue = (q: DispatchQueue) => {
    setQueues((prev) =>
      prev.map((item) =>
        item.id === q.id
          ? {
              ...item,
              sentCount: 0,
              lastRunAt: undefined,
              nextRunAt: undefined,
            }
          : item
      )
    );
    notify('Fila reiniciada!', `"${q.name}" voltou para o início (0 de ${q.totalCount}).`);
  };

  const triggerNextFromQueue = async (q: DispatchQueue) => {
    if (runningQueueId === q.id) return;
    if (q.productIds.length === 0 || q.sentCount >= q.totalCount) {
      notify('Fila vazia ou concluída', 'Adicione produtos clicando no ícone de caixa ou reinicie a fila.', 'info');
      return;
    }

    setRunningQueueId(q.id);
    try {
      const res = await runDispatchQueueNextApi(q.id);
      if (res.ok) {
        const nowIso = new Date().toISOString();
        setQueues((prev) =>
          prev.map((item) => {
            if (item.id !== q.id) return item;
            const nextSent = Math.min(item.totalCount, item.sentCount + 1);
            return {
              ...item,
              sentCount: nextSent,
              lastRunAt: nowIso,
              nextRunAt: res.nextRunAt,
              active: res.completed ? false : item.active,
            };
          })
        );
        notify(
          'Próximo item da fila disparado!',
          res.productTitle
            ? `${res.productTitle} · entregue em ${res.sentCount} grupo(s).`
            : `Entregue em ${res.sentCount} grupo(s).`
        );
        return;
      }

      // If queue was just created client-side and not yet flushed to server, fallback cleanly once
      if (res.error && /não encontrada/i.test(res.error)) {
        const nextProdId = q.productIds[q.sentCount];
        const prod = products.find((p) => p.id === nextProdId);
        if (prod) {
          const delivery = await dispatchOfferNow(prod, [q.segment]);
          if (delivery.ok) {
            const nowIso = new Date().toISOString();
            const nextSent = Math.min(q.totalCount, q.sentCount + 1);
            setQueues((prev) =>
              prev.map((item) =>
                item.id === q.id
                  ? {
                      ...item,
                      sentCount: nextSent,
                      lastRunAt: nowIso,
                      nextRunAt:
                        nextSent < item.totalCount
                          ? new Date(Date.now() + Math.max(1, item.intervalMinutes) * 60_000).toISOString()
                          : undefined,
                      active: nextSent >= item.totalCount ? false : item.active,
                    }
                  : item
              )
            );
          }
          return;
        }
      }

      notify('Não foi possível disparar agora', res.error || 'Verifique os grupos ativos e o WhatsApp.', 'error');
    } catch {
      notify('Erro ao disparar item da fila', 'Tente novamente em instantes.', 'error');
    } finally {
      setRunningQueueId(null);
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
            Organize produtos em ordem sequencial. Filas ativas disparam automaticamente 24/7 no
            servidor conforme o intervalo configurado.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          title="Nova Fila"
          className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 shrink-0 shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Fila</span>
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
          onClick={() => notify('Filas atualizadas', `${filtered.length} fila(s) exibida(s).`, 'info')}
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
                <th className="py-3.5 px-4">Fila e Programação</th>
                <th className="py-3.5 px-4">Progresso</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 px-4 text-center text-sm text-slate-500">
                    Nenhuma fila de disparo cadastrada neste segmento. Clique em{' '}
                    <strong>Nova Fila</strong> para criar sua primeira sequência automática.
                  </td>
                </tr>
              ) : (
                filtered.map((q) => {
                  const pct =
                    q.totalCount === 0
                      ? 0
                      : Math.round((q.sentCount / q.totalCount) * 100);
                  const isRunning = runningQueueId === q.id;
                  return (
                    <tr key={q.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {q.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>A cada {Math.max(1, q.intervalMinutes || 15)} min</span>
                          </span>
                          <span>·</span>
                          <span>{formatNextRunLabel(q)}</span>
                        </div>
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
                          aria-label={`Alternar status da fila ${q.name}`}
                          onClick={() =>
                            setQueues((prev) =>
                              prev.map((item) => {
                                if (item.id !== q.id) return item;
                                const nextActive = !item.active;
                                return {
                                  ...item,
                                  active: nextActive,
                                  nextRunAt: nextActive ? undefined : item.nextRunAt,
                                };
                              })
                            )
                          }
                          className="inline-flex items-center gap-2 min-h-[36px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
                        >
                          <span
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              q.active ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                q.active ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              q.active
                                ? 'text-[#15803D] dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {q.active ? 'Ativa' : 'Pausada'}
                          </span>
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
                            disabled={isRunning}
                            onClick={() => void triggerNextFromQueue(q)}
                            title="Disparar próximo item agora"
                            className="p-2 rounded-lg text-[#15803D] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 disabled:opacity-50"
                          >
                            {isRunning ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                          {q.sentCount > 0 && (
                            <button
                              type="button"
                              onClick={() => handleResetQueue(q)}
                              title="Reiniciar fila do zero"
                              className="p-2 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
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
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
          <span>{filtered.length} Resultado(s)</span>
          <span>Motor 24/7 ativo no servidor</span>
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
              {segmentProducts.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Nenhum produto salvo no segmento <strong>{activeSegment}</strong>.
                </p>
              ) : (
              segmentProducts.map((p) => {
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
              })
              )}
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
