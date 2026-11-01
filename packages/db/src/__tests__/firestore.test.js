import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FirestoreClient,
  encodeFirestoreValue,
  decodeFirestoreValue,
  encodeFirestoreFields,
  decodeFirestoreFields,
  decodeFirestoreDocument
} from '../firestore.js';

test('FirestoreClient encoding and decoding of primitive and composite types', () => {
  // Primitives
  assert.deepEqual(encodeFirestoreValue('hello'), { stringValue: 'hello' });
  assert.deepEqual(encodeFirestoreValue(42), { integerValue: '42' });
  assert.deepEqual(encodeFirestoreValue(19.99), { doubleValue: 19.99 });
  assert.deepEqual(encodeFirestoreValue(true), { booleanValue: true });
  assert.deepEqual(encodeFirestoreValue(null), { nullValue: null });

  // Timestamp
  const now = new Date();
  assert.deepEqual(encodeFirestoreValue(now), { timestampValue: now.toISOString() });

  // Arrays
  const arr = ['paytm', 'phonepe', 500];
  const encodedArr = encodeFirestoreValue(arr);
  assert.deepEqual(encodedArr, {
    arrayValue: {
      values: [
        { stringValue: 'paytm' },
        { stringValue: 'phonepe' },
        { integerValue: '500' }
      ]
    }
  });

  // Round-trip decoding
  assert.equal(decodeFirestoreValue({ stringValue: 'test' }), 'test');
  assert.equal(decodeFirestoreValue({ integerValue: '123' }), 123);
  assert.equal(decodeFirestoreValue({ doubleValue: '45.67' }), 45.67);
  assert.equal(decodeFirestoreValue({ booleanValue: false }), false);
  assert.equal(decodeFirestoreValue({ nullValue: null }), null);
  assert.deepEqual(decodeFirestoreValue(encodedArr), arr);
});

test('FirestoreClient document serialization and deserialization', () => {
  const paymentObj = {
    orderId: 'ORDER-991',
    amount: '499.00',
    currency: 'INR',
    method: 'UPI',
    status: 'SUCCESS',
    utr: '412356789012',
    tags: ['mobile', 'cred']
  };

  const fields = encodeFirestoreFields(paymentObj);
  assert.equal(fields.orderId.stringValue, 'ORDER-991');
  assert.equal(fields.amount.stringValue, '499.00');
  assert.equal(fields.utr.stringValue, '412356789012');

  const decoded = decodeFirestoreFields(fields);
  assert.deepEqual(decoded, paymentObj);

  const rawRestDoc = {
    name: 'projects/payone-prod/databases/(default)/documents/payments/pay_123',
    fields,
    createTime: '2026-11-01T12:00:00Z',
    updateTime: '2026-11-01T12:00:05Z'
  };

  const fullDoc = decodeFirestoreDocument(rawRestDoc);
  assert.equal(fullDoc._id, 'pay_123');
  assert.equal(fullDoc.orderId, 'ORDER-991');
  assert.equal(fullDoc.status, 'SUCCESS');
  assert.equal(fullDoc.utr, '412356789012');
});

test('FirestoreClient setDocument, getDocument and recordPayment with mock fetch', async () => {
  const store = new Map();

  const mockFetch = async (url, options = {}) => {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const method = options.method || 'GET';

    if (method === 'PATCH' || method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const parts = pathname.split('/');
      const docId = parts[parts.length - 1];
      const doc = {
        name: pathname,
        fields: body.fields,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      };
      store.set(docId, doc);
      return {
        ok: true,
        status: 200,
        json: async () => doc
      };
    }

    if (method === 'GET') {
      const parts = pathname.split('/');
      const docId = parts[parts.length - 1];
      if (store.has(docId)) {
        return {
          ok: true,
          status: 200,
          json: async () => store.get(docId)
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => 'Document not found'
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  const client = new FirestoreClient({
    projectId: 'payone-test',
    apiKey: 'test-key',
    fetchFn: mockFetch
  });

  const saved = await client.recordPayment({
    id: 'pay_test_001',
    orderId: 'ORD-5544',
    amount: 1499,
    method: 'UPI',
    vpa: 'merchant@upi',
    utr: '987654321012',
    status: 'SUCCESS'
  });

  assert.equal(saved._id, 'pay_test_001');
  assert.equal(saved.orderId, 'ORD-5544');
  assert.equal(saved.utr, '987654321012');

  const retrieved = await client.getDocument('payments', 'pay_test_001');
  assert.ok(retrieved);
  assert.equal(retrieved._id, 'pay_test_001');
  assert.equal(retrieved.orderId, 'ORD-5544');
  assert.equal(retrieved.status, 'SUCCESS');
});
