import type { DispatchGroup } from '../types';
import {
  DEFAULT_SEGMENT,
  dedupeSegmentNames,
  getGroupActiveSegments,
  normalizeSegmentName,
} from './segmentScoping';

export interface TelegramBotPermissionResult {
  isOwner: boolean;
  isAdmin: boolean;
  isOwnerOrAdmin: boolean;
  canPostMessages: boolean;
  statusLabel: string;
  warningReason?: string;
}

export interface ResolvedTelegramChat {
  id: string;
  title: string;
  type: string;
  username?: string;
  membersCount: number;
  inviteUrl: string;
  isChannel: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isOwnerOrAdmin: boolean;
  canPostMessages: boolean;
  statusLabel: string;
  warningReason?: string;
  sourceInput?: string;
}

export interface TelegramTargetFailure {
  input: string;
  reason: string;
}

export interface TelegramSyncResponse {
  ok: boolean;
  bot?: { id: number; name: string; username: string };
  webhookActive?: boolean;
  webhookHost?: string;
  updatesConflict?: boolean;
  syncNote?: string;
  discoveredChats?: ResolvedTelegramChat[];
  failedTargets?: TelegramTargetFailure[];
  error?: string;
}

export function normalizeTelegramChatIdentifier(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Canonical numeric chat_id (e.g. -1001234567890 or -123456789)
  if (/^-?\d{5,20}$/.test(trimmed)) {
    return trimmed;
  }

  // Telegram URL forms: https://t.me/username, http://telegram.me/username, t.me/username
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#\s]+)/i
  );
  if (urlMatch) {
    const slug = urlMatch[1].trim();
    // Private invite links (t.me/+hash or t.me/joinchat/hash) cannot be resolved by Bot API getChat
    if (!slug || slug.startsWith('+') || slug.toLowerCase() === 'joinchat' || slug.toLowerCase() === 'c') {
      return null;
    }
    if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(slug)) {
      return `@${slug.toLowerCase()}`;
    }
    return null;
  }

  // @username or bare username
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(stripped)) {
    return `@${stripped.toLowerCase()}`;
  }

  return null;
}

