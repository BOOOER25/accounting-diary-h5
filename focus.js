'use strict';

(() => {
  let viewportFrame = 0;
  let caretTimer = 0;
  let composing = false;
  let touching = false;
  const mobile = window.matchMedia('(max-width: 740px)');
  const editor = () => document.querySelector('#entry[contenteditable="true"]');
  const isEditing = () => document.activeElement?.matches('#entry[contenteditable="true"], textarea, input');

  function caretBounds(range) {
    const rect = range.getClientRects()[0];
    if (rect?.height) return rect;
    const node = range.startContainer;
    // Safari can return an empty rect at the end of a text node.
    if (node.nodeType === Node.TEXT_NODE && node.length) {
      const measured = range.cloneRange();
      const offset = range.startOffset;
      measured.setStart(node, Math.max(0, offset - 1));
      measured.setEnd(node, Math.min(node.length, offset || 1));
      const textRect = measured.getClientRects()[0];
      if (textRect?.height) return textRect;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const next = node.childNodes[range.startOffset];
      const adjacent = next || node.childNodes[range.startOffset - 1];
      if (adjacent) {
        if (adjacent.nodeType === Node.ELEMENT_NODE && adjacent.matches('.bill-token,img,br')) {
          const bounds = adjacent.getBoundingClientRect();
          if (bounds.height) return bounds;
        } else {
          const measured = document.createRange();
          measured.selectNodeContents(adjacent);
          measured.collapse(Boolean(next));
          const bounds = caretBounds(measured);
          if (bounds) return bounds;
        }
      }
    }
    // Only measure an empty line. A whole-editor fallback can jump to its top.
    const line = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (line?.matches('p, div') && !line.textContent && !line.querySelector('.bill-token,img')) {
      const bounds = line.getBoundingClientRect();
      const height = parseFloat(getComputedStyle(line).lineHeight) || 32;
      if (bounds.height) return {top: bounds.top, bottom: bounds.top + Math.min(height, bounds.height)};
    }
    return null;
  }

  function keepCaretVisible() {
    caretTimer = 0;
    const entry = editor(), paper = document.querySelector('#paper');
    const selection = window.getSelection();
    if (composing || touching || !entry || !paper || document.activeElement !== entry ||
        !selection?.rangeCount || !selection.isCollapsed ||
        !entry.contains(selection.anchorNode)) return;
    const caret = caretBounds(selection.getRangeAt(0));
    if (!caret) return;
    const bounds = paper.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = Math.max(bounds.top, viewport?.offsetTop || 0) + 12;
    const bottom = Math.min(bounds.bottom, (viewport?.offsetTop || 0) +
      (viewport?.height || window.innerHeight)) - 16;
    if (bottom <= top) return;
    if (caret.bottom > bottom) paper.scrollTop += Math.ceil(caret.bottom - bottom);
    else if (caret.top < top) paper.scrollTop -= Math.ceil(top - caret.top);
  }

  // Wait for keyboard/pan events to settle; never chase a moving IME or a touch selection.
  function scheduleCaret() {
    clearTimeout(caretTimer);
    caretTimer = window.setTimeout(keepCaretVisible, 140);
  }

  function syncViewport() {
    viewportFrame = 0;
    if (!mobile.matches) return;
    const viewport = window.visualViewport;
    // Preserve pinch zoom and avoid interpreting a zoomed viewport as a keyboard.
    if (viewport && Math.abs(viewport.scale - 1) > .01) return;
    const height = viewport?.height || window.innerHeight;
    if (height < 80) return;
    const root = document.documentElement;
    // WKWebView can pan the visual viewport without resizing the layout viewport.
    // Position in document coordinates so the app stays inside the visible area.
    const top = viewport ? viewport.pageTop : window.scrollY;
    root.style.setProperty('--diary-viewport-top', Math.max(0, top) + 'px');
    root.style.setProperty('--diary-viewport-height', height + 'px');
    if (isEditing()) scheduleCaret();
  }

  function scheduleViewport() {
    if (!viewportFrame) viewportFrame = requestAnimationFrame(syncViewport);
  }

  document.addEventListener('compositionstart', event => {
    if (event.target === editor()) { composing = true; clearTimeout(caretTimer); }
  });
  document.addEventListener('compositionend', event => {
    if (event.target === editor()) { composing = false; scheduleCaret(); }
  });
  document.addEventListener('focusin', event => {
    if (event.target.matches('#entry, textarea, input')) {
      scheduleViewport();
      scheduleCaret();
    }
  });
  document.addEventListener('focusout', () => {
    composing = false;
    scheduleViewport();
  });
  document.addEventListener('input', event => {
    if (event.target === editor() && !event.isComposing) scheduleCaret();
  });
  document.addEventListener('touchstart', () => {
    touching = true;
    clearTimeout(caretTimer);
  }, {passive: true});
  const endTouch = () => { touching = false; };
  document.addEventListener('touchend', endTouch, {passive: true});
  document.addEventListener('touchcancel', endTouch, {passive: true});
  // Selection changes are user navigation, not a request to recenter the editor.
  window.visualViewport?.addEventListener('resize', scheduleViewport);
  window.visualViewport?.addEventListener('scroll', scheduleViewport);
  window.addEventListener('resize', scheduleViewport);
  window.addEventListener('scroll', scheduleViewport, {passive: true});
  window.addEventListener('pageshow', scheduleViewport);
  mobile.addEventListener('change', scheduleViewport);
  window.DiaryFocus = {scheduleCaret};
  syncViewport();
})();
