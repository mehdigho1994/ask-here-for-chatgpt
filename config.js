// ChatGPT DOM selectors — Oct/Nov 2026 redesign.
// Old markers (data-message-author-role, data-turn, .markdown) are GONE.
window.ASK_HERE_CFG = {
  input: [
    '#prompt-textarea',
    '[data-composer-input] [contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'form [contenteditable="true"]',
    'textarea[name="prompt-textarea"]'
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send"]',
    'button[aria-label^="Send"]',
    '[data-composer-footer-responsive] button[type="submit"]',
    'form button[type="submit"]'
  ],
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[data-testid="stop-generating-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop generating response"]',
    'button[aria-label="Stop"]',
    'button[aria-label^="Stop"]'
  ],
  streamingIndicator: [
    '.result-streaming',
    '[data-is-streaming="true"]',
    '[aria-busy="true"]'
  ],
  // NEW ChatGPT turn markers (verified live 2026-11-09):
  //   user:      [data-chatgpt-search-unit-key$=":user"]
  //   assistant: [data-chatgpt-search-unit-key$=":assistant"]
  assistantMessage: [
    '[data-chatgpt-search-unit-key$=":assistant"]',
    '[data-content-search-unit-key$=":assistant"]',
    '[data-chatgpt-search-unit-key*=":assistant"]',
    'h4[data-conversation-role="assistant"]',
    // legacy fallbacks
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    'article[data-turn="assistant"]'
  ],
  userMessage: [
    '[data-chatgpt-search-unit-key$=":user"]',
    '[data-content-search-unit-key$=":user"]',
    'h4[data-conversation-role="user"]',
    '[data-message-author-role="user"]',
    '[data-turn="user"]'
  ],
  assistantContent: [
    '[data-markdown-text-style="assistant-message"]',
    '[data-markdown-copy="contents"]',
    '[class*="MarkdownRoot"]',
    '.markdown',
    '[class*="markdown"]',
    '.prose',
    '[class*="prose"]',
    '[data-message-content]',
    '.result-streaming'
  ],
  doneMarker: [
    'button[aria-label="Copy"]',
    'button[aria-label="Copy message"]',
    'button[aria-label="Copy response"]',
    'button[aria-label*="Copy" i]',
    'button[data-testid="copy-turn-action-button"]',
    'button[data-testid*="copy-turn"]',
    'button[data-testid="good-response-turn-action-button"]'
  ],
  nativeAskButtonText: /^\s*ask\s*(chat)?\s*gpt\s*$/i,
  maxSelectionChars: 20000,
  text: {
    button: 'Ask here',
    queued: 'Queued…',
    loading: 'Preparing…',
    typing: 'Sending question…',
    waiting: 'Waiting for reply…',
    streaming: 'Writing answer…',
    errors: {
      NO_INPUT: 'Could not find the ChatGPT message box.',
      NO_SEND_BUTTON: 'Text was entered but not sent. Refresh the page and try again.',
      PROMPT_INSERT_FAILED: 'Could not insert text into the message box.',
      NO_RESPONSE: 'No reply seen in the helper tab. Try Ask here again, or refresh chatgpt.com.',
      TIMEOUT: 'Timed out waiting for a reply.',
      WORKER_CLOSED: 'Helper tab was closed.',
      OPEN_FAILED: 'Could not open the helper tab.',
      RELOAD: 'Extension updated — refresh this page.',
      NOTE_DELIVERY_FAILED: 'Reply was ready but did not reach the note. Don’t refresh; ask again.'
    }
  }
};
