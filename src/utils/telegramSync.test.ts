import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTelegramBotPermission,
  extractChatsFromTelegramUpdates,
  getGroupAllMatchKeys,
  getGroupExclusionKey,
  mergeTelegramResolvedChats,
  normalizeTelegramChatIdentifier,
  parseTelegramTargetList,
  type ResolvedTelegramChat,
} from './telegramSync.ts';
import type { DispatchGroup } from '../types.ts';

test('normalizeTelegramChatIdentifier normalizes @handles, t.me URLs, numeric IDs, and rejects private invites', () => {
  assert.equal(normalizeTelegramChatIdentifier('@DivulgaTudoOfertas'), '@divulgatudoofertas');
  assert.equal(normalizeTelegramChatIdentifier('divulgatudoofertas'), '@divulgatudoofertas');
  assert.equal(
    normalizeTelegramChatIdentifier('https://t.me/DivulgaTudoOfertas'),
    '@divulgatudoofertas'
  );
  assert.equal(
    normalizeTelegramChatIdentifier('t.me/achados_ofertas?start=1'),
    '@achados_ofertas'
  );
  assert.equal(normalizeTelegramChatIdentifier('-1004463166250'), '-1004463166250');
  assert.equal(normalizeTelegramChatIdentifier('https://t.me/+AbCdEf12345'), null);
  assert.equal(normalizeTelegramChatIdentifier('https://t.me/joinchat/AbCdEf12345'), null);
  assert.equal(normalizeTelegramChatIdentifier('   '), null);
});

test('parseTelegramTargetList splits multiline/comma lists, dedupes case-insensitively, and flags invalid items', () => {
  const res = parseTelegramTargetList(
    '@DivulgaTudoOfertas, https://t.me/divulgatudoofertas\n@canal_dois; -1001234567890\nhttps://t.me/+invitehash'
  );
  assert.deepEqual(res.valid, ['@divulgatudoofertas', '@canal_dois', '-1001234567890']);
  assert.deepEqual(res.invalid, ['https://t.me/+invitehash']);
});

test('extractChatsFromTelegramUpdates captures channel_post and my_chat_member while skipping private and left chats', () => {
  const updates = [
    { message: { chat: { id: 999, type: 'private', username: 'user1' } } },
    {
      channel_post: {
        chat: { id: -100111, title: 'Canal Ofertas 1', type: 'channel', username: 'ofertas1' },
      },
    },
    {
      edited_channel_post: {
        chat: { id: -100222, title: 'Canal Ofertas 2', type: 'channel', username: 'ofertas2' },
      },
    },
    {
      my_chat_member: {
        chat: { id: -100333, title: 'Canal Removido', type: 'channel' },
        new_chat_member: { status: 'administrator' },
      },
    },
    {
      my_chat_member: {
        chat: { id: -100333, title: 'Canal Removido', type: 'channel' },
        new_chat_member: { status: 'kicked' },
      },
    },
  ];

  const extracted = extractChatsFromTelegramUpdates(updates);
  assert.deepEqual(
    extracted.map((c) => c.id),
    ['-100111', '-100222']
  );
});

test('evaluateTelegramBotPermission checks channel can_post_messages accurately', () => {
  const adminCanPost = evaluateTelegramBotPermission('channel', {
    status: 'administrator',
    can_post_messages: true,
  });
  assert.equal(adminCanPost.isAdmin, true);
  assert.equal(adminCanPost.canPostMessages, true);
  assert.equal(adminCanPost.warningReason, undefined);

  const adminNoPost = evaluateTelegramBotPermission('channel', {
    status: 'administrator',
    can_post_messages: false,
  });
  assert.equal(adminNoPost.isAdmin, true);
  assert.equal(adminNoPost.canPostMessages, false);
  assert.ok(adminNoPost.warningReason);

  const memberInChannel = evaluateTelegramBotPermission('channel', {
    status: 'member',
  });
  assert.equal(memberInChannel.canPostMessages, false);
  assert.equal(memberInChannel.isAdmin, false);

  const creator = evaluateTelegramBotPermission('channel', { status: 'creator' });
  assert.equal(creator.isOwner, true);
  assert.equal(creator.canPostMessages, true);
});

