/**
 * @file firestore.js
 * Cloud Firestore Database Client for PayOne / YOUPI PG.
 * Zero-dependency native Node.js client using the official Google Cloud Firestore REST API v1.
 * Supports document creation, query, updates, real-time-compatible payloads, and data serialization.
 */

/**
 * Encodes JavaScript types into Cloud Firestore REST API typed values.
 * @param {any} val
 * @returns {Record<string, any>}
 */
export function encodeFirestoreValue(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => encodeFirestoreValue(item))
      }
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: encodeFirestoreFields(val)
      }
    };
  }
  return { stringValue: String(val) };
}

/**
 * Encodes an object dictionary into Firestore document fields.
 * @param {Record<string, any>} obj
 * @returns {Record<string, any>}
 */
export function encodeFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      fields[key] = encodeFirestoreValue(value);
    }
  }
  return fields;
}

/**
 * Decodes a Cloud Firestore REST API typed value into native JavaScript.
 * @param {Record<string, any>} val
 * @returns {any}
 */
export function decodeFirestoreValue(val) {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue?.values || [];
    return values.map((v) => decodeFirestoreValue(v));
  }
  if ('mapValue' in val) {
    return decodeFirestoreFields(val.mapValue?.fields || {});
  }
  if ('referenceValue' in val) return val.referenceValue;
  return null;
}

/**
 * Decodes Firestore document fields dictionary into native JavaScript object.
 * @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
export function decodeFirestoreFields(fields) {
  const result = {};
  if (!fields || typeof fields !== 'object') return result;
  for (const [key, val] of Object.entries(fields)) {
    result[key] = decodeFirestoreValue(val);
  }
  return result;
}

/**
 * Extracts and decodes a Firestore REST document.
 * @param {Record<string, any>} doc
 * @returns {Record<string, any>}
 */
export function decodeFirestoreDocument(doc) {
  if (!doc) return null;
  const decoded = decodeFirestoreFields(doc.fields || {});
  const parts = (doc.name || '').split('/');
  const docId = parts[parts.length - 1] || null;
  return {
    _id: docId,
    _path: doc.name || null,
    _createTime: doc.createTime || null,
    _updateTime: doc.updateTime || null,
    ...decoded
  };
}

/**
 * Cloud Firestore REST Client
 */
export class FirestoreClient {
  /**
   * @param {{
   *   projectId?: string,
   *   apiKey?: string,
   *   databaseId?: string,
   *   fetchFn?: typeof fetch
   * }} [options={}]
   */
  constructor(options = {}) {
    this.projectId = options.projectId || process.env.FIREBASE_PROJECT_ID || 'payone-sovereign';
    this.apiKey = options.apiKey || process.env.FIREBASE_API_KEY || null;
    this.databaseId = options.databaseId || '(default)';
    this.fetch = options.fetchFn || globalThis.fetch;
  }

  /**
   * Constructs base URL for Firestore REST documents.
   * @private
   */
  get _baseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${this.databaseId}/documents`;
  }

  /**
   * Appends API key if configured.
   * @private
   * @param {string} url
   * @returns {string}
   */
  _withAuth(url) {
    if (!this.apiKey) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}key=${encodeURIComponent(this.apiKey)}`;
  }

  /**
   * Creates or overwrites a document in a collection.
   * @param {string} collectionPath
   * @param {Record<string, any>} data
   * @param {string} [docId]
   * @returns {Promise<Record<string, any>>}
   */
  async setDocument(collectionPath, data, docId = null) {
    const fields = encodeFirestoreFields(data);
    let url;
    let method;

    if (docId) {
      url = this._withAuth(`${this._baseUrl}/${collectionPath}/${encodeURIComponent(docId)}`);
      method = 'PATCH';
    } else {
      url = this._withAuth(`${this._baseUrl}/${collectionPath}`);
      method = 'POST';
    }

    const response = await this.fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Firestore setDocument failed (${response.status}): ${errBody}`);
    }

    const json = await response.json();
    return decodeFirestoreDocument(json);
  }

  /**
   * Retrieves a document by ID.
   * @param {string} collectionPath
   * @param {string} docId
   * @returns {Promise<Record<string, any>|null>}
   */
  async getDocument(collectionPath, docId) {
    const url = this._withAuth(`${this._baseUrl}/${collectionPath}/${encodeURIComponent(docId)}`);
    const response = await this.fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Firestore getDocument failed (${response.status}): ${errBody}`);
    }

    const json = await response.json();
    return decodeFirestoreDocument(json);
  }

  /**
   * Deletes a document by ID.
   * @param {string} collectionPath
   * @param {string} docId
   * @returns {Promise<boolean>}
   */
  async deleteDocument(collectionPath, docId) {
    const url = this._withAuth(`${this._baseUrl}/${collectionPath}/${encodeURIComponent(docId)}`);
    const response = await this.fetch(url, {
      method: 'DELETE'
    });

    if (!response.ok && response.status !== 404) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Firestore deleteDocument failed (${response.status}): ${errBody}`);
    }

    return true;
  }

  /**
   * Lists documents in a collection.
   * @param {string} collectionPath
   * @param {{ pageSize?: number, pageToken?: string }} [options={}]
   * @returns {Promise<{ documents: Array<Record<string, any>>, nextPageToken?: string }>}
   */
  async listDocuments(collectionPath, options = {}) {
    let url = `${this._baseUrl}/${collectionPath}`;
    const params = new URLSearchParams();
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    if (options.pageToken) params.set('pageToken', options.pageToken);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    url = this._withAuth(url);

    const response = await this.fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Firestore listDocuments failed (${response.status}): ${errBody}`);
    }

    const json = await response.json();
    const rawDocs = json.documents || [];
    return {
      documents: rawDocs.map((d) => decodeFirestoreDocument(d)),
      nextPageToken: json.nextPageToken || undefined
    };
  }

  /**
   * Stores a PayOne transaction in Firestore.
   * @param {Record<string, any>} payment
   * @returns {Promise<Record<string, any>>}
   */
  async recordPayment(payment) {
    const paymentId = payment.id || payment.orderId || `pay_${Date.now()}`;
    const docData = {
      orderId: payment.orderId || '',
      amount: payment.amount ? String(payment.amount) : '0',
      currency: payment.currency || 'INR',
      method: payment.method || 'UPI',
      status: payment.status || 'SUCCESS',
      utr: payment.utr || null,
      payeeVpa: payment.vpa || payment.payeeVpa || '',
      payeeName: payment.payeeName || '',
      userId: payment.userId || null,
      customerName: payment.customerName || null,
      customerEmail: payment.customerEmail || null,
      timestamp: payment.timestamp || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return this.setDocument('payments', docData, paymentId);
  }
}
