import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQueueNextRunIso,
  isDispatchQueueDue,
  resolveNextQueueProduct,
} from './dispatchQueueEngine';

test('isDispatchQueueDue respects active flag, completion, and nextRunAt schedule', () => {
  const now = Date.parse('2026-11-21T12:00:00.000Z');
  assert.equal(
    isDispatchQueueDue(
      {
        id: 'q1',
        name: 'Fila 1',
        active: false,
        sentCount: 0,
        totalCount: 2,
        productIds: ['p1', 'p2'],
        intervalMinutes: 15,
      },
      now
    ),
    false
  );

  assert.equal(
    isDispatchQueueDue(
      {
        id: 'q1',
        name: 'Fila 1',
        active: true,
        sentCount: 2,
        totalCount: 2,
        productIds: ['p1', 'p2'],
        intervalMinutes: 15,
      },
      now
    ),
    false
  );

  assert.equal(
    isDispatchQueueDue(
      {
        id: 'q1',
        name: 'Fila 1',
        active: true,
        sentCount: 0,
        totalCount: 2,
        productIds: ['p1', 'p2'],
        intervalMinutes: 15,
        nextRunAt: '2026-11-21T12:10:00.000Z',
      },
      now
    ),
    false
  );

  assert.equal(
    isDispatchQueueDue(
      {
        id: 'q1',
        name: 'Fila 1',
        active: true,
        sentCount: 0,
        totalCount: 2,
        productIds: ['p1', 'p2'],
        intervalMinutes: 15,
        nextRunAt: '2026-11-21T11:59:00.000Z',
      },
      now
    ),
    true
  );
});

test('resolveNextQueueProduct skips deleted product IDs and returns next valid product', () => {
  const res = resolveNextQueueProduct(
    {
      id: 'q1',
      name: 'Fila 1',
      active: true,
      sentCount: 0,
      totalCount: 3,
      productIds: ['deleted-1', 'p2', 'p3'],
      intervalMinutes: 10,
    },
    [{ id: 'p2', title: 'Produto 2' }, { id: 'p3', title: 'Produto 3' }]
  );
  assert.ok(res);
  assert.equal(res.product.id, 'p2');
  assert.equal(res.nextIndex, 2);
});

test('computeQueueNextRunIso adds clamped interval minutes', () => {
  const base = Date.parse('2026-11-21T12:00:00.000Z');
  assert.equal(computeQueueNextRunIso(15, base), '2026-11-21T12:15:00.000Z');
  assert.equal(computeQueueNextRunIso(0, base), '2026-11-21T12:15:00.000Z');
});
