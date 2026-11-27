'use strict';

let photoDraft = null;
let cutoutWorker = null;
let cutoutJob = 0;
let photoSelection = 0;
let cancelActiveCutout = null;

function billPhotoVersion(src) {
  let hash = 2166136261;
  for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619);
  return src.length + ':' + (hash >>> 0).toString(36);
}

function billPhotoSelected(bill, key = day) {
  return Boolean(bill.photo) && data[key]?.hiddenBillPhotos?.[bill.id] !== billPhotoVersion(bill.photo);
}

function renderBillPhotoChoices() {
  document.querySelectorAll('[data-bill-photo-choice]').forEach(button => {
    const bill = dayBills().find(item => item.id === button.dataset.billPhotoChoice);
    if (bill?.photo) button.outerHTML = billPhotoChoice(bill);
  });
}

function billPhotoChoice(bill) {
  const selected = billPhotoSelected(bill);
  return `<button class="bill-photo-choice ${selected ? 'is-selected' : ''}" data-bill-photo-choice="${esc(bill.id)}" aria-pressed="${selected}" aria-label="${selected ? '取消选用' : '选用'}${esc(bill.name)}图片">
    <span class="bill-photo-image"><img src="${bill.photo}" alt="${esc(bill.name)}的账单图片" draggable="false"><span class="bill-photo-check" aria-hidden="true">${selected ? '✓' : ''}</span></span>
  </button>`;
}

function toggleBillPhoto(id) {
  if (view !== 'edit') return;
  const bill = dayBills().find(item => item.id === id);
  if (!bill?.photo) return;
  const diary = entry();
  const previous = diary.hiddenBillPhotos;
  const next = { ...previous };
  if (billPhotoSelected(bill)) next[id] = billPhotoVersion(bill.photo);
  else delete next[id];
  diary.hiddenBillPhotos = next;
  if (!save()) { diary.hiddenBillPhotos = previous; return; }
  renderBillPhotoChoices();
  renderPhotos();
  document.querySelector('[data-bill-photo-choice="' + id + '"]')?.focus({ preventScroll: true });
}

function diaryPhotos(key = day) {
  const diary = data[key] || {};
  const fromBills = dayBills(key).filter(bill => billPhotoSelected(bill, key)).map(bill => ({
    id: 'bill-' + bill.id,
    src: bill.photo,
    sticker: Boolean(bill.photoSticker),
    sourceBillId: bill.id,
    billName: bill.name
  }));
  const seen = new Set();
  return [...fromBills, ...(diary.photos || [])].filter(photo => {
    if (seen.has(photo.src)) return false;
    seen.add(photo.src);
    return true;
  });
}

function renderPhotos() {
  finishPhotoGesture(false);
  suppressedPhotoClick = null;
  photoBoardObserver?.disconnect();
  const host = $('#diaryPhotos');
  if (!host) return;
  const photos = diaryPhotos();
  host.classList.add('photo-board');
  host.innerHTML = photos.map(photo => `
    <figure class="photo-piece ${photo.sticker ? 'photo-piece-sticker' : ''}" data-photo-piece="${esc(photo.id)}">
      <button class="photo-open" data-photo-open="${esc(photo.id)}" aria-label="${view === 'edit' ? '调整' : '查看'}${photo.billName ? esc(photo.billName) + '账单图片' : (photo.sticker ? '抠图照片' : '日记照片')}" ${view === 'edit' ? 'aria-pressed="false"' : ''}>
        <img src="${photo.src}" alt="${photo.billName ? esc(photo.billName) + '的账单图片' : (photo.sticker ? '抠图后的白边照片' : '日记照片')}" draggable="false">
      </button>
      ${view === 'edit' ? `<button class="photo-adjust" data-photo-adjust="${esc(photo.id)}">调大小</button>` : ''}
      ${view === 'edit' ? `<button class="photo-remove" data-photo-remove="${esc(photo.id)}" aria-label="移除这张照片">×</button>` : ''}
    </figure>`).join('');
  if (!photos.length) { host.style.height = ''; return; }
  host.querySelectorAll('.photo-open img').forEach(image => image.addEventListener('load', layoutPhotoBoard, { once: true }));
  layoutPhotoBoard();
  let previousWidth = host.clientWidth;
  photoBoardObserver = new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - previousWidth) > .5) {
      previousWidth = host.clientWidth;
      layoutPhotoBoard();
    }
  });
  photoBoardObserver.observe(host);
}

