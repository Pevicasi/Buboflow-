import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutomationGroupDescription,
  buildAutomationGroupName,
  isBotAutomationReplyText,
  parseAutomationCommand,
  parseScheduleDateTimeBrazil,
  resolveAutomationGroupJidFromId,
  resolveAutomationSegmentsForGroupJid,
} from './automationCommands.ts';

test('parseAutomationCommand recognizes all 9 remote control commands plus status/help', () => {
  const now = new Date('2026-11-20T18:00:00.000Z'); // 15:00 BRT

  assert.deepEqual(parseAutomationCommand('envio_automatico_on', [], now), {
    type: 'auto_dispatch_on',
  });
  assert.deepEqual(parseAutomationCommand('envio_automatico_off', [], now), {
    type: 'auto_dispatch_off',
  });
  assert.deepEqual(parseAutomationCommand('status', [], now), { type: 'status' });
  assert.deepEqual(parseAutomationCommand('ajuda', [], now), { type: 'help' });

  const prev = parseAutomationCommand('preview: https://meli.la/1AbCdEf', [], now);
  assert.equal(prev.type, 'preview');
  if (prev.type === 'preview') assert.equal(prev.url, 'https://meli.la/1AbCdEf');

  const conv = parseAutomationCommand('converter: https://shopee.com.br/produto-123', [], now);
  assert.equal(conv.type, 'convert');
  if (conv.type === 'convert') assert.equal(conv.url, 'https://shopee.com.br/produto-123');

  const vid = parseAutomationCommand('video: https://sv.shopee.com.br/video/99', [], now);
  assert.equal(vid.type, 'video');
  if (vid.type === 'video') assert.equal(vid.url, 'https://sv.shopee.com.br/video/99');

  const bc = parseAutomationCommand('envio: Oferta relâmpago liberada!', [], now);
  assert.deepEqual(bc, { type: 'broadcast', message: 'Oferta relâmpago liberada!' });

  const prio = parseAutomationCommand('salvar_prioridade: https://meli.la/9Xyz', [], now);
  assert.equal(prio.type, 'save_priority');
  if (prio.type === 'save_priority') assert.equal(prio.url, 'https://meli.la/9Xyz');

  const direct = parseAutomationCommand('🔥 Olha esse tênis https://meli.la/777', [], now);
  assert.equal(direct.type, 'dispatch_product');
  if (direct.type === 'dispatch_product') assert.equal(direct.url, 'https://meli.la/777');
});

test('parseScheduleDateTimeBrazil schedules same day or rolls over to tomorrow in BRT', () => {
  // 2026-11-20 15:00 BRT (18:00Z)
  const now = new Date('2026-11-20T18:00:00.000Z');

  const laterToday = parseScheduleDateTimeBrazil('https://meli.la/abc 19:30', now);
  assert.ok(laterToday);
  assert.equal(laterToday.formattedBr, '20/11 às 19:30');
  assert.equal(laterToday.scheduledAtIso, '2026-11-20T22:30:00.000Z');

  // 10:00 already passed today at 15:00 BRT -> rolls to 21/11 10:00 BRT
  const tomorrow = parseScheduleDateTimeBrazil('Bom dia pessoal! 10:00', now);
  assert.ok(tomorrow);
  assert.equal(tomorrow.formattedBr, '21/11 às 10:00');
  assert.equal(tomorrow.scheduledAtIso, '2026-11-21T13:00:00.000Z');

  const cmd = parseAutomationCommand('agendar: https://meli.la/abc 19:30', [], now);
  assert.equal(cmd.type, 'schedule');
  if (cmd.type === 'schedule') {
    assert.equal(cmd.url, 'https://meli.la/abc');
    assert.equal(cmd.formattedBr, '20/11 às 19:30');
  }
});

test('isBotAutomationReplyText blocks bot replies and rendered offer templates from re-triggering', () => {
  assert.equal(isBotAutomationReplyText('✅ Envio automático ATIVADO!'), true);
  assert.equal(isBotAutomationReplyText('🤖 [Controle Remoto] Pronto!'), true);
  assert.equal(
    isBotAutomationReplyText(
      '🔥 Produto X\nCompre aqui: https://meli.la/123\nPromoção sujeita a alteração a qualquer momento.'
    ),
    true
  );
  assert.equal(isBotAutomationReplyText('preview: https://meli.la/123'), false);
  assert.equal(isBotAutomationReplyText('https://meli.la/123'), false);
});

test('resolveAutomationGroupJidFromId and resolveAutomationSegmentsForGroupJid map group IDs to WhatsApp JIDs', () => {
  const state = {
    segments: ['Geral', 'TECH'],
    monitoringGroups: [
      {
        id: 'mon-wa-120363430908374507gus',
        remoteJid: '120363430908374507@g.us',
        name: 'Grupo automação',
      },
    ],
    monitoringRules: { automationGroupId: 'mon-wa-120363430908374507gus' },
    monitoringRulesBySegment: {
      Geral: { automationGroupId: 'mon-wa-120363430908374507gus' },
      TECH: { automationGroupId: '' },
    },
  };

  assert.equal(
    resolveAutomationGroupJidFromId('mon-wa-120363430908374507gus', state),
    '120363430908374507@g.us'
  );
  assert.deepEqual(
    resolveAutomationSegmentsForGroupJid('120363430908374507@g.us', state),
    ['Geral']
  );
  assert.deepEqual(
    resolveAutomationSegmentsForGroupJid('120363999999999999@g.us', state),
    []
  );
});

test('buildAutomationGroupName and buildAutomationGroupDescription follow segment naming and explain remote commands', () => {
  assert.equal(buildAutomationGroupName('TECH'), 'TECH - GRUPO DE AUTOMAÇÃO');
  assert.equal(buildAutomationGroupName(''), 'Geral - GRUPO DE AUTOMAÇÃO');
  const longName = buildAutomationGroupName('A'.repeat(120));
  assert.ok(longName.length <= 100);
  assert.ok(longName.endsWith(' - GRUPO DE AUTOMAÇÃO'));

  const desc = buildAutomationGroupDescription('TECH');
  assert.match(desc, /TECH/);
  assert.match(desc, /Controle Remoto/);
  assert.match(desc, /preview:/);
  assert.match(desc, /envio_automatico_on/);
});

