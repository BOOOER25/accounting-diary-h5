'use strict';

// Follow the available keyboard viewport without refocusing or replacing text.
(() => {
  let frame = 0;
  let composingEntry = null;
  const editor = () => document.querySelector('#entry[contenteditable="true"]');

  function caretBounds(range) {
    const direct = range.getClientRects()[0];
    if (direct?.height) return direct;
    const container = range.startContainer;
    if (container.nodeType === Node.ELEMENT_NODE) {
      const next = container.childNodes[range.startOffset];
      const adjacent = next || container.childNodes[range.startOffset - 1];
      if (adjacent) {
        let text = adjacent.nodeType === Node.TEXT_NODE ? adjacent : null;
        if (!text) {
          const walker = document.createTreeWalker(adjacent, NodeFilter.SHOW_TEXT);
          let found;
          while ((found = walker.nextNode())) { text = found; if (next) break; }
        }
        if (text) {
          const measured = document.createRange();
          measured.setStart(text, next ? 0 : text.length);
          measured.collapse(true);
          const bounds = measured.getClientRects()[0];
          if (bounds?.height) return bounds;
        }
      }
    }
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    const bounds = element.getBoundingClientRect();
    const height = parseFloat(getComputedStyle(element).lineHeight) || 32;
    return { top: bounds.top, bottom: bounds.top + height, height };
  }

  function keepCaretVisible() {
    frame = 0;
    const entry = editor();
    const paper = document.querySelector('#paper');
    const selection = window.getSelection();
    if (!entry || !paper || composingEntry === entry || document.activeElement !== entry ||
        !selection?.rangeCount || !selection.isCollapsed || !entry.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    const caret = caretBounds(range);
    const bounds = paper.getBoundingClientRect();
    const top = bounds.top + 12, bottom = bounds.bottom - 16;
    if (caret.bottom > bottom) paper.scrollTop += caret.bottom - bottom;
    else if (caret.top < top) paper.scrollTop -= top - caret.top;
  }

  function scheduleCaret() {
    if (!frame) frame = requestAnimationFrame(keepCaretVisible);
  }

  function resizeViewport() {
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) < .01) {
      document.documentElement.style.setProperty('--diary-viewport-height', viewport.height + 'px');
    }
    scheduleCaret();
  }

  document.addEventListener('compositionstart', event => {
    if (event.target === editor()) composingEntry = event.target;
  });
  document.addEventListener('compositionend', event => {
    if (event.target !== composingEntry) return;
    composingEntry = null;
    scheduleCaret();
  });
  document.addEventListener('focusin', event => {
    if (event.target === editor()) scheduleCaret();
  });
  document.addEventListener('selectionchange', scheduleCaret);
  document.addEventListener('input', event => {
    if (event.target === editor() && !event.isComposing) scheduleCaret();
  });
  window.visualViewport?.addEventListener('resize', resizeViewport);
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('pageshow', resizeViewport);
  window.DiaryFocus = { scheduleCaret };
  resizeViewport();
})();