let photoBoardObserver = null;
let photoGesture = null;
let suppressedPhotoClick = null;
const clampPhoto = (value, min, max) => Math.min(max, Math.max(min, value));

function settlePhotosForSheet() {
  finishPhotoGesture(false);
  document.querySelectorAll('#diaryPhotos .is-lifted').forEach(figure => {
    figure.classList.remove('is-lifted');
    figure.querySelector('.photo-open')?.setAttribute('aria-pressed', 'false');
  });
}

function liftPhoto(id) {
  const host = $('#diaryPhotos');
  const photo = diaryPhotos().find(item => item.id === id);
  const figure = host?.querySelector('[data-photo-piece="' + id + '"]');
  if (!photo || !figure) return;
  host.querySelectorAll('.is-lifted').forEach(item => {
    item.classList.remove('is-lifted');
    item.querySelector('.photo-open')?.setAttribute('aria-pressed', 'false');
  });
  const z = 1 + Math.max(0, ...[...host.querySelectorAll('[data-photo-piece]')].map(item => Number(item.style.zIndex) || 0));
  storePhotoLayout(photo, { z });
  figure.classList.add('is-lifted');
  figure.querySelector('.photo-open').setAttribute('aria-pressed', 'true');
}

function savedPhotoLayout(photo) {
  const layout = entry().photoLayouts?.[photo.id];
  return layout?.version === billPhotoVersion(photo.src) ? layout : {};
}

function layoutPhotoBoard() {
  const host = $('#diaryPhotos');
  if (!host || photoGesture || !host.clientWidth) return;
  const photos = diaryPhotos();
  let rowTop = 12, rowHeight = 0, bottom = 0;
  photos.forEach((photo, index) => {
    const figure = host.querySelector('[data-photo-piece="' + photo.id + '"]');
    if (!figure) return;
    if (index % 2 === 0 && index) { rowTop += rowHeight + 26; rowHeight = 0; }
    const layout = savedPhotoLayout(photo);
    const fraction = clampPhoto(Number(layout.width) || .4, .24, .92);
    figure.style.width = (host.clientWidth * fraction) + 'px';
    const image = figure.querySelector('img');
    const ratio = image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
    const innerWidth = Math.max(1, figure.clientWidth - (photo.sticker ? 0 : 16));
    const height = innerWidth * ratio + (photo.sticker ? 0 : 30);
    const freeWidth = Math.max(0, host.clientWidth - figure.offsetWidth);
    const x = clampPhoto(Number.isFinite(layout.x) ? layout.x : (index % 2 ? .98 : .02), 0, 1);
    const top = Number.isFinite(layout.y) ? clampPhoto(layout.y, 0, 2.5) * host.clientWidth : rowTop;
    figure.style.left = Math.round(freeWidth * x) + 'px';
    figure.style.top = Math.round(top) + 'px';
    figure.style.zIndex = String(layout.z || index + 1);
    rowHeight = Math.max(rowHeight, height);
    bottom = Math.max(bottom, top + height);
  });
  host.style.height = photos.length ? Math.ceil(Math.max(230, bottom + 30)) + 'px' : '';
}

function currentPhotoPlacement(photo) {
  const host = $('#diaryPhotos');
  const figure = host?.querySelector('[data-photo-piece="' + photo.id + '"]');
  if (!host || !figure) return savedPhotoLayout(photo);
  return {
    x: figure.offsetLeft / Math.max(1, host.clientWidth - figure.offsetWidth),
    y: figure.offsetTop / Math.max(1, host.clientWidth),
    width: figure.offsetWidth / Math.max(1, host.clientWidth),
    z: Number(figure.style.zIndex) || 1
  };
}

