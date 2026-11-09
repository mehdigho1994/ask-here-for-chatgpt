'use strict';

const KEY = 'askHereState';
const MAX_QUEUE = 8;
const POLL_MS = 250;

let state = {
  workerTabId: null,
  workerWindowId: null,
  workerReady: false,
  workerJobId: null,
  workerSourceUrl: null,
  queue: [],
  current: null,
  pendingResult: null
};

let opening = Promise.resolve();
let delivery = Promise.resolve(true);
let pollTimer = null;
let lastPolledHtml = '';
let pollStartedAt = 0;

const ready = chrome.storage.session
  .get(KEY)
  .then((r) => { if (r && r[KEY]) state = Object.assign(state, r[KEY]); })
  .catch(() => {});
const save = () => chrome.storage.session.set({ [KEY]: state }).catch(() => {});

function notify(req, payload) {
  if (!req) return Promise.resolve(false);
  return chrome.tabs
    .sendMessage(
      req.sourceTabId,
      { ...payload, type: 'NOTE_UPDATE', requestId: req.requestId },
      { frameId: 0 }
    )
    .then(() => true)
    .catch(() => false);
}

function stopPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastPolledHtml = '';
  pollStartedAt = 0;
}

async function focusSource(req) {
  if (!req || req.sourceTabId == null) return;
  try {
    const tab = await chrome.tabs.get(req.sourceTabId);
    if (tab.windowId != null) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) { /* ignore */ }
    }
    await chrome.tabs.update(req.sourceTabId, { active: true });
  } catch (e) { /* source gone */ }
}

async function removeWorker() {
  const tabId = state.workerTabId;
  const winId = state.workerWindowId;
  state.workerTabId = null;
  state.workerWindowId = null;
  state.workerReady = false;
  state.workerJobId = null;
  state.workerSourceUrl = null;
  await save();
  if (tabId != null) {
    try { await chrome.tabs.remove(tabId); } catch (e) { /* ignore */ }
  }
  if (winId != null) {
    try { await chrome.windows.remove(winId); } catch (e) { /* ignore */ }
  }
}

async function finishCurrent(status, payload) {
  const c = state.current;
  if (!c) return;
  stopPoll();

  let delivered = true;
  if (status === 'done') {
    delivery = delivery.catch(() => false).then((prev) =>
      prev === false ? false : notify(c, { ...payload, status: 'done' })
    );
    delivered = await delivery;
  } else {
    await notify(c, { ...payload, status });
  }

  await focusSource(c);
  state.current = null;
  state.workerJobId = null;

  if (status === 'done' && delivered) {
    // Answer delivered to sticky — close the temporary helper tab.
    await removeWorker();
  } else {
    if (status === 'done' && !delivered) {
      state.pendingResult = { ...c, html: payload.html, completedAt: Date.now() };
      await notify(c, { status: 'error', error: 'NOTE_DELIVERY_FAILED' });
      // Keep helper open so the user can recover / see the answer.
      await save();
    } else {
      await save();
    }
  }
  processNext();
}

async function pollWorkerOnce() {
  const c = state.current;
  if (!c || state.workerTabId == null) {
    stopPoll();
    return;
  }
  if (!pollStartedAt) pollStartedAt = Date.now();

  let snap = null;
  try {
    snap = await chrome.tabs.sendMessage(
      state.workerTabId,
      { type: 'SNAPSHOT_ANSWER', requestId: c.requestId },
      { frameId: 0 }
    );
  } catch (e) {
    return;
  }
  if (!snap || snap.requestId !== c.requestId) return;

  // Done/error first — avoids a late "streaming" notify overwriting a cleared status.
  if ((snap.done || snap.phase === 'done') && snap.html) {
    await finishCurrent('done', { html: snap.html });
    return;
  }
  if (snap.error || snap.phase === 'error') {
    await finishCurrent('error', { error: snap.error || 'NO_RESPONSE' });
    return;
  }

  // Live updates while writing (do not use snap.started alone — it stays true after done).
  if (snap.phase === 'started' || snap.phase === 'streaming' || snap.generating) {
    if (snap.html && snap.html !== lastPolledHtml) {
      lastPolledHtml = snap.html;
      delivery = delivery.catch(() => true).then(() =>
        notify(c, { status: 'streaming', html: snap.html, phase: snap.phase || 'streaming' })
      );
      await delivery;
    } else if (snap.phase === 'started') {
      notify(c, { status: 'waiting', phase: 'started' });
    }
  }
}

function startPoll() {
  if (pollTimer != null) return;
  pollStartedAt = Date.now();
  pollTimer = setInterval(() => { pollWorkerOnce().catch(() => {}); }, POLL_MS);
  pollWorkerOnce().catch(() => {});
}

