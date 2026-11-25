'use strict';

let diaryShareUrl = null;
let diaryShareRequest = 0;

function clearDiaryShare() {
  diaryShareRequest++;
  if (diaryShareUrl) URL.revokeObjectURL(diaryShareUrl);
  diaryShareUrl = null;
}

// Draw a clean diary card from the current entry, without any editing controls.
async function createDiaryCard() {
  await document.fonts.ready;
  const width = 375, pad = 27, contentWidth = width - pad * 2;
  const measured = document.createElement('canvas').getContext('2d');
  const font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
  measured.font = font;
  const readText = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('.bill-token')) return node.textContent;
    if (node.tagName === 'BR') return '\n';
    const children = [...node.childNodes].map(readText).join('');
    return children + (node.matches('p,div,li') && node.id !== 'entry' ? '\n' : '');
  };
  const text = readText($('#entry')).replace(/\r/g, '').trimEnd();
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && measured.measureText(line + character).width > contentWidth) {
        lines.push(line); line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  const photos = diaryPhotos().map(photo => ({ ...photo, placement: currentPhotoPlacement(photo) }));
  const [background, cat, ...images] = await Promise.all([
    loadPhotoImage('assets/paw-background.png'),
    loadPhotoImage('assets/note-cat.png'),
    ...photos.map(photo => loadPhotoImage(photo.src))
  ]);
  const photoTop = 155 + lines.length * 30;
  const placements = photos.map((photo, index) => {
    const image = images[index], layout = photo.placement;
    const w = contentWidth * (layout.width || .4);
    const imageWidth = Math.max(1, w - (photo.sticker ? 0 : 16));
    return {
      photo, image, w, imageWidth,
      h: imageWidth * image.naturalHeight / image.naturalWidth + (photo.sticker ? 0 : 30),
      x: pad + (contentWidth - w) * (layout.x || 0),
      y: photoTop + (layout.y || 0) * contentWidth,
      z: layout.z || index + 1
    };
  }).sort((a, b) => a.z - b.z);
  const bottom = Math.max(photoTop, ...placements.map(item => item.y + item.h));
  const height = Math.max(430, bottom + 85);
  // Bound total pixels for long entries on mobile devices.
  const scale = Math.min(2, 16000 / height, Math.sqrt(24000000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.fillStyle = '#fffefa';
  context.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 873) context.drawImage(background, 0, y, width, 873);
  context.drawImage(cat, width - 106, 24, 79, 79);
  const date = new Date(day + 'T12:00:00');
  context.fillStyle = '#373128';
  context.font = 'bold 25px "PingFang SC","Microsoft YaHei",sans-serif';
  context.fillText(`${date.getMonth() + 1} 月 ${date.getDate()} 日`, pad, 64);
  context.fillStyle = '#a18b70';
  context.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
  context.fillText(`${date.getFullYear()} · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getDay()]}${entry().mood ? ' · ' + entry().mood : ''}`, pad, 89);
  context.strokeStyle = '#e4d8bc';
  context.setLineDash([3, 5]); context.beginPath();
  context.moveTo(pad, 115); context.lineTo(width - pad, 115); context.stroke();
  context.setLineDash([]);
  context.font = font; context.fillStyle = '#514839';
  lines.forEach((line, index) => context.fillText(line, pad, 153 + index * 30));
  placements.forEach(({ photo, image, x, y, w, h, imageWidth }) => {
    context.save();
    context.shadowColor = '#76502d30'; context.shadowBlur = 8; context.shadowOffsetY = 4;
    if (!photo.sticker) {
      context.fillStyle = '#fff'; context.fillRect(x, y, w, h);
      context.shadowColor = 'transparent';
      context.strokeStyle = '#eee5d7'; context.strokeRect(x, y, w, h);
    }
    const inset = photo.sticker ? 0 : 8;
    context.drawImage(image, x + inset, y + inset, imageWidth, imageWidth * image.naturalHeight / image.naturalWidth);
    context.restore();
  });
  context.fillStyle = '#c9a38c'; context.textAlign = 'center';
  context.font = '13px "PingFang SC","Microsoft YaHei",sans-serif';
  context.fillText('· ♡ ·', width / 2, height - 46);
  context.fillStyle = '#b5a58c'; context.font = '10px "PingFang SC","Microsoft YaHei",sans-serif';
  context.fillText('我的记账日记', width / 2, height - 24);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('图片生成失败');
  return new File([blob], `记账日记-${day}.png`, { type: 'image/png' });
}

async function openDiaryShare() {
  if (view === 'history') return;
  finishPhotoGesture(true);
  if (view === 'edit' && !save()) return;
  closeSheet();
  const request = diaryShareRequest;
  showSheet('分享这一天', '<div class="share-preview" id="sharePreview" role="status"><p>正在把今天装进一张图片…</p></div>');
  const sheet = $('#overlay .sheet');
  try {
    const file = await createDiaryCard();
    if (request !== diaryShareRequest || !sheet.isConnected) return;
    diaryShareUrl = URL.createObjectURL(file);
    $('#sharePreview').innerHTML = `<img src="${diaryShareUrl}" alt="当前日记分享图片预览">`;
    let canShare = false;
    try { canShare = Boolean(navigator.canShare?.({ files: [file] }) && navigator.share); } catch {}
    sheet.insertAdjacentHTML('beforeend', `<div class="share-actions"><button class="share-save" id="saveDiaryImage">保存图片</button>${canShare ? '<button class="confirm" id="shareDiaryImage">分享给朋友</button>' : ''}</div><p class="share-note">${canShare ? '分享的是这张日记图片' : '保存后可发给朋友；手机也可以长按图片保存'}</p>`);
    $('#saveDiaryImage').onclick = () => {
      const link = document.createElement('a');
      link.href = diaryShareUrl; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
    };
    if (canShare) $('#shareDiaryImage').onclick = async () => {
      const button = $('#shareDiaryImage');
      button.disabled = true;
      try { await navigator.share({ files: [file], title: '我的记账日记' }); }
      catch (error) { if (error.name !== 'AbortError') notify('暂时无法直接分享，可以先保存图片'); }
      finally { if (button.isConnected) button.disabled = false; }
    };
  } catch {
    if (request === diaryShareRequest && sheet.isConnected) {
      $('#sharePreview').innerHTML = '<p>图片没准备好，请关闭后重试。</p>';
    }
  }
}

window.addEventListener('pagehide', clearDiaryShare);