export function parseTelegramTargetList(raw: string): {
  valid: string[];
  invalid: string[];
} {
  if (!raw || typeof raw !== 'string') {
    return { valid: [], invalid: [] };
  }

  const tokens = raw
    .split(/[\r\n,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const normalized = normalizeTelegramChatIdentifier(token);
    if (!normalized) {
      if (!invalid.includes(token)) {
        invalid.push(token);
      }
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      valid.push(normalized);
    }
  }

  return { valid, invalid };
}

export interface DiscoveredUpdateChat {
  id: string;
  title?: string;
  type?: string;
  username?: string;
}

export function extractChatsFromTelegramUpdates(updates: any[]): DiscoveredUpdateChat[] {
  if (!Array.isArray(updates) || updates.length === 0) return [];

  const chatsMap = new Map<string, DiscoveredUpdateChat>();
  const botLeftChats = new Set<string>();

  for (const u of updates) {
    if (!u || typeof u !== 'object') continue;

    // Track my_chat_member status transitions chronologically
    if (u.my_chat_member?.chat?.id && u.my_chat_member.chat.type !== 'private') {
      const chat = u.my_chat_member.chat;
      const id = String(chat.id);
      const nextStatus = String(u.my_chat_member?.new_chat_member?.status || '').toLowerCase();
      if (nextStatus === 'left' || nextStatus === 'kicked') {
        botLeftChats.add(id);
        chatsMap.delete(id);
      } else {
        botLeftChats.delete(id);
        chatsMap.set(id, {
          id,
          title: chat.title || chat.username || id,
          type: chat.type,
          username: chat.username,
        });
      }
      continue;
    }

    const chat =
      u.channel_post?.chat ||
      u.edited_channel_post?.chat ||
      u.message?.chat ||
      u.edited_message?.chat ||
      u.chat_member?.chat;

    if (chat && chat.id && chat.type !== 'private') {
      const id = String(chat.id);
      if (botLeftChats.has(id)) continue;
      chatsMap.set(id, {
        id,
        title: chat.title || chat.username || id,
        type: chat.type,
        username: chat.username,
      });
    }
  }

  return Array.from(chatsMap.values());
}

export function evaluateTelegramBotPermission(
  chatType: string,
  member: any
): TelegramBotPermissionResult {
  const normalizedType = String(chatType || '').toLowerCase();
  const isChannel = normalizedType === 'channel';
  const status = String(member?.status || '').toLowerCase();

  if (status === 'creator') {
    return {
      isOwner: true,
      isAdmin: true,
      isOwnerOrAdmin: true,
      canPostMessages: true,
      statusLabel: 'Dono · Pode postar',
    };
  }

  if (status === 'administrator') {
    if (isChannel) {
      const canPost = Boolean(member?.can_post_messages);
      return {
        isOwner: false,
        isAdmin: true,
        isOwnerOrAdmin: true,
        canPostMessages: canPost,
        statusLabel: canPost ? 'Admin · Pode postar' : 'Admin · Sem permissão de postar',
        warningReason: canPost
          ? undefined
          : 'Ative a permissão "Postar Mensagens" para este bot nas configurações de administradores do canal.',
      };
    }

    const canSend = member?.can_send_messages !== false;
    return {
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
      canPostMessages: canSend,
      statusLabel: canSend ? 'Admin · Pode postar' : 'Admin · Envio bloqueado',
      warningReason: canSend
        ? undefined
        : 'Este bot está como administrador, mas sem permissão para enviar mensagens.',
    };
  }

  if (status === 'member') {
    if (isChannel) {
      return {
        isOwner: false,
        isAdmin: false,
        isOwnerOrAdmin: false,
        canPostMessages: false,
        statusLabel: 'Sem permissão de admin',
        warningReason:
          'Em canais do Telegram, o bot precisa ser adicionado como Administrador com permissão de postar.',
      };
    }
    return {
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
      canPostMessages: true,
      statusLabel: 'Membro · Pode enviar',
    };
  }

  if (status === 'restricted') {
    const canSend = !isChannel && Boolean(member?.can_send_messages);
    return {
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
      canPostMessages: canSend,
      statusLabel: canSend ? 'Restrito · Pode enviar' : 'Sem permissão de envio',
      warningReason: canSend
        ? undefined
        : 'O bot está com envio de mensagens restrito neste grupo/canal.',
    };
  }

  return {
    isOwner: false,
    isAdmin: false,
    isOwnerOrAdmin: false,
    canPostMessages: false,
    statusLabel: 'Bot fora do canal',
    warningReason:
      'O bot ainda não foi adicionado como administrador neste canal/grupo.',
  };
}

function normalizeWaJidForExclusion(jid?: string): string {
  if (!jid) return '';
  const trimmed = jid.trim();
  if (!trimmed) return '';
  const atIdx = trimmed.indexOf('@');
  if (atIdx < 0) return trimmed.toLowerCase();
  const userPart = trimmed.slice(0, atIdx).split(':')[0];
  const domainPart = trimmed.slice(atIdx + 1).toLowerCase();
  return `${userPart}@${domainPart}`;
}

export function getGroupExclusionKey(group: {
  channel: 'WhatsApp' | 'Telegram';
  remoteJid?: string;
  id?: string;
  username?: string;
}): string {
  if (group.channel === 'WhatsApp') {
    const norm = normalizeWaJidForExclusion(group.remoteJid);
    return norm ? `wa:${norm}` : `id:${group.id || ''}`;
  }
  const jid = (group.remoteJid || '').trim();
  if (jid) {
    return `tg:${jid.startsWith('@') ? jid.toLowerCase() : jid}`;
  }
  if (group.username?.trim()) {
    const clean = group.username.trim().replace(/^@/, '').toLowerCase();
    return `tg:@${clean}`;
  }
  return `id:${group.id || ''}`;
}

export function getGroupAllMatchKeys(group: {
  channel: 'WhatsApp' | 'Telegram';
  remoteJid?: string;
  id?: string;
  username?: string;
  inviteUrl?: string;
}): string[] {
  const keys = new Set<string>();
  const primary = getGroupExclusionKey(group);
  if (primary) keys.add(primary);

  if (group.channel === 'Telegram') {
    if (group.username?.trim()) {
      keys.add(`tg:@${group.username.trim().replace(/^@/, '').toLowerCase()}`);
    }
    const jid = (group.remoteJid || '').trim();
    if (jid) {
      keys.add(`tg:${jid.startsWith('@') ? jid.toLowerCase() : jid}`);
    }
    if (group.inviteUrl?.trim()) {
      const m = group.inviteUrl.trim().match(/t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,31})/i);
      if (m) {
        keys.add(`tg:@${m[1].toLowerCase()}`);
      }
    }
  }
  return Array.from(keys);
}

function telegramChatMatchesExistingGroup(
  chat: ResolvedTelegramChat,
  group: DispatchGroup
): boolean {
  if (group.channel !== 'Telegram') return false;

  const existingJid = (group.remoteJid || '').trim();
  if (existingJid && existingJid === chat.id) return true;

  const chatHandle = chat.username ? `@${chat.username.replace(/^@/, '').toLowerCase()}` : '';
  if (chatHandle) {
    if (existingJid && existingJid.toLowerCase() === chatHandle) return true;
    if (group.username && `@${group.username.replace(/^@/, '').toLowerCase()}` === chatHandle) {
      return true;
    }
    if (group.inviteUrl) {
      const m = group.inviteUrl.match(/t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,31})/i);
      if (m && `@${m[1].toLowerCase()}` === chatHandle) return true;
    }
  }

  return false;
}

