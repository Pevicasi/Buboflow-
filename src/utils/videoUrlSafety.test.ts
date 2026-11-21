import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateOrReservedIp,
  sanitizeDownloadFilename,
  validatePublicVideoUrlSyntax,
} from './videoUrlSafety';

test('isPrivateOrReservedIp blocks loopback, RFC1918, metadata, and IPv6 ULA/loopback', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
  assert.equal(isPrivateOrReservedIp('172.16.10.2'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
});

test('validatePublicVideoUrlSyntax blocks localhost, file:, metadata, and credentials', () => {
  assert.equal(validatePublicVideoUrlSyntax('http://localhost:3000/secret').ok, false);
  assert.equal(validatePublicVideoUrlSyntax('http://127.0.0.1:8080/a.mp4').ok, false);
  assert.equal(validatePublicVideoUrlSyntax('http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(validatePublicVideoUrlSyntax('file:///etc/passwd').ok, false);
  assert.equal(validatePublicVideoUrlSyntax('https://user:pass@example.com/v.mp4').ok, false);
  assert.equal(validatePublicVideoUrlSyntax('https://sv.shopee.com.br/share-video/abc123').ok, true);
});

test('sanitizeDownloadFilename strips unsafe path characters and ensures video extension', () => {
  assert.equal(sanitizeDownloadFilename('../../evil name!.mp4'), 'evil-name-.mp4');
  assert.equal(sanitizeDownloadFilename('Promoção Incrível'), 'Promocao-Incrivel.mp4');
  assert.equal(sanitizeDownloadFilename(''), 'video-buboflow.mp4');
});
