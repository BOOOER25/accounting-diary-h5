'use strict';

let photoDraft = null;
let cutoutWorker = null;
let cutoutJob = 0;
let photoSelection = 0;
let cancelActiveCutout = null;

function renderPhotos() {
  const host = $('#diaryPhotos');
  if (!host) return;
  host.innerHTML = (entry().photos || []).map(photo => `
    <figure class="photo-piece ${photo.sticker ? 'photo-piece-sticker' : ''}">
      <button class="photo-open" data-photo-open="${esc(photo.id)}" aria-label="查看${photo.sticker ? '照片贴纸' : '日记照片'}">
        <img src="${photo.src}" alt="${photo.sticker ? '抠图后的白边照片贴纸' : '日记照片'}">
      </button>
      ${view === 'edit' ? `<button class="photo-remove" data-photo-remove="${esc(photo.id)}" aria-label="移除这张${photo.sticker ? '贴纸' : '照片'}">×</button>` : ''}
    </figure>`).join('');
}

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
    <p class="photo-hint">选好后，可以抠成一张白边小贴纸。</p>`, () => {
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
      <img id="photoPreviewImage" src="${draft.result}" alt="${draft.sticker ? '白边贴纸预览' : '所选照片预览'}">
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
    bill.photo = draft.result;
    refreshSources();
    if (!save()) { bill.photo = previous; refreshSources(); return; }
    closeSheet();
  }
  notify(draft.sticker ? '小贴纸收好啦' : '照片收好啦');
}

document.addEventListener('click', event => {
  const open = event.target.closest('[data-photo-open]');
  const remove = event.target.closest('[data-photo-remove]');
  if (remove && view === 'edit') {
    const previous = entry().photos;
    entry().photos = previous.filter(photo => photo.id !== remove.dataset.photoRemove);
    if (!save()) { entry().photos = previous; return; }
    renderPhotos();
    notify('已移除图片');
  } else if (open) {
    const photo = entry().photos?.find(item => item.id === open.dataset.photoOpen);
    if (!photo) return;
    showSheet(photo.sticker ? '今天的小贴纸' : '今天的照片', `<div class="photo-preview photo-lightbox ${photo.sticker ? 'is-sticker' : ''}"><img src="${photo.src}" alt="${photo.sticker ? '白边照片贴纸' : '日记照片'}"></div>`);
  }
});

window.addEventListener('pagehide', () => {
  cancelPhotoEditor();
  cutoutWorker?.terminate();
  cutoutWorker = null;
});