test('mergeTelegramResolvedChats canonically deduplicates @handle and -100... entries while preserving activeSegments', () => {
  const existing: DispatchGroup[] = [
    {
      id: 'grp-tg-1',
      name: 'Canal @divulgatudoofertas',
      channel: 'Telegram',
      accountId: 'acc-tg-1',
      accountName: 'Central De Ofertas',
      remoteJid: '@divulgatudoofertas',
      isChannel: true,
      activeForOffers: true,
      activeSegments: ['Geral'],
      membersCount: 1,
      maxCapacity: 200000,
      inviteUrl: 'https://t.me/',
      segment: 'Geral',
    },
    {
      id: 'grp-tg-2',
      name: 'Divulga Tudo Ofertas',
      channel: 'Telegram',
      accountId: 'acc-tg-1',
      accountName: 'Central De Ofertas',
      remoteJid: '-1004463166250',
      isChannel: true,
      activeForOffers: true,
      activeSegments: ['BELEZA'],
      membersCount: 1,
      maxCapacity: 200000,
      inviteUrl: 'https://t.me/',
      segment: 'BELEZA',
    },
  ];

  const resolved: ResolvedTelegramChat[] = [
    {
      id: '-1004463166250',
      title: 'Divulga Tudo Ofertas Oficial',
      type: 'channel',
      username: 'divulgatudoofertas',
      membersCount: 1482,
      inviteUrl: 'https://t.me/divulgatudoofertas',
      isChannel: true,
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
      canPostMessages: true,
      statusLabel: 'Admin · Pode postar',
    },
  ];

  const merged = mergeTelegramResolvedChats({
    existing,
    resolvedChats: resolved,
    accountId: 'acc-tg-1',
    accountName: 'Central De Ofertas',
    defaultSegment: 'Geral',
  });

  assert.equal(merged.groups.length, 1);
  assert.equal(merged.mergedDuplicatesCount, 1);
  assert.equal(merged.groups[0].remoteJid, '-1004463166250');
  assert.equal(merged.groups[0].name, 'Divulga Tudo Ofertas Oficial');
  assert.equal(merged.groups[0].membersCount, 1482);
  assert.equal(merged.groups[0].username, 'divulgatudoofertas');
  assert.equal(merged.groups[0].canPostMessages, true);
  assert.deepEqual(merged.groups[0].activeSegments, ['Geral', 'BELEZA']);
});

test('mergeTelegramResolvedChats respects excludedKeys unless explicitly force-included', () => {
  const resolved: ResolvedTelegramChat[] = [
    {
      id: '-100999888777',
      title: 'Canal Excluído',
      type: 'channel',
      username: 'canalexcluido',
      membersCount: 45,
      inviteUrl: 'https://t.me/canalexcluido',
      isChannel: true,
      isOwner: false,
      isAdmin: true,
      isOwnerOrAdmin: true,
      canPostMessages: true,
      statusLabel: 'Admin · Pode postar',
    },
  ];

  const excluded = new Set(['tg:@canalexcluido']);

  const skipped = mergeTelegramResolvedChats({
    existing: [],
    resolvedChats: resolved,
    accountId: 'acc-tg-1',
    accountName: 'Central',
    excludedKeys: excluded,
  });
  assert.equal(skipped.groups.length, 0);

  const forced = mergeTelegramResolvedChats({
    existing: [],
    resolvedChats: resolved,
    accountId: 'acc-tg-1',
    accountName: 'Central',
    excludedKeys: excluded,
    forceIncludeKeys: new Set(['tg:@canalexcluido']),
  });
  assert.equal(forced.groups.length, 1);
  assert.equal(forced.groups[0].remoteJid, '-100999888777');
});

test('getGroupExclusionKey and getGroupAllMatchKeys normalize WhatsApp and Telegram keys consistently', () => {
  assert.equal(
    getGroupExclusionKey({
      channel: 'WhatsApp',
      remoteJid: '120363123456:12@G.US',
    }),
    'wa:120363123456@g.us'
  );

  const tgKeys = getGroupAllMatchKeys({
    channel: 'Telegram',
    remoteJid: '-1004463166250',
    username: 'DivulgaTudoOfertas',
    inviteUrl: 'https://t.me/DivulgaTudoOfertas',
  });
  assert.ok(tgKeys.includes('tg:-1004463166250'));
  assert.ok(tgKeys.includes('tg:@divulgatudoofertas'));
});