export function mergeTelegramResolvedChats(params: {
  existing: DispatchGroup[];
  resolvedChats: ResolvedTelegramChat[];
  accountId: string;
  accountName: string;
  defaultSegment?: string;
  excludedKeys?: Set<string>;
  forceIncludeKeys?: Set<string>;
  autoActivateIfUnderLimit?: number;
}): {
  groups: DispatchGroup[];
  addedCount: number;
  updatedCount: number;
  mergedDuplicatesCount: number;
} {
  const {
    existing,
    resolvedChats,
    accountId,
    accountName,
    defaultSegment = DEFAULT_SEGMENT,
    excludedKeys,
    forceIncludeKeys,
    autoActivateIfUnderLimit = 0,
  } = params;

  const normalizedSeg = normalizeSegmentName(defaultSegment);
  let next = [...existing];
  let addedCount = 0;
  let updatedCount = 0;
  let mergedDuplicatesCount = 0;

  for (const chat of resolvedChats) {
    const chatKeys = getGroupAllMatchKeys({
      channel: 'Telegram',
      remoteJid: chat.id,
      username: chat.username,
      inviteUrl: chat.inviteUrl,
    });
    const isForced = Boolean(forceIncludeKeys && chatKeys.some((k) => forceIncludeKeys.has(k)));
    const isExcluded =
      !isForced && Boolean(excludedKeys && chatKeys.some((k) => excludedKeys.has(k)));

    if (isExcluded) {
      continue;
    }

    const matchingIndices: number[] = [];
    next.forEach((g, idx) => {
      if (telegramChatMatchesExistingGroup(chat, g)) {
        matchingIndices.push(idx);
      }
    });

    if (matchingIndices.length > 0) {
      const matchedGroups = matchingIndices.map((idx) => next[idx]);
      const combinedActiveSegments = dedupeSegmentNames(
        matchedGroups.flatMap((g) => getGroupActiveSegments(g))
      );
      const primaryGroup =
        matchedGroups.find((g) => g.remoteJid === chat.id) || matchedGroups[0];
      const combinedPriority = matchedGroups.some((g) => g.isPriorityCapture);

      const mergedGroup: DispatchGroup = {
        ...primaryGroup,
        name: chat.title || primaryGroup.name,
        channel: 'Telegram',
        accountId,
        accountName,
        remoteJid: chat.id,
        username: chat.username || primaryGroup.username,
        isChannel: chat.isChannel,
        isOwner: chat.isOwner,
        isAdmin: chat.isAdmin,
        isOwnerOrAdmin: chat.isOwnerOrAdmin,
        canPostMessages: chat.canPostMessages,
        activeSegments: combinedActiveSegments,
        activeForOffers: combinedActiveSegments.length > 0,
        membersCount: chat.membersCount > 0 ? chat.membersCount : primaryGroup.membersCount,
        maxCapacity: 200000,
        inviteUrl:
          chat.inviteUrl && chat.inviteUrl !== 'https://t.me/'
            ? chat.inviteUrl
            : primaryGroup.inviteUrl || 'https://t.me/',
        isPriorityCapture: combinedPriority,
        segment: combinedActiveSegments[0] || primaryGroup.segment || normalizedSeg,
      };

      const firstIdx = matchingIndices[0];
      const dropSet = new Set(matchingIndices.slice(1));
      if (dropSet.size > 0) {
        mergedDuplicatesCount += dropSet.size;
      }
      next[firstIdx] = mergedGroup;
      if (dropSet.size > 0) {
        next = next.filter((_, idx) => !dropSet.has(idx));
      }
      updatedCount += 1;
    } else {
      const currentActiveInSeg = next.filter((g) =>
        getGroupActiveSegments(g).some(
          (s) => s.toLowerCase() === normalizedSeg.toLowerCase()
        )
      ).length;
      const shouldActivate =
        autoActivateIfUnderLimit > 0 &&
        chat.canPostMessages &&
        currentActiveInSeg < autoActivateIfUnderLimit;

      next.push({
        id: `grp-tg-${chat.id.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).slice(2, 5)}`,
        name: chat.title,
        channel: 'Telegram',
        accountId,
        accountName,
        remoteJid: chat.id,
        username: chat.username,
        isChannel: chat.isChannel,
        isOwner: chat.isOwner,
        isAdmin: chat.isAdmin,
        isOwnerOrAdmin: chat.isOwnerOrAdmin,
        canPostMessages: chat.canPostMessages,
        activeForOffers: shouldActivate,
        activeSegments: shouldActivate ? [normalizedSeg] : [],
        membersCount: chat.membersCount,
        maxCapacity: 200000,
        inviteUrl: chat.inviteUrl || 'https://t.me/',
        segment: normalizedSeg,
      });
      addedCount += 1;
    }
  }

  return {
    groups: next,
    addedCount,
    updatedCount,
    mergedDuplicatesCount,
  };
}
