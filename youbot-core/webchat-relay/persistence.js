const crypto = require('node:crypto');

class MemoryPersistence {
  constructor(defaultConfig) {
    this.defaultConfig = defaultConfig;
    this.tenants = new Map();
    this.slugs = new Map();
  }

  async ensureTenant(tenantId) {
    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, { config: { ...this.defaultConfig }, history: new Map() });
    }
  }

  async getConfig(tenantId) {
    await this.ensureTenant(tenantId);
    return { ...this.tenants.get(tenantId).config };
  }

  async updateConfig(tenantId, config) {
    await this.ensureTenant(tenantId);
    this.tenants.get(tenantId).config = { ...config };
  }

  async getSlugOwner(slug) {
    return this.slugs.get(slug) || null;
  }

  async getSlugForTenant(tenantId) {
    await this.ensureTenant(tenantId);
    return this.tenants.get(tenantId).slug || null;
  }

  async claimSlug(tenantId, slug) {
    await this.ensureTenant(tenantId);
    const tenant = this.tenants.get(tenantId);
    const owner = this.slugs.get(slug);
    if (owner && owner !== tenantId) return { status: 'taken', slug };
    if (tenant.slug && tenant.slug !== slug) {
      return { status: 'tenant_has_slug', slug: tenant.slug };
    }
    tenant.slug = slug;
    this.slugs.set(slug, tenantId);
    return { status: 'claimed', slug };
  }

  async appendHistory(tenantId, sessionId, event) {
    await this.ensureTenant(tenantId);
    const history = this.tenants.get(tenantId).history;
    const events = history.get(sessionId) || [];
    events.push(event);
    if (events.length > 100) events.splice(0, events.length - 100);
    history.set(sessionId, events);
  }

  async getHistory(tenantId, sessionId) {
    await this.ensureTenant(tenantId);
    return [...(this.tenants.get(tenantId).history.get(sessionId) || [])];
  }

  async sendToSession(tenantId, sessionId, content, requestId) {
    await this.ensureTenant(tenantId);
    const tenant = this.tenants.get(tenantId);
    const events = tenant.history.get(sessionId);
    if (!events?.length) return 'not_found';
    if (!tenant.sentReplies) tenant.sentReplies = new Map();
    const prior = tenant.sentReplies.get(requestId);
    if (prior) return prior.sessionId === sessionId && prior.content === content ? 'duplicate' : 'conflict';
    // No await between checking the receipt and appending the event.
    events.push({ id: requestId, role: 'assistant', content, delivery: 'session', timestamp: new Date().toISOString() });
    if (events.length > 100) events.splice(0, events.length - 100);
    tenant.sentReplies.set(requestId, { sessionId, content });
    return 'sent';
  }

  async createPending(tenantId, message) {
    await this.ensureTenant(tenantId);
    const tenant = this.tenants.get(tenantId);
    if (!tenant.pending) tenant.pending = new Map();
    tenant.pending.set(message.id, { ...message, status: 'pending', claimedUntil: 0, waiters: [] });
  }

  async countPending(tenantId, limit = 51) {
    await this.ensureTenant(tenantId);
    const pending = this.tenants.get(tenantId).pending || new Map();
    return [...pending.values()].filter((message) => message.status === 'pending').slice(0, limit).length;
  }

  async claimNext(tenantId, claimMs = 60_000) {
    await this.ensureTenant(tenantId);
    const pending = this.tenants.get(tenantId).pending || new Map();
    const now = Date.now();
    for (const message of pending.values()) {
      if (message.status === 'pending' && (!message.claimedUntil || message.claimedUntil <= now)) {
        message.claimedUntil = now + claimMs;
        return { ...message };
      }
    }
    return null;
  }

  async pollNext(tenantId, timeoutMs, claimMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const message = await this.claimNext(tenantId, claimMs);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, Math.min(20, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    return null;
  }

  async touchPending(tenantId, messageId, claimMs = 60_000) {
    await this.ensureTenant(tenantId);
    const message = this.tenants.get(tenantId).pending?.get(messageId);
    if (!message || message.status !== 'pending') return false;
    message.claimedUntil = Date.now() + claimMs;
    return true;
  }

  async resolvePending(tenantId, messageId, response) {
    await this.ensureTenant(tenantId);
    const message = this.tenants.get(tenantId).pending?.get(messageId);
    if (!message || message.status !== 'pending') return false;
    message.status = 'resolved';
    message.response = response;
    for (const resolve of message.waiters.splice(0)) resolve({ response });
    return true;
  }

  async waitForReply(tenantId, messageId, timeoutMs) {
    await this.ensureTenant(tenantId);
    const pending = this.tenants.get(tenantId).pending;
    const message = pending?.get(messageId);
    if (!message) return { response: '', timeout: true };
    if (message.status === 'resolved') return { response: message.response || '' };
    return new Promise((resolve) => {
      const done = (result) => {
        clearTimeout(timer);
        pending.delete(messageId);
        resolve(result);
      };
      const timer = setTimeout(() => done({
        response: 'This is taking longer than expected. Please try again in a moment.',
        timeout: true,
      }), timeoutMs);
      message.waiters.push(done);
    });
  }

  async stats() {
    let pending = 0;
    for (const tenant of this.tenants.values()) {
      pending += [...(tenant.pending || new Map()).values()].filter((message) => message.status === 'pending').length;
    }
    return { activeTenants: this.tenants.size, pending };
  }

  async health() {
    return true;
  }
}

