import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupWhatsAppTargetsByActiveAccount,
  isWhatsAppAccountActiveForDispatch,
  resolveActiveWhatsAppAccounts,
} from './whatsappAccountDispatch';

test('isWhatsAppAccountActiveForDispatch defaults to true when omitted', () => {
  assert.equal(isWhatsAppAccountActiveForDispatch({}), true);
  assert.equal(isWhatsAppAccountActiveForDispatch({ activeForDispatch: true }), true);
  assert.equal(isWhatsAppAccountActiveForDispatch({ activeForDispatch: false }), false);
});

test('groupWhatsAppTargetsByActiveAccount routes all groups to the only active number', () => {
  const accounts = [
    { id: 'acc-wa-1', channel: 'WhatsApp', connected: true, activeForDispatch: false },
    { id: 'acc-wa-2', channel: 'WhatsApp', connected: true, activeForDispatch: true },
  ];
  const targets = [
    { remoteJid: '111@g.us', name: 'Grupo A', accountId: 'acc-wa-1' },
    { remoteJid: '222@g.us', name: 'Grupo B', accountId: 'acc-wa-2' },
  ];

  const res = groupWhatsAppTargetsByActiveAccount(targets, accounts, ['acc-wa-1', 'acc-wa-2']);
  assert.equal(res.allDisabled, false);
  assert.equal(res.batches.length, 1);
  assert.equal(res.batches[0].accountId, 'acc-wa-2');
  assert.deepEqual(res.batches[0].remoteJids, ['111@g.us', '222@g.us']);
});

test('groupWhatsAppTargetsByActiveAccount preserves per-group accounts when both are active and rotation is off', () => {
  const accounts = [
    { id: 'acc-wa-1', channel: 'WhatsApp', connected: true, activeForDispatch: true },
    { id: 'acc-wa-2', channel: 'WhatsApp', connected: true, activeForDispatch: true },
  ];
  const targets = [
    { remoteJid: '111@g.us', name: 'Grupo A', accountId: 'acc-wa-1' },
    { remoteJid: '222@g.us', name: 'Grupo B', accountId: 'acc-wa-2' },
  ];

  const res = groupWhatsAppTargetsByActiveAccount(targets, accounts, ['acc-wa-1', 'acc-wa-2']);
  assert.equal(res.allDisabled, false);
  assert.equal(res.batches.length, 2);
  assert.equal(res.batches[0].accountId, 'acc-wa-1');
  assert.deepEqual(res.batches[0].remoteJids, ['111@g.us']);
  assert.equal(res.batches[1].accountId, 'acc-wa-2');
  assert.deepEqual(res.batches[1].remoteJids, ['222@g.us']);
});

test('groupWhatsAppTargetsByActiveAccount rotates evenly across active numbers when rotateAccounts is enabled', () => {
  const accounts = [
    { id: 'acc-wa-1', channel: 'WhatsApp', connected: true, activeForDispatch: true },
    { id: 'acc-wa-2', channel: 'WhatsApp', connected: true, activeForDispatch: true },
    { id: 'acc-wa-3', channel: 'WhatsApp', connected: true, activeForDispatch: false },
  ];
  const targets = [
    { remoteJid: '111@g.us', name: 'Grupo A', accountId: 'acc-wa-1' },
    { remoteJid: '222@g.us', name: 'Grupo B', accountId: 'acc-wa-1' },
  ];

  const run1 = groupWhatsAppTargetsByActiveAccount(targets, accounts, ['acc-wa-1', 'acc-wa-2', 'acc-wa-3'], {
    rotateAccounts: true,
    rotationCursor: 0,
  });
  assert.equal(run1.rotatedAccountId, 'acc-wa-1');
  assert.equal(run1.nextRotationCursor, 1);
  assert.equal(run1.batches.length, 1);
  assert.equal(run1.batches[0].accountId, 'acc-wa-1');
  assert.deepEqual(run1.batches[0].remoteJids, ['111@g.us', '222@g.us']);

  const run2 = groupWhatsAppTargetsByActiveAccount(targets, accounts, ['acc-wa-1', 'acc-wa-2', 'acc-wa-3'], {
    rotateAccounts: true,
    rotationCursor: run1.nextRotationCursor,
  });
  assert.equal(run2.rotatedAccountId, 'acc-wa-2');
  assert.equal(run2.nextRotationCursor, 0);
  assert.equal(run2.batches[0].accountId, 'acc-wa-2');
});

test('groupWhatsAppTargetsByActiveAccount blocks dispatch when all connected numbers are disabled', () => {
  const accounts = [
    { id: 'acc-wa-1', channel: 'WhatsApp', connected: true, activeForDispatch: false },
    { id: 'acc-wa-2', channel: 'WhatsApp', connected: true, activeForDispatch: false },
  ];
  const targets = [{ remoteJid: '111@g.us', name: 'Grupo A', accountId: 'acc-wa-1' }];

  const res = groupWhatsAppTargetsByActiveAccount(targets, accounts, ['acc-wa-1', 'acc-wa-2']);
  assert.equal(res.hasAnyConnectedOrOpen, true);
  assert.equal(res.allDisabled, true);
  assert.equal(res.batches.length, 0);
});

test('resolveActiveWhatsAppAccounts ignores Telegram and closed Baileys sockets', () => {
  const accounts = [
    { id: 'acc-tg-1', channel: 'Telegram', connected: true, activeForDispatch: true },
    { id: 'acc-wa-1', channel: 'WhatsApp', connected: true, activeForDispatch: true },
    { id: 'acc-wa-2', channel: 'WhatsApp', connected: true, activeForDispatch: true },
  ];

  const res = resolveActiveWhatsAppAccounts(accounts, ['acc-wa-2']);
  assert.equal(res.hasAnyConnectedOrOpen, true);
  assert.deepEqual(
    res.activeAccounts.map((a) => a.id),
    ['acc-wa-2']
  );
});