function sameConversation(aUrl, bUrl) {
  try {
    const a = new URL(aUrl);
    const b = new URL(bUrl);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch (e) {
    return false;
  }
}

async function openWorker(req, prepareOnly = false) {
  const workerUrl = req.sourceUrl || 'https://chatgpt.com/';

  if (state.workerTabId != null) {
    let tab = null;
    try { tab = await chrome.tabs.get(state.workerTabId); } catch (e) { tab = null; }
    if (tab && sameConversation(tab.url, workerUrl)) {
      await focusSource(req);
      if (!prepareOnly && state.current && state.workerReady &&
          state.workerJobId !== state.current.requestId) {
        state.workerJobId = state.current.requestId;
        await save();
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'START_JOB',
            job: { requestId: state.current.requestId, text: state.current.text }
          });
        } catch (e) { /* not ready */ }
      }
      return;
    }
    await removeWorker();
  }

  // Fast path: background pinned tab (not activated). Avoids slow extra windows.
  const opts = { url: workerUrl, active: false, pinned: true };
  try {
    const src = await chrome.tabs.get(req.sourceTabId);
    opts.windowId = src.windowId;
  } catch (e) { /* ignore */ }
  const t = await chrome.tabs.create(opts);
  state.workerTabId = t.id;
  state.workerWindowId = null;
  state.workerReady = false;
  state.workerJobId = null;
  state.workerSourceUrl = workerUrl;
  await save();
  await focusSource(req);
}

function processNext() {
  if (state.current || !state.queue.length) return;
  const req = state.queue.shift();
  state.current = req;
  notify(req, { status: 'loading' });
  const prev = opening;
  opening = (async () => {
    await prev.catch(() => {});
    await save();
    try {
      await openWorker(req);
    } catch (e) {
      await notify(req, { status: 'error', error: 'OPEN_FAILED' });
      state.current = null;
      await save();
      processNext();
    }
  })();
}

async function handle(msg, sender) {
  await ready;
  switch (msg && msg.type) {
    case 'ASK': {
      if (!sender.tab) return { ok: false };
      if (state.queue.length >= MAX_QUEUE) return { ok: false, error: 'QUEUE_FULL' };
      const req = {
        requestId: msg.requestId,
        text: String(msg.text || ''),
        sourceTabId: sender.tab.id,
        sourceUrl: sender.tab.url
      };
      state.queue.push(req);
      await save();
      if (state.current) notify(req, { status: 'queued' });
      processNext();
      return { ok: true };
    }

    case 'PREPARE': {
      if (!sender.tab || state.current || state.queue.length) return { ok: false };
      const req = { sourceTabId: sender.tab.id, sourceUrl: sender.tab.url };
      const prev = opening;
      opening = (async () => {
        await prev.catch(() => {});
        await openWorker(req, true);
      })().catch(() => {});
      return { ok: true };
    }

    case 'HELLO': {
      await opening;
      if (sender.tab && sender.tab.id === state.workerTabId) {
        state.workerReady = true;
        const c = state.current;
        if (c) state.workerJobId = c.requestId;
        await save();
        if (c) await focusSource(c);
        return {
          worker: true,
          job: c ? { requestId: c.requestId, text: c.text } : null
        };
      }
      return { worker: false };
    }

    case 'PROGRESS': {
      const c = state.current;
      if (!c || c.requestId !== msg.requestId) return {};
      if (!sender.tab || sender.tab.id !== state.workerTabId) return {};

      if (msg.status === 'done') {
        await finishCurrent('done', { html: msg.html });
        return {};
      }
      if (msg.status === 'error') {
        await finishCurrent('error', { error: msg.error });
        return {};
      }

      if (msg.status === 'streaming' && msg.html) {
        delivery = delivery.catch(() => true).then(() =>
          notify(c, { status: 'streaming', html: msg.html })
        );
        await delivery;
      } else {
        notify(c, { status: msg.status, html: msg.html, error: msg.error });
      }

      // Keep the user on the sticky tab; never activate the helper.
      if (msg.status === 'typing' || msg.status === 'waiting') {
        await focusSource(c);
      }
      if (msg.status === 'waiting' || msg.status === 'streaming' || msg.status === 'typing') {
        startPoll();
      }
      return {};
    }

    case 'CANCEL': {
      stopPoll();
      state.queue = state.queue.filter((r) => r.requestId !== msg.requestId);
      if (state.current && state.current.requestId === msg.requestId) {
        state.current = null;
      }
      await save();
      processNext();
      return {};
    }

    case 'GET_PENDING_RESULT': {
      if (!sender.tab) return { result: null };
      const p = state.pendingResult;
      if (!p || p.sourceTabId !== sender.tab.id) return { result: null };
      return { result: { requestId: p.requestId, html: p.html, status: 'done' } };
    }

    case 'ACK_PENDING_RESULT': {
      if (state.pendingResult && sender.tab &&
          state.pendingResult.sourceTabId === sender.tab.id &&
          state.pendingResult.requestId === msg.requestId) {
        state.pendingResult = null;
        await save();
      }
      return {};
    }
  }
  return {};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((res) => sendResponse(res || {}))
    .catch(() => sendResponse({}));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  let changed = false;
  if (tabId === state.workerTabId) {
    stopPoll();
    state.workerTabId = null;
    state.workerWindowId = null;
    state.workerReady = false;
    state.workerJobId = null;
    state.workerSourceUrl = null;
    if (state.current) {
      notify(state.current, { status: 'error', error: 'WORKER_CLOSED' });
      state.current = null;
    }
    changed = true;
  }
  if (state.current && state.current.sourceTabId === tabId) {
    stopPoll();
    state.current = null;
    changed = true;
  }
  const before = state.queue.length;
  state.queue = state.queue.filter((r) => r.sourceTabId !== tabId);
  if (state.queue.length !== before) changed = true;
  if (changed) {
    await save();
    processNext();
  }
});