function storePhotoLayout(photo, changes) {
  const diary = entry(), previous = diary.photoLayouts;
  diary.photoLayouts = { ...previous, [photo.id]: {
    ...currentPhotoPlacement(photo), ...changes, version: billPhotoVersion(photo.src)
  } };
  if (!save()) { diary.photoLayouts = previous; layoutPhotoBoard(); return false; }
  layoutPhotoBoard();
  return true;
}

function openPhotoSizing(id) {
  if (view !== 'edit') return;
  const photo = diaryPhotos().find(item => item.id === id);
  if (!photo) return;
  const percent = Math.round((currentPhotoPlacement(photo).width || .4) / .4 * 100 / 5) * 5;
  showSheet('让这张照片更醒目', `
    <div class="photo-size-preview"><img id="photoSizePreview" src="${photo.src}" alt="照片大小预览"></div>
    <div class="photo-size-label"><label for="photoSize">照片大小</label><output id="photoSizeValue">${percent}%</output></div>
    <input class="photo-size-slider" type="range" id="photoSize" min="60" max="230" step="5" value="${percent}" aria-label="照片大小">
    <div class="photo-size-presets"><button data-photo-size="75">小巧一点</button><button data-photo-size="100">刚刚好</button><button data-photo-size="200">夸张一点</button></div>
    <button class="confirm" id="finishPhotoSizing">就这样</button>`, () => {
    const update = value => {
      const requested = clampPhoto(Number(value), 60, 230);
      if (!storePhotoLayout(photo, { width: .4 * requested / 100 })) return;
      $('#photoSize').value = String(requested);
      $('#photoSizeValue').textContent = requested + '%';
      $('#photoSizePreview').style.width = (70 * requested / 100) + 'px';
      document.querySelectorAll('[data-photo-size]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.photoSize) === requested)));
    };
    $('#photoSizePreview').style.width = (70 * percent / 100) + 'px';
    $('#photoSize').oninput = event => update(event.target.value);
    document.querySelectorAll('[data-photo-size]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.photoSize) === percent));
      button.onclick = () => update(button.dataset.photoSize);
    });
    $('#finishPhotoSizing').onclick = closeSheet;
    $('#photoSize').focus({ preventScroll: true });
  });
}

function finishPhotoGesture(commit) {
  const gesture = photoGesture;
  if (!gesture) return;
  photoGesture = null;
  clearTimeout(gesture.timer);
  gesture.figure.classList.remove('is-dragging');
  if (gesture.button.hasPointerCapture(gesture.pointerId)) gesture.button.releasePointerCapture(gesture.pointerId);
  if (gesture.moved) {
    suppressedPhotoClick = { id: gesture.photo.id, until: performance.now() + 500 };
    if (commit) storePhotoLayout(gesture.photo, currentPhotoPlacement(gesture.photo));
    else layoutPhotoBoard();
  }
}