class FirestorePersistence {
  constructor(defaultConfig) {
    const { Firestore } = require('@google-cloud/firestore');
    this.defaultConfig = defaultConfig;
    this.db = new Firestore();
  }

  tenantRef(tenantId) {
    return this.db.collection('relay_tenants').doc(tenantId);
  }

  sessionRef(tenantId, sessionId) {
    const sessionKey = crypto.createHash('sha256').update(sessionId).digest('base64url');
    return this.tenantRef(tenantId).collection('sessions').doc(sessionKey);
  }

  messageRef(tenantId, messageId) {
    return this.tenantRef(tenantId).collection('messages').doc(messageId);
  }

  slugRef(slug) {
    return this.db.collection('relay_slugs').doc(slug);
  }

  async ensureTenant(tenantId) {
    const ref = this.tenantRef(tenantId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        transaction.create(ref, {
          config: { ...this.defaultConfig },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        });
      } else {
        transaction.update(ref, { lastActiveAt: new Date() });
      }
    });
  }

  async getConfig(tenantId) {
    const snapshot = await this.tenantRef(tenantId).get();
    const config = snapshot.exists ? snapshot.data().config : null;
    return { ...this.defaultConfig, ...(config || {}) };
  }

  async updateConfig(tenantId, config) {
    await this.tenantRef(tenantId).set({ config: { ...config }, lastActiveAt: new Date() }, { merge: true });
  }

  async getSlugOwner(slug) {
    const snapshot = await this.slugRef(slug).get();
    return snapshot.exists ? snapshot.data().tenantId || null : null;
  }

  async getSlugForTenant(tenantId) {
    const snapshot = await this.tenantRef(tenantId).get();
    return snapshot.exists ? snapshot.data().slug || null : null;
  }

  async claimSlug(tenantId, slug) {
    const tenantRef = this.tenantRef(tenantId);
    const slugRef = this.slugRef(slug);
    return this.db.runTransaction(async (transaction) => {
      const [tenantSnapshot, slugSnapshot] = await transaction.getAll(tenantRef, slugRef);
      const owner = slugSnapshot.exists ? slugSnapshot.data().tenantId : null;
      if (owner && owner !== tenantId) return { status: 'taken', slug };
      const currentSlug = tenantSnapshot.exists ? tenantSnapshot.data().slug : null;
      if (currentSlug && currentSlug !== slug) {
        return { status: 'tenant_has_slug', slug: currentSlug };
      }
      if (!slugSnapshot.exists) {
        transaction.create(slugRef, { tenantId, createdAt: new Date() });
      }
      transaction.set(tenantRef, { slug, lastActiveAt: new Date() }, { merge: true });
      return { status: 'claimed', slug };
    });
  }

  async appendHistory(tenantId, sessionId, event) {
    const sessionRef = this.sessionRef(tenantId, sessionId);
    const eventRef = sessionRef.collection('events').doc();
    const batch = this.db.batch();
    batch.set(sessionRef, { sessionId, lastMessageAt: new Date(event.timestamp) }, { merge: true });
    batch.set(eventRef, { ...event, createdAt: new Date(event.timestamp) });
    batch.set(this.tenantRef(tenantId), { lastActiveAt: new Date() }, { merge: true });
    await batch.commit();
  }

  async getHistory(tenantId, sessionId) {
    const snapshot = await this.sessionRef(tenantId, sessionId)
      .collection('events')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return snapshot.docs.reverse().map((doc) => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        ...(data.delivery === 'session' ? { delivery: 'session' } : {}),
        role: data.role,
        content: data.content,
        timestamp: data.createdAt?.toDate?.().toISOString() || data.timestamp,
      };
    });
  }

  async sendToSession(tenantId, sessionId, content, requestId) {
    const sessionRef = this.sessionRef(tenantId, sessionId);
    const receiptRef = this.tenantRef(tenantId).collection('sent_replies').doc(requestId);
    const eventRef = sessionRef.collection('events').doc(`reply-${requestId}`);
    return this.db.runTransaction(async (transaction) => {
      const [session, receipt] = await transaction.getAll(sessionRef, receiptRef);
      if (!session.exists) return 'not_found';
      if (receipt.exists) {
        const prior = receipt.data();
        return prior.sessionId === sessionId && prior.content === content ? 'duplicate' : 'conflict';
      }
      const now = new Date();
      transaction.create(receiptRef, { sessionId, content, createdAt: now });
      transaction.create(eventRef, { id: requestId, role: 'assistant', content, delivery: 'session', timestamp: now.toISOString(), createdAt: now });
      transaction.update(sessionRef, { lastMessageAt: now });
      return 'sent';
    });
  }

  async createPending(tenantId, message) {
    await this.messageRef(tenantId, message.id).create({
      ...message,
      status: 'pending',
      claimedUntil: new Date(0),
      createdAt: new Date(),
      expireAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
  }

  async countPending(tenantId, limit = 51) {
    const snapshot = await this.tenantRef(tenantId).collection('messages')
      .where('status', '==', 'pending')
      .limit(limit)
      .get();
    return snapshot.size;
  }

  async claimNext(tenantId, claimMs = 60_000) {
    const snapshot = await this.tenantRef(tenantId).collection('messages')
      .where('status', '==', 'pending')
      .limit(20)
      .get();
    const now = Date.now();
    for (const candidate of snapshot.docs) {
      const claimed = await this.db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(candidate.ref);
        if (!fresh.exists) return null;
        const data = fresh.data();
        const claimedUntil = data.claimedUntil?.toMillis?.() || 0;
        if (data.status !== 'pending' || claimedUntil > now) return null;
        transaction.update(candidate.ref, {
          claimedUntil: new Date(now + claimMs),
          lastClaimedAt: new Date(now),
        });
        return { id: fresh.id, ...data, claimedUntil: now + claimMs };
      });
      if (claimed) return claimed;
    }
    return null;
  }

  async pollNext(tenantId, timeoutMs, claimMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const message = await this.claimNext(tenantId, claimMs);
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, Math.min(750, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    return null;
  }

  async touchPending(tenantId, messageId, claimMs = 60_000) {
    const ref = this.messageRef(tenantId, messageId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().status !== 'pending') return false;
      transaction.update(ref, {
        claimedUntil: new Date(Date.now() + claimMs),
        expireAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      return true;
    });
  }

  async resolvePending(tenantId, messageId, response) {
    const ref = this.messageRef(tenantId, messageId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().status !== 'pending') return false;
      transaction.update(ref, {
        status: 'resolved',
        response,
        resolvedAt: new Date(),
        expireAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      return true;
    });
  }

  async waitForReply(tenantId, messageId, timeoutMs) {
    const ref = this.messageRef(tenantId, messageId);
    const deadline = Date.now() + timeoutMs;
    do {
      const snapshot = await ref.get();
      if (!snapshot.exists) return { response: '', timeout: true };
      const data = snapshot.data();
      if (data.status === 'resolved') return { response: data.response || '' };
      if (data.status === 'timed_out') return {
        response: 'This is taking longer than expected. Please try again in a moment.',
        timeout: true,
      };
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);

    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists && snapshot.data().status === 'pending') {
        transaction.update(ref, { status: 'timed_out', timedOutAt: new Date() });
      }
    });
    return {
      response: 'This is taking longer than expected. Please try again in a moment.',
      timeout: true,
    };
  }

  async stats() {
    return { activeTenants: null, pending: null };
  }

  async health() {
    await this.db.collection('relay_tenants').limit(1).get();
    return true;
  }
}

function createPersistence(defaultConfig) {
  return process.env.RELAY_STORAGE === 'firestore'
    ? new FirestorePersistence(defaultConfig)
    : new MemoryPersistence(defaultConfig);
}

module.exports = { createPersistence, MemoryPersistence, FirestorePersistence };
