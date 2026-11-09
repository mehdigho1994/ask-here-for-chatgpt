(() => {
  'use strict';
  if (window.__askHereV21) return;
  window.__askHereV21 = true;

  const CFG = window.ASK_HERE_CFG;
  const T = CFG.text;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const q = (sels, root = document) => {
    for (const sel of sels) {
      try { const el = root.querySelector(sel); if (el) return el; } catch (e) { /* ignore */ }
    }
    return null;
  };
  const qa = (sels, root = document) => {
    const out = [];
    const seen = new Set();
    for (const sel of sels) {
      try {
        for (const el of root.querySelectorAll(sel)) {
          if (!seen.has(el)) { seen.add(el); out.push(el); }
        }
      } catch (e) { /* ignore */ }
    }
    return out;
  };

  let isWorker = false;
  let watchState = null;

  /* ===================== sanitize ===================== */
  const ALLOWED = new Set([
    'P', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'DEL',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY',
    'TR', 'TH', 'TD', 'A', 'BR', 'HR', 'SPAN', 'DIV', 'SUP', 'SUB'
  ]);
  const DROP = new Set([
    'SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'INPUT',
    'TEXTAREA', 'SELECT', 'IMG', 'CANVAS', 'VIDEO', 'AUDIO', 'NOSCRIPT', 'TEMPLATE'
  ]);

  function sanitizeToFragment(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const out = document.createDocumentFragment();
    const walk = (node, parent) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          parent.appendChild(document.createTextNode(child.nodeValue));
        } else if (child.nodeType === 1) {
          const tag = child.tagName.toUpperCase();
          if (DROP.has(tag)) continue;
          if (!ALLOWED.has(tag)) { walk(child, parent); continue; }
          const el = document.createElement(tag.toLowerCase());
          if (tag === 'A') {
            const href = child.getAttribute('href') || '';
            if (/^https?:\/\//i.test(href)) {
              el.setAttribute('href', href);
              el.setAttribute('target', '_blank');
              el.setAttribute('rel', 'noopener noreferrer');
            }
          }
          walk(child, el);
          parent.appendChild(el);
        }
      }
    };
    walk(doc.body, out);
    return out;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function textToHtml(text) {
    const parts = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return '';
    return parts.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  /* ===================== Shadow UI (source tab only) ===================== */
  const host = document.createElement('div');
  host.id = 'ask-here-host';
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ask-btn {
      position: fixed; display: none; z-index: 2; padding: 7px 13px;
      border: 1px solid rgba(20,18,15,.12); border-radius: 999px;
      background: #14120f; color: #f7f1e8; cursor: pointer; white-space: nowrap;
      font: 600 12.5px/1 "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 6px 18px rgba(20,18,15,.28);
    }
    .ask-btn:hover { background: #2a241e; }
    .ask-compose {
      position: fixed; display: none; z-index: 3; width: 340px; max-width: calc(100vw - 24px);
      padding: 14px; border: 1px solid #e6dfd4; border-radius: 14px;
      background: linear-gradient(180deg, #fffdf9 0%, #f7f1e8 100%);
      color: #14120f; box-shadow: 0 16px 40px rgba(20,18,15,.22);
      font: 13.5px/1.5 "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
    }
    .ask-compose textarea {
      display: block; width: 100%; min-height: 76px; max-height: 180px; resize: vertical;
      padding: 10px 11px; border: 1px solid #ddd4c6; border-radius: 10px; outline: none;
      color: #14120f; background: #fff; font: inherit; unicode-bidi: plaintext;
    }
    .ask-compose textarea:focus { border-color: #c45c26; box-shadow: 0 0 0 3px rgba(196,92,38,.15); }
    .ask-compose .selected-preview {
      max-height: 52px; overflow: auto; margin: 0 0 10px; color: #6b645c;
      font-size: 12px; unicode-bidi: plaintext;
    }
    .ask-compose .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .ask-compose button {
      border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer;
      font: 600 12.5px "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
    }
    .ask-compose .submit { background: #14120f; color: #f7f1e8; }
    .ask-compose .submit:hover { background: #2a241e; }
    .ask-compose .cancel { background: #ebe4d8; color: #3d372f; }
    .note {
      position: fixed; z-index: 1; display: flex; flex-direction: column;
      width: 390px; max-width: calc(100vw - 24px); min-width: 260px; max-height: 70vh;
      background: #fffdf8; color: #1c1915;
      border: 1px solid #e4dccf; border-radius: 14px;
      box-shadow: 0 18px 44px rgba(20,18,15,.22), 0 1px 0 rgba(255,255,255,.7) inset;
      font: 14px/1.65 "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
      resize: both; overflow: hidden;
    }
    .note.collapsed { resize: none; height: auto !important; }
    .note.collapsed .body, .note.collapsed .status { display: none; }
    .hdr {
      display: flex; align-items: center; gap: 6px; padding: 9px 10px 9px 14px;
      background: #14120f; color: #f4efe6; cursor: grab; user-select: none; touch-action: none;
    }
    .hdr:active { cursor: grabbing; }
    .title {
      flex: 1; min-width: 0; font-weight: 650; font-size: 12.5px;
      letter-spacing: 0.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .hdr button {
      all: unset; cursor: pointer; width: 26px; height: 26px; line-height: 26px;
      text-align: center; border-radius: 7px; font-size: 14px; color: #f4efe6;
    }
    .hdr button:hover { background: rgba(255,255,255,.12); }
    .status {
      padding: 8px 14px 0; font-size: 12px; color: #6b645c;
    }
    .status.live { color: #c45c26; font-weight: 600; }
    .status.live::before { content: ""; display: inline-block; width: 7px; height: 7px;
      margin-inline-end: 7px; border-radius: 50%; background: currentColor;
      vertical-align: 1px; animation: pulse 1s infinite; }
    .status.err { color: #a32020; opacity: 1; font-weight: 600; }
    @keyframes pulse { 50% { opacity: .25; } }
    .body { padding: 8px 16px 16px; overflow: auto; flex: 1; min-height: 0; }
    .body p, .body li, .body h1, .body h2, .body h3, .body h4, .body blockquote { unicode-bidi: plaintext; }
    .body p { margin: 0 0 .7em; }
    .body ul, .body ol { margin: 0 0 .7em; padding-inline-start: 1.4em; }
    .body h1, .body h2, .body h3, .body h4 { margin: .8em 0 .4em; font-size: 1.05em; }
    .body blockquote { margin: 0 0 .7em; padding-inline-start: 10px; border-inline-start: 3px solid #d8cebf; color: #4a433b; }
    .body a { color: #9a4418; }
    .body code { font: 12.5px/1.5 ui-monospace, Consolas, monospace; background: #f0e9dc; padding: 1px 4px; border-radius: 4px; }
    .body pre { direction: ltr; text-align: left; unicode-bidi: normal; margin: 0 0 .8em; padding: 10px 12px; overflow: auto; background: #f0e9dc; border-radius: 8px; }
    .body pre code { background: none; padding: 0; }
    .body table { border-collapse: collapse; margin: 0 0 .8em; font-size: 13px; }
    .body th, .body td { border: 1px solid #d8cebf; padding: 4px 8px; }
  `;
  shadow.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'ask-btn';
  btn.type = 'button';
  btn.textContent = T.button;
  shadow.appendChild(btn);

  const askBox = document.createElement('div');
  askBox.className = 'ask-compose';
  askBox.innerHTML =
    '<div class="selected-preview"></div>' +
    '<textarea dir="auto" placeholder="Ask anything about the selected text…"></textarea>' +
    '<div class="actions"><button class="cancel" type="button">Cancel</button>' +
    '<button class="submit" type="button">Ask here</button></div>';
  shadow.appendChild(askBox);

  function mountHost() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  mountHost();

  function hideUi() {
    btn.style.display = 'none';
    askBox.style.display = 'none';
    host.style.display = 'none';
  }

  /* ---------- selection → Ask here (source only) ---------- */
  let pendingText = '';
  let pendingRect = null;
  let btnVisible = false;

  function hideAskBox() { askBox.style.display = 'none'; }
  function hideBtn() { btn.style.display = 'none'; btnVisible = false; }

  function showAskBox(text, rect) {
    askBox.querySelector('.selected-preview').textContent =
      text.replace(/\s+/g, ' ').slice(0, 180) + (text.length > 180 ? '…' : '');
    askBox.querySelector('textarea').value = '';
    askBox.style.display = 'block';
    const w = Math.min(340, window.innerWidth - 24);
    askBox.style.left = clamp(rect ? rect.left : 20, 12, Math.max(12, window.innerWidth - w - 12)) + 'px';
    askBox.style.top = clamp(rect ? rect.bottom + 10 : 80, 12, Math.max(12, window.innerHeight - 190)) + 'px';
    setTimeout(() => askBox.querySelector('textarea').focus(), 0);
  }

  function inEditable(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
  }

  function findNativeAsk() {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      const t = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (t && t.length < 30 && CFG.nativeAskButtonText.test(t)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return r;
      }
    }
    return null;
  }

  function positionBtn(anchor) {
    const bw = btn.offsetWidth || 80;
    const bh = btn.offsetHeight || 28;
    const native = findNativeAsk();
    let x, y;
    if (native) {
      x = native.right + 6;
      y = native.top + (native.height - bh) / 2;
      if (x + bw > window.innerWidth - 8) x = native.left - bw - 6;
    } else {
      x = anchor.right + 6;
      y = anchor.bottom + 6;
    }
    btn.style.left = clamp(x, 8, window.innerWidth - bw - 8) + 'px';
    btn.style.top = clamp(y, 8, window.innerHeight - bh - 8) + 'px';
  }

  function onSelectionEvent(e) {
    if (isWorker) return;
    if (e && e.composedPath && e.composedPath().includes(host)) return;
    setTimeout(() => {
      if (isWorker) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!sel || !sel.rangeCount || !text || inEditable(sel.anchorNode)) {
        hideBtn();
        return;
      }
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      const anchor = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      mountHost();
      pendingText = text.slice(0, CFG.maxSelectionChars);
      pendingRect = anchor;
      // Warm the hidden helper tab while the user types their question.
      try { chrome.runtime.sendMessage({ type: 'PREPARE' }).catch(() => {}); } catch (e) {}
      btn.style.display = 'block';
      btnVisible = true;
      positionBtn(anchor);
      for (const d of [150, 450]) {
        setTimeout(() => { if (btnVisible && !isWorker) positionBtn(anchor); }, d);
      }
    }, 10);
  }

  document.addEventListener('mouseup', onSelectionEvent, true);
  document.addEventListener('keyup', onSelectionEvent, true);
  document.addEventListener('mousedown', (e) => {
    if (isWorker) return;
    if (e.composedPath && e.composedPath().includes(host)) return;
    hideBtn();
    if (askBox.style.display !== 'none') hideAskBox();
  }, true);

  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = pendingText;
    const rect = pendingRect;
    hideBtn();
    if (text) showAskBox(text, rect);
  });
  askBox.querySelector('.cancel').addEventListener('click', hideAskBox);
  askBox.querySelector('.submit').addEventListener('click', () => {
    const question = askBox.querySelector('textarea').value.trim();
    const text = pendingText;
    const rect = pendingRect;
    hideAskBox();
    if (text) startAsk(text, rect, question);
  });
  askBox.querySelector('textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      askBox.querySelector('.submit').click();
    }
    if (e.key === 'Escape') hideAskBox();
  });

  /* ---------- sticky notes ---------- */
  const notes = new Map();

  function createNote(id, titleText, rect) {
    mountHost();
    host.style.display = '';
    const el = document.createElement('div');
    el.className = 'note';
    el.innerHTML =
      '<div class="hdr"><span class="title"></span>' +
      '<button class="copy" title="Copy">⧉</button>' +
      '<button class="min" title="Minimize">–</button>' +
      '<button class="close" title="Close">✕</button></div>' +
      '<div class="status live"></div><div class="body" dir="auto"></div>';
    const title = el.querySelector('.title');
    const status = el.querySelector('.status');
    const body = el.querySelector('.body');
    title.textContent = String(titleText || '').replace(/\s+/g, ' ').slice(0, 80);
    title.title = String(titleText || '').slice(0, 300);

    const w = Math.min(380, window.innerWidth - 24);
    const offset = notes.size * 18;
    let left = rect ? rect.left : window.innerWidth - w - 24;
    let top = rect ? rect.bottom + 14 : 80;
    left = clamp(left + offset, 12, Math.max(12, window.innerWidth - w - 12));
    top = clamp(top + offset, 12, Math.max(12, window.innerHeight - 240));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = w + 'px';
    shadow.appendChild(el);

    const hdr = el.querySelector('.hdr');
    hdr.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      hdr.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.left = clamp(ev.clientX - dx, 0, window.innerWidth - 60) + 'px';
        el.style.top = clamp(ev.clientY - dy, 0, window.innerHeight - 30) + 'px';
      };
      const up = () => {
        hdr.removeEventListener('pointermove', move);
        hdr.removeEventListener('pointerup', up);
      };
      hdr.addEventListener('pointermove', move);
      hdr.addEventListener('pointerup', up);
    });

    el.querySelector('.min').addEventListener('click', () => el.classList.toggle('collapsed'));
    el.querySelector('.close').addEventListener('click', () => {
      el.remove();
      notes.delete(id);
      try { chrome.runtime.sendMessage({ type: 'CANCEL', requestId: id }).catch(() => {}); } catch (e) {}
    });
    el.querySelector('.copy').addEventListener('click', () => {
      const t = body.innerText || '';
      if (t) navigator.clipboard.writeText(t).catch(() => {});
    });

    const setStatus = (text, live, err) => {
      status.textContent = text || '';
      status.style.display = text ? '' : 'none';
      status.classList.toggle('live', !!live);
      status.classList.toggle('err', !!err);
    };
    setStatus(T.queued, true);

    const api = {
      setError(code) {
        setStatus(T.errors[code] || String(code || 'Error'), false, true);
      },
      update(msg) {
        if (msg.html != null && msg.html !== '') {
          const st = body.scrollTop;
          body.replaceChildren(sanitizeToFragment(msg.html));
          body.scrollTop = st;
        }
        switch (msg.status) {
          case 'queued': setStatus(T.queued, true); break;
          case 'loading': setStatus(T.loading, true); break;
          case 'typing': setStatus(T.typing, true); break;
          case 'waiting': setStatus(T.waiting, true); break;
          case 'streaming': setStatus(T.streaming, true); break;
          case 'done': setStatus('', false); break;
          case 'error': api.setError(msg.error); break;
        }
      }
    };
    notes.set(id, api);
    return api;
  }

  function startAsk(selectedText, rect, question) {
    const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    const prompt = question
      ? `${question}\n\n${selectedText}`
      : selectedText;
    const note = createNote(requestId, question || selectedText, rect);
    try {
      chrome.runtime.sendMessage({ type: 'ASK', requestId, text: prompt })
        .then((res) => {
          if (res && res.ok === false) note.setError(res.error || 'OPEN_FAILED');
        })
        .catch(() => note.setError('RELOAD'));
    } catch (e) {
      note.setError('RELOAD');
    }
  }

  /* ===================== ChatGPT DOM (worker) ===================== */
  function waitFor(check, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        obs.disconnect();
        clearInterval(iv);
        clearTimeout(to);
        resolve(v);
      };
      const tick = () => {
        try { const v = check(); if (v) finish(v); } catch (e) { /* retry */ }
      };
      const obs = new MutationObserver(tick);
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const iv = setInterval(tick, 120);
      const to = setTimeout(() => finish(null), timeoutMs);
      tick();
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  }

  function findPromptInput() {
    for (const sel of CFG.input) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el) || el.disabled) continue;
        if (el.matches('input, textarea') || el.getAttribute('role') === 'textbox' ||
            el.id === 'prompt-textarea' || el.getAttribute('contenteditable') === 'true') {
          return el;
        }
      }
    }
    return null;
  }

  function readBox(box) {
    if (!box) return '';
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') return box.value || '';
    return box.innerText || box.textContent || '';
  }

  function fireInput(box, data, inputType = 'insertText') {
    try {
      box.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType, data: data == null ? null : String(data)
      }));
    } catch (e) { /* ignore */ }
    try {
      box.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType, data: data == null ? null : String(data)
      }));
    } catch (e) {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function findPmView(box) {
    let el = box;
    for (let i = 0; i < 6 && el; i++) {
      if (el.pmViewDesc && el.pmViewDesc.view) return el.pmViewDesc.view;
      for (const k of Object.keys(el)) {
        if (!k.startsWith('__reactFiber$') && !k.startsWith('__reactInternalInstance$')) continue;
        let fiber = el[k];
        for (let d = 0; d < 25 && fiber; d++) {
          const sn = fiber.stateNode;
          if (sn && sn.pmViewDesc && sn.pmViewDesc.view) return sn.pmViewDesc.view;
          if (fiber.memoizedProps && fiber.memoizedProps.editorView) return fiber.memoizedProps.editorView;
          if (fiber.memoizedProps && fiber.memoizedProps.view) return fiber.memoizedProps.view;
          fiber = fiber.return;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function setViaPm(box, text) {
    const view = findPmView(box);
    if (!view || !view.state || !view.dispatch) return false;
    try {
      const size = view.state.doc.content.size;
      let tr = view.state.tr;
      if (size > 2) tr = tr.delete(1, size - 1);
      tr = tr.insertText(String(text), 1);
      view.dispatch(tr);
      view.focus();
      return norm(view.state.doc.textContent) === norm(text) || norm(readBox(box)) === norm(text);
    } catch (e) {
      return false;
    }
  }

  function syncHidden(text) {
    const hidden = document.querySelector('textarea[name="prompt-textarea"]');
    if (!hidden) return;
    try {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(hidden, text);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* ignore */ }
  }

  async function setPrompt(box, text) {
    const wanted = norm(text);
    const ok = () => norm(readBox(box)) === wanted;
    for (let attempt = 0; attempt < 3; attempt++) {
      box.focus();
      if (box.tagName === 'TEXTAREA') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text);
        fireInput(box, text);
      } else if (!setViaPm(box, text)) {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        if (!document.execCommand('insertText', false, text) || !ok()) {
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            fireInput(box, text, 'insertFromPaste');
          } catch (e) {
            box.textContent = text;
            fireInput(box, text);
          }
        }
        syncHidden(text);
      } else {
        syncHidden(text);
      }
      await sleep(60);
      if (ok()) return;
    }
    if (!ok()) throw new Error('PROMPT_INSERT_FAILED');
  }

  function controlLabel(b) {
    return [
      b.getAttribute('aria-label'), b.getAttribute('data-testid'),
      b.getAttribute('title'), b.id, b.textContent
    ].join(' ').toLowerCase();
  }

  function scoreSend(b, box) {
    const label = controlLabel(b);
    if (/stop|cancel|attach|upload|voice|dictat|mic|speech|plus|menu|model|think|search|photo|image|file/.test(label)) {
      return -1;
    }
    let score = 0;
    if (/send|submit|composer-send|composer-submit/.test(label)) score += 12;
    if (b.id === 'composer-submit-button') score += 12;
    if ((b.getAttribute('data-testid') || '') === 'send-button') score += 12;
    if (b.type === 'submit') score += 5;
    if (b.querySelector('svg')) score += 2;
    const r = b.getBoundingClientRect();
    if (r.width >= 24 && r.width <= 56 && Math.abs(r.width - r.height) < 10) score += 3;
    if (box) {
      const br = box.getBoundingClientRect();
      if (Math.abs(r.top - br.bottom) < 140 || (r.top >= br.top - 40 && r.bottom <= br.bottom + 140)) {
        score += 4;
        if (r.right >= br.right - 120) score += 6;
      }
    }
    return score;
  }

  function isEnabled(b) {
    if (!isVisible(b)) return false;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function findSendButton(box, allowDisabled = false) {
    const ok = allowDisabled ? isVisible : isEnabled;
    const pick = (list) => {
      const scored = list.filter(ok)
        .map((b) => ({ b, score: scoreSend(b, box) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.b.getBoundingClientRect().left - a.b.getBoundingClientRect().left);
      return scored.length ? scored[0].b : null;
    };
    let found = pick(qa(CFG.sendButton));
    if (found) return found;

    const footer = (box && (
      box.closest('[data-composer-footer-responsive]') ||
      box.closest('[class*="ComposerLayoutFooter"]') ||
      box.closest('form')
    )) || document.querySelector('[data-composer-footer-responsive]') ||
      document.querySelector('[class*="ComposerLayoutFooter"]');

    if (footer) {
      const btns = Array.from(footer.querySelectorAll('button, [role="button"]'));
      found = pick(btns);
      if (found) return found;
      const circular = btns.filter(ok).filter((b) => {
        const r = b.getBoundingClientRect();
        return b.querySelector('svg') && r.width >= 24 && r.width <= 56 &&
          Math.abs(r.width - r.height) < 10 &&
          !/think|mic|voice|speech|dictat|attach|plus|stop/i.test(controlLabel(b));
      }).sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
      if (circular.length) return circular[0];
    }
    return null;
  }

  function reactClick(el) {
    let node = el;
    for (let depth = 0; depth < 6 && node; depth++) {
      const pk = Object.keys(node).find((k) => k.startsWith('__reactProps$'));
      if (pk && node[pk] && typeof node[pk].onClick === 'function') {
        try {
          node[pk].onClick({
            type: 'click', target: node, currentTarget: node, bubbles: true, cancelable: true,
            preventDefault() {}, stopPropagation() {}, nativeEvent: { isTrusted: true }
          });
          return true;
        } catch (e) { /* continue */ }
      }
      node = node.parentElement;
    }
    return false;
  }

  function clickEl(el) {
    if (!el) return;
    try {
      el.removeAttribute('aria-disabled');
      if (el.disabled) el.disabled = false;
    } catch (e) { /* ignore */ }
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0
    };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    try { el.click(); } catch (e) { /* ignore */ }
    reactClick(el);
  }

  /** True while ChatGPT shows the composer Stop control (= reply in progress). */
  function hasStopButton() {
    const scope = document.querySelector('[data-composer-footer-responsive]') ||
      document.querySelector('form') ||
      document.querySelector('[data-chatgpt-composer]') ||
      document.querySelector('[class*="Composer"]') ||
      document;
    return qa(CFG.stopButton, scope).some((b) => {
      if (!isEnabled(b)) return false;
      const r = b.getBoundingClientRect();
      // Composer lives in the lower part of the viewport.
      return r.width > 0 && r.height > 0 && r.top > window.innerHeight * 0.35;
    });
  }

  function isGenerating() {
    return hasStopButton();
  }

  async function submitPrompt(box) {
    const sent = () => isGenerating() || !norm(readBox(box));
    let sendBtn = findSendButton(box) || await waitFor(() => findSendButton(box), 2500);
    if (!sendBtn) sendBtn = findSendButton(box, true);

    if (sendBtn) {
      clickEl(sendBtn);
      await sleep(180);
      if (sent()) return true;
    }

    const form = box.closest('form');
    if (form && form.requestSubmit) {
      try { form.requestSubmit(sendBtn || undefined); } catch (e) {
        try { form.requestSubmit(); } catch (e2) { /* ignore */ }
      }
      await sleep(160);
      if (sent()) return true;
    }

    const view = findPmView(box);
    if (view) {
      try {
        view.focus();
        const ev = new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, composed: true,
          key: 'Enter', code: 'Enter', which: 13, keyCode: 13
        });
        if (typeof view.someProp === 'function') view.someProp('handleKeyDown', (f) => f(view, ev));
        else if (view.dom) view.dom.dispatchEvent(ev);
      } catch (e) { /* ignore */ }
      await sleep(160);
      if (sent()) return true;
    }

    box.focus();
    box.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, composed: true,
      key: 'Enter', code: 'Enter', which: 13, keyCode: 13
    }));
    await sleep(180);
    return sent();
  }

  /* ---------- answer capture ---------- */
  function assistantTurns() {
    const found = [];
    const seen = new Set();
    for (const sel of CFG.assistantMessage) {
      for (const el of document.querySelectorAll(sel)) {
        // h4[data-conversation-role=assistant] → climb to the search-unit root.
        let node = el;
        if (el.matches && el.matches('h4[data-conversation-role="assistant"]')) {
          node = el.closest('[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]') ||
            el.parentElement || el;
        }
        if (seen.has(node)) continue;
        if (node.closest && node.closest(
          '[data-chatgpt-search-unit-key$=":user"], [data-message-author-role="user"], [data-message-author-role="system"]'
        )) continue;
        if (found.some((o) => o.contains(node))) continue;
        for (let i = found.length - 1; i >= 0; i--) {
          if (node.contains(found[i])) found.splice(i, 1);
        }
        seen.add(node);
        found.push(node);
      }
    }
    found.sort((a, b) => {
      const p = a.compareDocumentPosition(b);
      if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return found;
  }

  function turnId(el) {
    if (!el) return '';
    const ids = el.getAttribute('data-chatgpt-search-message-ids') ||
      el.getAttribute('data-chatgpt-selection-message-id') ||
      el.getAttribute('data-message-id') ||
      el.getAttribute('data-turn-id') ||
      el.getAttribute('data-turn-key') ||
      el.getAttribute('data-chatgpt-search-unit-key') ||
      '';
    if (ids) return ids.split(/\s+/)[0];
    const near = el.closest('[data-chatgpt-search-message-ids], [data-chatgpt-selection-message-id], [data-message-id], [data-turn-key], [data-chatgpt-search-unit-key]');
    if (near) {
      const v = near.getAttribute('data-chatgpt-search-message-ids') ||
        near.getAttribute('data-chatgpt-selection-message-id') ||
        near.getAttribute('data-message-id') ||
        near.getAttribute('data-turn-key') ||
        near.getAttribute('data-chatgpt-search-unit-key') || '';
      return v.split(/\s+/)[0];
    }
    return '';
  }

  function contentRoot(el) {
    if (!el) return null;
    const preferred = el.querySelector('[data-markdown-text-style="assistant-message"]') ||
      el.querySelector('[data-markdown-copy="contents"]') ||
      el.querySelector('[class*="MarkdownRoot"]');
    if (preferred) return preferred;
    const sel = (CFG.assistantContent || []).join(',');
    if (!sel) return el;
    try {
      if (el.matches(sel)) return el;
      return el.querySelector(sel) || el;
    } catch (e) {
      return el;
    }
  }

  function cleanAnswerText(s) {
    return norm(String(s || '')
      .replace(/^ChatGPT said:\s*/i, '')
      .replace(/^Latest response\s*/i, ''));
  }

  function serialize(el) {
    const src = contentRoot(el);
    if (!src) return '';
    const clone = src.cloneNode(true);
    clone.querySelectorAll(
      'button, h4, .sr-only, [data-testid*="thinking"], [data-testid*="reasoning"], ' +
      '[aria-label*="Thought" i], [class*="thinking"], [class*="reasoning"]'
    ).forEach((n) => n.remove());
    let html = clone.innerHTML;
    const text = cleanAnswerText(clone.innerText || clone.textContent || '');
    if (!html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length && text) html = textToHtml(text);
    return html;
  }

  function snapshotTurn(el) {
    const root = contentRoot(el) || el;
    let text = cleanAnswerText(root.innerText || root.textContent || '');
    if (!text) text = cleanAnswerText(el.innerText || el.textContent || '');
    return { el, id: turnId(el), text, html: serialize(el) || textToHtml(text) };
  }

  function hasDoneMarker(turnEl) {
    if (!turnEl) return false;
    // Copy buttons appear on the finished assistant turn (new UI).
    const scope = turnEl.closest('[data-turn-key], [data-chatgpt-search-unit-key], [data-content-search-unit-key]') || turnEl;
    return CFG.doneMarker.some((sel) => {
      try { return Array.from(scope.querySelectorAll(sel)).some(isVisible); } catch (e) { return false; }
    }) || CFG.doneMarker.some((sel) => {
      try { return Array.from(turnEl.querySelectorAll(sel)).some(isVisible); } catch (e) { return false; }
    });
  }

  function composerReadyAgain() {
    // After generation, Send comes back where Stop was.
    const box = findPromptInput();
    return !!findSendButton(box, true) && !hasStopButton();
  }

  function pickNewTurn(baseline, promptText) {
    // 1) Prefer the assistant turn that follows OUR just-sent user prompt.
    const after = findAssistantAfterPrompt(promptText);
    if (after) {
      const snap = snapshotTurn(after);
      if (snap && (snap.text || snap.html)) return snap;
      return snap;
    }

    const turns = assistantTurns().map(snapshotTurn);
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.id && !baseline.ids.has(t.id)) return t;
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.text && !baseline.texts.has(t.text)) return t;
    }
    if (turns.length > baseline.count) return turns[turns.length - 1];
    // While generating, keep tracking the newest assistant shell even if empty.
    if (isGenerating() && turns.length) return turns[turns.length - 1];
    return null;
  }

  function findUserTurnForPrompt(promptText) {
    const full = norm(promptText);
    if (!full) return null;
    const head = full.slice(0, 48);
    const mid = full.length > 80 ? full.slice(Math.floor(full.length / 2) - 24, Math.floor(full.length / 2) + 24) : '';
    const sels = CFG.userMessage || [
      '[data-chatgpt-search-unit-key$=":user"]',
      '[data-content-search-unit-key$=":user"]',
      '[data-message-author-role="user"]',
      '[data-turn="user"]'
    ];
    const nodes = qa(sels);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const t = norm(nodes[i].innerText || nodes[i].textContent || '');
      if (!t) continue;
      if (t.includes(head) || (mid && t.includes(mid)) || full.includes(t.slice(0, 48))) return nodes[i];
    }
    return null;
  }

  function findAssistantAfterPrompt(promptText) {
    const userEl = findUserTurnForPrompt(promptText);
    const turns = assistantTurns();
    if (!turns.length) return null;
    if (!userEl) return null;
    let best = null;
    for (const a of turns) {
      const pos = userEl.compareDocumentPosition(a);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = a;
    }
    return best;
  }

  async function waitForUserPrompt(promptText, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (findUserTurnForPrompt(promptText)) return true;
      if (isGenerating()) return true; // stream started even if user node lags
      await sleep(200);
    }
    return !!findUserTurnForPrompt(promptText);
  }

  /**
   * Professional answer lifecycle (verified against live ChatGPT DOM 2026-11):
   *   waiting   → no Stop yet, no assistant body
   *   started   → Stop appeared and/or assistant unit created
   *   streaming → answer text is growing → push html to sticky
   *   done      → Stop gone + (Copy visible | Send back) + text stable
   */
  function snapshotAnswer(requestId) {
    if (!watchState || watchState.requestId !== requestId) return null;
    if (watchState.finished) {
      return {
        requestId,
        phase: watchState.error ? 'error' : 'done',
        html: watchState.lastHtml || '',
        generating: false,
        started: true,
        done: !watchState.error && !!watchState.lastHtml,
        error: watchState.error || null
      };
    }

    const now = Date.now();
    const stopping = hasStopButton();
    const snap = pickNewTurn(watchState.baseline, watchState.promptText);

    // --- START ---
    if (stopping) {
      watchState.sawStop = true;
      watchState.phase = watchState.lastText ? 'streaming' : 'started';
      watchState.stopGoneAt = 0;
    } else if (watchState.sawStop && !watchState.stopGoneAt) {
      watchState.stopGoneAt = now;
    }

    if (snap) {
      if (!watchState.sawAssistant) watchState.sawAssistant = true;
      if (watchState.phase === 'waiting') watchState.phase = 'started';
    }

    // --- STREAMING (text growth) ---
    if (snap && snap.text && snap.text !== watchState.lastText) {
      watchState.lastHtml = snap.html || textToHtml(snap.text);
      watchState.lastText = snap.text;
      watchState.lastTurnEl = snap.el;
      watchState.lastChange = now;
      watchState.phase = 'streaming';
    } else if (snap && !watchState.lastHtml && (snap.html || snap.text)) {
      watchState.lastHtml = snap.html || textToHtml(snap.text);
      watchState.lastText = snap.text || '';
      watchState.lastTurnEl = snap.el;
      watchState.lastChange = now;
      watchState.phase = snap.text ? 'streaming' : 'started';
    } else if (snap && snap.el) {
      watchState.lastTurnEl = snap.el;
      if (snap.html) watchState.lastHtml = snap.html;
    }
    if (!watchState.lastHtml && watchState.lastText) {
      watchState.lastHtml = textToHtml(watchState.lastText);
    }

    const started = watchState.sawStop || watchState.sawAssistant || !!watchState.lastHtml;
    const stableFor = now - (watchState.lastChange || now);
    const doneMark = hasDoneMarker(watchState.lastTurnEl);
    const sendBack = composerReadyAgain();

    // --- DONE (never while Stop is visible) ---
    let done = false;
    let error = null;
    if (watchState.lastHtml && watchState.lastText && !stopping) {
      if (doneMark && stableFor > 350) done = true;
      else if (sendBack && stableFor > 450) done = true;
      else if (watchState.stopGoneAt && now - watchState.stopGoneAt > 500 && stableFor > 500) done = true;
      else if (stableFor > 1400 && (doneMark || sendBack || watchState.sawStop)) done = true;
      // Text stopped growing and Stop is gone — clear sticky "Writing…" even if Copy is missing.
      else if (stableFor > 1100) done = true;
    }

    if (!done && !watchState.lastHtml) {
      if (watchState.sawStop && !stopping && watchState.stopGoneAt && now - watchState.stopGoneAt > 12000) {
        error = 'NO_RESPONSE';
      } else if (!started && now - watchState.startedAt > 90000) {
        error = 'NO_RESPONSE';
      }
    }
    if (!done && !error && now - watchState.startedAt > 10 * 60 * 1000) {
      if (watchState.lastHtml) done = true;
      else error = 'TIMEOUT';
    }

    if (done) watchState.phase = 'done';
    if (error) watchState.phase = 'error';
    if (done || error) {
      watchState.finished = true;
      watchState.error = error;
    }

    return {
      requestId,
      phase: watchState.phase,
      html: watchState.lastHtml || '',
      generating: stopping,
      started,
      done: done && !!watchState.lastHtml,
      error
    };
  }

  function watchAnswer(requestId, baseline, send, promptText) {
    return new Promise((resolve) => {
      watchState = {
        requestId,
        baseline,
        promptText: promptText || '',
        phase: 'waiting',
        startedAt: Date.now(),
        lastHtml: '',
        lastText: '',
        lastChange: Date.now(),
        lastProgressSent: 0,
        lastPhaseSent: '',
        sawStop: false,
        sawAssistant: false,
        stopGoneAt: 0,
        finished: false,
        error: null,
        lastTurnEl: null,
        _closed: false
      };

      const finish = async (payload) => {
        if (watchState._closed) return;
        watchState._closed = true;
        watchState.finished = true;
        if (payload.status === 'error') watchState.error = payload.error;
        if (watchState.lastHtml && payload.status === 'done') payload.html = watchState.lastHtml;
        obs.disconnect();
        clearInterval(iv);
        await send(payload);
        resolve();
      };

      const check = () => {
        if (!watchState || watchState._closed) return;
        const snap = snapshotAnswer(requestId);
        if (!snap) return;

        // Emit phase transitions clearly for the sticky note.
        if (snap.phase !== watchState.lastPhaseSent) {
          watchState.lastPhaseSent = snap.phase;
          if (snap.phase === 'started') send({ status: 'waiting', phase: 'started' });
          if (snap.phase === 'streaming') send({ status: 'streaming', phase: 'streaming', html: snap.html || undefined });
        }

        // Live body while writing.
        if (snap.html && snap.phase === 'streaming') {
          const t = Date.now();
          if (t - watchState.lastProgressSent >= 100) {
            watchState.lastProgressSent = t;
            send({ status: 'streaming', phase: 'streaming', html: snap.html });
          }
        }

        if (snap.done && snap.html) return finish({ status: 'done', phase: 'done', html: snap.html });
        if (snap.error) return finish({ status: 'error', phase: 'error', error: snap.error });
      };

      const obs = new MutationObserver(check);
      obs.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true
      });
      const iv = setInterval(check, 200);
      check();
    });
  }

  async function runJob(job) {
    const { requestId, text } = job;
    const send = (p) => {
      try {
        return chrome.runtime.sendMessage({ type: 'PROGRESS', requestId, ...p }).catch(() => null);
      } catch (e) {
        return null;
      }
    };
    try {
      send({ status: 'typing' });
      const box = findPromptInput() || await waitFor(() => findPromptInput(), 45000);
      if (!box) { send({ status: 'error', error: 'NO_INPUT' }); return; }

      // Wait a beat for conversation history to hydrate before fingerprinting.
      await sleep(300);
      const baselineTurns = assistantTurns().map(snapshotTurn);
      const baseline = {
        texts: new Set(baselineTurns.map((t) => t.text).filter(Boolean)),
        ids: new Set(baselineTurns.map((t) => t.id).filter(Boolean)),
        count: baselineTurns.length
      };

      await setPrompt(box, text);
      let submitted = await submitPrompt(box);
      if (!submitted) {
        // One more try after a short settle — React sometimes enables Send late.
        await sleep(250);
        submitted = await submitPrompt(box);
      }
      if (!submitted) {
        send({ status: 'error', error: 'NO_SEND_BUTTON' });
        return;
      }

      // Confirm the prompt actually landed in the chat (not just cleared the box).
      const landed = await waitForUserPrompt(text, 12000);
      if (!landed) {
        await setPrompt(box, text);
        await submitPrompt(box);
        const landed2 = await waitForUserPrompt(text, 10000);
        if (!landed2 && !isGenerating()) {
          send({ status: 'error', error: 'NO_SEND_BUTTON' });
          return;
        }
      }

      send({ status: 'waiting' });
      await watchAnswer(requestId, baseline, send, text);
    } catch (e) {
      const message = String((e && e.message) || e);
      send({
        status: 'error',
        error: message === 'PROMPT_INSERT_FAILED' ? 'PROMPT_INSERT_FAILED' : message
      });
    }
  }

  /* ===================== messaging ===================== */
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'NOTE_UPDATE') {
        let n = notes.get(msg.requestId);
        if (!n && (msg.html || msg.status === 'done' || msg.status === 'streaming')) {
          n = createNote(msg.requestId, 'Answer', null);
        }
        if (n) n.update(msg);
      } else if (msg && msg.type === 'START_JOB' && msg.job) {
        if (isWorker) runJob(msg.job);
      } else if (msg && msg.type === 'SNAPSHOT_ANSWER') {
        sendResponse(snapshotAnswer(msg.requestId));
        return true;
      }
    });
  } catch (e) { /* ignore */ }

  try {
    chrome.runtime.sendMessage({ type: 'GET_PENDING_RESULT' }).then((res) => {
      const result = res && res.result;
      if (!result || isWorker) return;
      const note = createNote(result.requestId, 'Recovered answer', null);
      note.update(result);
      chrome.runtime.sendMessage({ type: 'ACK_PENDING_RESULT', requestId: result.requestId }).catch(() => {});
    }).catch(() => {});
  } catch (e) { /* ignore */ }

  try {
    chrome.runtime.sendMessage({ type: 'HELLO' })
      .then((res) => {
        if (res && res.worker) {
          isWorker = true;
          hideUi();
          if (res.job) runJob(res.job);
        }
      })
      .catch(() => {});
  } catch (e) { /* ignore */ }
})();