document.addEventListener('pointerdown', event => {
  const button = event.target.closest('#diaryPhotos .photo-open');
  if (view !== 'edit' || !button || !$('#overlay').hidden || photoGesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const photo = diaryPhotos().find(item => item.id === button.dataset.photoOpen);
  if (!photo) return;
  const figure = button.closest('[data-photo-piece]');
  event.preventDefault();
  button.focus({ preventScroll: true });
  liftPhoto(photo.id);
  button.setPointerCapture(event.pointerId);
  photoGesture = {
    photo, figure, button, pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY,
    left: figure.offsetLeft, top: figure.offsetTop, scrollTop: $('#paper').scrollTop,
    maxLeft: Math.max(0, $('#diaryPhotos').clientWidth - figure.offsetWidth),
    maxTop: Math.max(0, $('#diaryPhotos').clientHeight - figure.offsetHeight - 30),
    moved: false,
    timer: setTimeout(() => {
      if (!photoGesture || photoGesture.moved) return;
      suppressedPhotoClick = { id: photo.id, until: performance.now() + 1000 };
      finishPhotoGesture(false);
      openPhotoSizing(photo.id);
    }, 520)
  };
});

document.addEventListener('pointermove', event => {
  const gesture = photoGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
  if (!gesture.moved && Math.hypot(dx, dy) <= 6) return;
  gesture.moved = true;
  clearTimeout(gesture.timer);
  const host = $('#diaryPhotos'), paper = $('#paper'), bounds = paper.getBoundingClientRect();
  if (event.clientY > bounds.bottom - 28) paper.scrollTop += 7;
  else if (event.clientY < bounds.top + 28) paper.scrollTop -= 7;
  gesture.figure.classList.add('is-dragging');
  gesture.figure.style.zIndex = String(1 + Math.max(0, ...[...host.querySelectorAll('[data-photo-piece]')].map(item => Number(item.style.zIndex) || 0)));
  gesture.figure.style.left = clampPhoto(gesture.left + dx, 0, gesture.maxLeft) + 'px';
  gesture.figure.style.top = clampPhoto(gesture.top + dy + paper.scrollTop - gesture.scrollTop, 0, gesture.maxTop) + 'px';
});

document.addEventListener('pointerup', event => {
  if (!photoGesture || event.pointerId !== photoGesture.pointerId) return;
  const { photo, moved } = photoGesture;
  finishPhotoGesture(true);
  if (!moved) {
    suppressedPhotoClick = { id: photo.id, until: performance.now() + 500 };
  }
});
document.addEventListener('pointercancel', () => finishPhotoGesture(false));
document.addEventListener('lostpointercapture', () => finishPhotoGesture(false));
document.addEventListener('contextmenu', event => {
  if (view === 'edit' && event.target.closest('#diaryPhotos .photo-open')) event.preventDefault();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') finishPhotoGesture(false); });

function openPhotoMenu(target = 'diary') {
  if (typeof target !== 'string') target = 'diary';
  if (view !== 'edit') return;
  closeSheet();
  uploadTarget = target;
  showSheet('把今天贴下来', `
    <div class="photo-sources">
      <button class="photo-source" id="pickPhoto">${ico('photo')}<span>上传图片</span></button>
      <button class="photo-source" id="takePhoto"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5 9.5 3h5L16 5h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/></svg><span>拍一张</span></button>
    </div>
    <p class="photo-hint">选好后，可以抠图并加上白色描边。</p>`, () => {
    $('#pickPhoto').onclick = () => $('#fileInput').click();
    $('#takePhoto').onclick = () => $('#cameraInput').click();
    $('#pickPhoto').focus();
  });
}

async function loadPhotoImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择一张图片');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadPhotoImage(objectUrl);
    const ratio = Math.min(1, 1000 / image.width, 1000 / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const format = /png|webp/.test(file.type) ? 'image/webp' : 'image/jpeg';
    return canvas.toDataURL(format, .86);
  } catch {
    throw new Error('这张图片暂时打不开，试试 JPG、PNG 或 WebP');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function handleImageFile(event) {
  const file = event.target.files[0];
  const target = uploadTarget;
  const targetDay = day;
  const selection = ++photoSelection;
  event.target.value = '';
  if (!file) return;
  try {
    const src = await preparePhoto(file);
    if (selection !== photoSelection || day !== targetDay || view !== 'edit') return;
    closeSheet();
    photoDraft = { original: src, result: src, sticker: false, busy: false, target, day: targetDay };
    showPhotoEditor();
  } catch (error) {
    notify(error.message);
  }
}

function showPhotoEditor() {
  if (!photoDraft) return;
  const draft = photoDraft;
  showSheet('一张今天的小纪念', `
    <div class="photo-preview ${draft.sticker ? 'is-sticker' : ''}" id="photoPreview">
      <img id="photoPreviewImage" src="${draft.result}" alt="${draft.sticker ? '白边照片预览' : '所选照片预览'}">
    </div>
    <div class="photo-progress" id="photoProgress" role="status" aria-live="polite">${draft.sticker ? '白边已经贴好啦' : '保留原图，或把喜欢的部分抠出来'}</div>
    <div class="photo-actions">
      <button class="photo-secondary" id="cutoutPhoto">${draft.sticker ? '恢复原图' : '✂ 一键抠图'}</button>
      <button class="confirm photo-confirm" id="placePhoto">${draft.sticker ? '贴到日记' : '放入日记'}</button>
    </div>
    <p class="photo-hint" id="photoModelHint">照片在本机处理。首次抠图需要联网加载，可能稍等一会儿。</p>`, () => {
    $('#cutoutPhoto').onclick = () => {
      if (draft.sticker) {
        draft.result = draft.original;
        draft.sticker = false;
        showPhotoEditor();
      } else {
        startPhotoCutout(draft);
      }
    };
    $('#placePhoto').textContent = draft.target !== 'diary' ? '收好图片' : (draft.sticker ? '贴到日记' : '放入日记');
    $('#placePhoto').onclick = () => placePhoto(draft);
    $('#cutoutPhoto').focus();
  });
}

function cancelPhotoEditor() {
  photoSelection++;
  photoDraft = null;
  cancelActiveCutout?.();
}

function setPhotoProgress(text) {
  if ($('#photoProgress')) $('#photoProgress').textContent = text;
}

async function startPhotoCutout(draft) {
  if (draft.busy || photoDraft !== draft) return;
  draft.busy = true;
  $('#cutoutPhoto').disabled = true;
  $('#placePhoto').disabled = true;
  $('#photoPreview').setAttribute('aria-busy', 'true');
  setPhotoProgress('正在准备抠图工具…');
  const job = ++cutoutJob;
  try {
    const source = await (await fetch(draft.original)).blob();
    if (photoDraft !== draft) return;
    const cutout = await new Promise((resolve, reject) => {
      if (!cutoutWorker) cutoutWorker = new Worker(new URL('photo-cutout-worker.js?v=20261125-photos', document.baseURI), { type: 'module' });
      const worker = cutoutWorker;
      let timeout = setTimeout(() => {
        cleanup();
        worker.terminate();
        if (cutoutWorker === worker) cutoutWorker = null;
        reject(new Error('抠图等得有点久，可以重试或先放入原图'));
      }, 240000);
      const cleanup = () => { clearTimeout(timeout); worker.onmessage = null; worker.onerror = null; cancelActiveCutout = null; };
      cancelActiveCutout = () => {
        cleanup();
        worker.terminate();
        if (cutoutWorker === worker) cutoutWorker = null;
        reject(new DOMException('已取消抠图', 'AbortError'));
      };
      worker.onmessage = ({ data: message }) => {
        if (message.job !== job) return;
        if (message.type === 'progress') {
          if (photoDraft === draft) setPhotoProgress(message.text);
        } else if (message.type === 'done') {
          cleanup();
          resolve(message.blob);
        } else if (message.type === 'error') {
          cleanup();
          worker.terminate();
          if (cutoutWorker === worker) cutoutWorker = null;
          reject(new Error('这次抠图没有完成，检查网络后重试，或先放入原图'));
        }
      };
      worker.onerror = () => {
        cleanup();
        worker.terminate();
        if (cutoutWorker === worker) cutoutWorker = null;
        reject(new Error('当前浏览器暂时无法抠图，可以用原图记录'));
      };
      worker.postMessage({ job, source });
    });
    if (photoDraft !== draft) return;
    draft.result = await makeWhiteSticker(cutout);
    if (photoDraft !== draft) return;
    draft.sticker = true;
    draft.busy = false;
    showPhotoEditor();
  } catch (error) {
    if (photoDraft !== draft) return;
    draft.busy = false;
    $('#cutoutPhoto').disabled = false;
    $('#placePhoto').disabled = false;
    $('#photoPreview').removeAttribute('aria-busy');
    setPhotoProgress(error.message);
  }
}

async function makeWhiteSticker(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadPhotoImage(url);
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, image.width, image.height).data;
    let left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] > 32) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) throw new Error('没有找到清晰的主体，换张背景简单的照片试试');
    const subjectWidth = right - left + 1, subjectHeight = bottom - top + 1;
    const scale = Math.min(1, 640 / Math.max(subjectWidth, subjectHeight));
    const width = Math.max(1, Math.round(subjectWidth * scale));
    const height = Math.max(1, Math.round(subjectHeight * scale));
    const border = 12;
    const mask = document.createElement('canvas');
    mask.width = width; mask.height = height;
    const maskContext = mask.getContext('2d');
    maskContext.drawImage(image, left, top, subjectWidth, subjectHeight, 0, 0, width, height);
    maskContext.globalCompositeOperation = 'source-in';
    maskContext.fillStyle = '#fff';
    maskContext.fillRect(0, 0, width, height);
    const result = document.createElement('canvas');
    result.width = width + border * 4; result.height = height + border * 4;
    const context = result.getContext('2d');
    // Dilate the subject silhouette into an opaque white sticker outline.
    for (let radius = 0; radius <= border; radius += 2) {
      for (let step = 0; step < 48; step++) {
        const angle = step * Math.PI / 24;
        context.drawImage(mask, border * 2 + Math.cos(angle) * radius, border * 2 + Math.sin(angle) * radius);
      }
    }
    context.drawImage(image, left, top, subjectWidth, subjectHeight, border * 2, border * 2, width, height);
    return result.toDataURL('image/webp', .94);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function placePhoto(draft) {
  if (draft.busy || photoDraft !== draft || day !== draft.day || view !== 'edit') return;
  if (draft.target === 'diary') {
    const previous = entry().photos || [];
    entry().photos = [...previous, { id: crypto.randomUUID(), src: draft.result, sticker: draft.sticker }];
    if (!save()) { entry().photos = previous; return; }
    closeSheet();
    renderPhotos();
    $('#diaryPhotos').lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    const bill = bills.find(item => item.id === draft.target);
    if (!bill) return;
    const previous = bill.photo;
    const previousSticker = bill.photoSticker;
    bill.photo = draft.result;
    bill.photoSticker = draft.sticker;
    refreshSources();
    if (!save()) { bill.photo = previous; bill.photoSticker = previousSticker; refreshSources(); return; }
    closeSheet();
  }
  notify('照片收好啦');
}

document.addEventListener('click', event => {
  const adjust = event.target.closest('[data-photo-adjust]');
  if (adjust) { openPhotoSizing(adjust.dataset.photoAdjust); return; }
  if (!event.target.closest('[data-photo-piece],#overlay')) {
    document.querySelectorAll('.is-lifted').forEach(item => {
      item.classList.remove('is-lifted');
      item.querySelector('.photo-open')?.setAttribute('aria-pressed', 'false');
    });
  }
  const choice = event.target.closest('[data-bill-photo-choice]');
  if (choice) { toggleBillPhoto(choice.dataset.billPhotoChoice); return; }
  const open = event.target.closest('[data-photo-open]');
  const remove = event.target.closest('[data-photo-remove]');
  if (remove && view === 'edit') {
    const selected = diaryPhotos().find(photo => photo.id === remove.dataset.photoRemove);
    if (!selected) return;
    const diary = entry();
    const previous = diary.photos;
    const previousHidden = diary.hiddenBillPhotos;
    const linkedBills = dayBills().filter(bill => bill.photo === selected.src);
    diary.photos = (previous || []).filter(photo => photo.src !== selected.src);
    diary.hiddenBillPhotos = { ...previousHidden, ...Object.fromEntries(linkedBills.map(bill => [bill.id, billPhotoVersion(bill.photo)])) };
    if (!save()) { diary.photos = previous; diary.hiddenBillPhotos = previousHidden; return; }
    renderBillPhotoChoices();
    renderPhotos();
    notify(linkedBills.length ? '已从日记移除，账单原图保留' : '已移除图片');
  } else if (open) {
    const photo = diaryPhotos().find(item => item.id === open.dataset.photoOpen);
    if (!photo) return;
    if (suppressedPhotoClick?.id === photo.id && suppressedPhotoClick.until > performance.now()) return;
    if (view === 'edit') { liftPhoto(photo.id); return; }
    showSheet('今天的照片', `<div class="photo-preview photo-lightbox ${photo.sticker ? 'is-sticker' : ''}"><img src="${photo.src}" alt="${photo.sticker ? '白边照片' : '日记照片'}"></div>`);
  }
});

window.addEventListener('pagehide', () => {
  finishPhotoGesture(true);
  photoBoardObserver?.disconnect();
  cancelPhotoEditor();
  cutoutWorker?.terminate();
  cutoutWorker = null;
});
