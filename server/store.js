// In-memory data store + Server-Sent-Events pub/sub.
import { randomUUID } from 'node:crypto';

export const store = {
  /** @type {Map<string, any>} sectionId -> { id, title, icon, kind, live, items, updatedAt, meta } */
  sections: new Map(),
  alerts: [],
  listeners: new Set(),
  version: 0,
};

const sourceStatus = new Map();

export function registerSection(def) {
  if (!store.sections.has(def.id)) {
    store.sections.set(def.id, { ...def, items: [], updatedAt: 0, meta: def.meta || {} });
  }
}

export function setItems(sectionId, items) {
  const s = store.sections.get(sectionId);
  if (!s) return;
  s.items = items;
  s.updatedAt = Date.now();
  store.version++;
  broadcast({ type: 'section', id: sectionId, section: exportSection(s) });
}

/** Update a section in place (used for simulated live jitter pulses). */
export function patchSection(sectionId, mutate) {
  const s = store.sections.get(sectionId);
  if (!s) return;
  mutate(s);
  s.updatedAt = Date.now();
  store.version++;
  broadcast({ type: 'section', id: sectionId, section: exportSection(s) });
}

export function pushAlert(alert) {
  const a = { id: randomUUID(), ts: Date.now(), ...alert };
  store.alerts.unshift(a);
  if (store.alerts.length > 40) store.alerts.length = 40;
  broadcast({ type: 'alert', alert: a });
}

export function setSourceStatus(id, status) {
  sourceStatus.set(id, { id, ...status });
}

export function getSourceStatus(id) {
  return sourceStatus.get(id);
}

export function allSourceStatuses() {
  return [...sourceStatus.values()];
}

function exportSection(s) {
  return {
    id: s.id,
    title: s.title,
    icon: s.icon,
    kind: s.kind,
    live: !!s.live,
    updatedAt: s.updatedAt,
    meta: s.meta,
    items: s.items,
  };
}

export function snapshot() {
  return {
    version: store.version,
    ts: Date.now(),
    sources: [...sourceStatus.values()],
    sections: [...store.sections.values()].map(exportSection),
    alerts: store.alerts,
  };
}

export function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const fn of store.listeners) {
    try { fn(data); } catch { /* listener gone */ }
  }
}

export function subscribe(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}
