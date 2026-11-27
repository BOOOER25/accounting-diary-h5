'use strict';

function liveDiaryBills(key = day) {
  return key === '2026-11-16' ? bills : [];
}

function diaryBillItems(key = day) {
  // Editing today's source can update its record; reading uses the saved copy.
  if (view === 'edit' && key === day && key === '2026-11-16') return liveDiaryBills(key);
  const saved = data[key]?.billSnapshot;
  return Array.isArray(saved) ? saved : liveDiaryBills(key);
}

function snapshotDiaryBills() {
  entry().billSnapshot = dayBills().map(bill => ({ ...bill }));
}

function migrateDiaryBillRecords() {
  Object.entries(data).forEach(([key, diary]) => {
    if (!Array.isArray(diary.billSnapshot) && liveDiaryBills(key).length) {
      diary.billSnapshot = liveDiaryBills(key).map(bill => ({ ...bill }));
    }
  });
}

function formatDiaryBillAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? String(Math.round(amount * 100) / 100) : '0';
}

function renderDiaryBillRecord() {
  const items = dayBills();
  if (!items.length) return '';
  return `<section class="sources saved-bills" aria-label="当日账单">
    <div class="sources-head"><span>今日账单 · ${items.length}</span></div>
    <div class="bill-list">${items.map(bill => {
      const review = REVIEWS[bill.review];
      return `<div class="saved-bill-row">
        <span class="category">${ico(bill.icon)}</span>
        <div class="saved-bill-info"><span class="bill-name">${esc(bill.name)}</span>
          ${bill.note ? `<span class="saved-bill-note">${esc(bill.note)}</span>` : ''}
          ${review ? `<span class="saved-bill-review review-${esc(bill.review)}">${esc(review.label)}</span>` : ''}
        </div>
        ${bill.photo ? `<img class="saved-bill-photo" src="${esc(bill.photo)}" alt="${esc(bill.name)}的账单图片">` : ''}
        <span class="amount">¥${formatDiaryBillAmount(bill.amount)}</span>
      </div>`;
    }).join('')}</div>
  </section>`;
}

async function prepareDiaryBillCard(items, width) {
  if (!items.length) return null;
  const measure = document.createElement('canvas').getContext('2d');
  const wrap = (text, maxWidth, font) => {
    measure.font = font;
    const lines = [];
    for (const paragraph of String(text || '').split(/\r?\n/)) {
      let line = '';
      for (const character of Array.from(paragraph)) {
        if (line && measure.measureText(line + character).width > maxWidth) {
          lines.push(line); line = '';
        }
        line += character;
      }
      lines.push(line);
    }
    return lines;
  };
  const family = '"PingFang SC","Microsoft YaHei",sans-serif';
  const nameFont = '500 12px ' + family, noteFont = '10px ' + family;
  const iconImages = new Map();
  const rows = await Promise.all(items.map(async bill => {
    const review = REVIEWS[bill.review];
    const amount = '¥' + formatDiaryBillAmount(bill.amount);
    measure.font = '12px ' + family;
    const amountWidth = Math.max(36, Math.ceil(measure.measureText(amount).width));
    const textWidth = Math.max(60, width - 24 - 30 - amountWidth - (bill.photo ? 40 : 0) - 8);
    const names = wrap(bill.name, textWidth, nameFont);
    const notes = bill.note ? wrap(bill.note, textWidth, noteFont) : [];
    const height = Math.max(46, 16 + names.length * 18 + notes.length * 14 + (review ? 21 : 0));
    if (!iconImages.has(bill.icon)) {
      const symbol = document.getElementById('i-' + bill.icon) || document.getElementById('i-book');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#685d47" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${symbol?.innerHTML || ''}</svg>`;
      iconImages.set(bill.icon, loadPhotoImage('data:image/svg+xml,' + encodeURIComponent(svg)).catch(() => null));
    }
    const [icon, photo] = await Promise.all([
      iconImages.get(bill.icon),
      bill.photo ? loadPhotoImage(bill.photo).catch(() => null) : null
    ]);
    return {bill, review, amount, amountWidth, names, notes, height, icon, photo};
  }));
  const height = 38 + rows.reduce((total, row) => total + row.height, 0) + 8;
  return {
    height,
    draw(context, x, y) {
      context.save();
      context.fillStyle = '#fffefa';
      context.strokeStyle = '#3d3832';
      context.lineWidth = 1.5;
      context.beginPath(); context.roundRect(x, y, width, height, 10); context.fill(); context.stroke();
      context.fillStyle = '#ffebae'; context.fillRect(x + 12, y + 23, 76, 4);
      context.font = '11px ' + family; context.fillStyle = '#79736b';
      context.fillText('今日账单 · ' + items.length, x + 12, y + 24);
      let top = y + 38;
      rows.forEach((row, index) => {
        if (index) {
          context.strokeStyle = '#eae6dc'; context.lineWidth = 1; context.setLineDash([3, 4]);
          context.beginPath(); context.moveTo(x + 12, top); context.lineTo(x + width - 12, top); context.stroke(); context.setLineDash([]);
        }
        context.fillStyle = '#fff4d4'; context.beginPath(); context.roundRect(x + 12, top + 9, 23, 26, 7); context.fill();
        if (row.icon) context.drawImage(row.icon, x + 16, top + 14, 15, 15);
        let baseline = top + 21;
        context.font = nameFont; context.fillStyle = '#353535';
        row.names.forEach(line => {context.fillText(line, x + 42, baseline); baseline += 18;});
        context.font = noteFont; context.fillStyle = '#9b9488';
        row.notes.forEach(line => {context.fillText(line, x + 42, baseline - 2); baseline += 14;});
        if (row.review) {
          const colors = {regret: ['#feeff2', '#bd4e68'], worth: ['#fff1c7', '#866126'], okay: ['#e2eeff', '#526d92']};
          const [fill, ink] = colors[row.bill.review];
          context.fillStyle = fill; context.beginPath(); context.roundRect(x + 42, baseline - 10, 43, 17, 4); context.fill();
          context.fillStyle = ink; context.font = '10px ' + family;
          context.fillText(row.review.label, x + 48, baseline + 2);
        }
        const right = x + width - 12;
        if (row.photo) {
          const fit = Math.min(30 / row.photo.naturalWidth, 36 / row.photo.naturalHeight);
          const w = row.photo.naturalWidth * fit, h = row.photo.naturalHeight * fit;
          context.drawImage(row.photo, right - row.amountWidth - 40 + (30 - w) / 2, top + 6 + (36 - h) / 2, w, h);
        }
        context.font = '12px ' + family; context.fillStyle = '#333'; context.textAlign = 'right';
        context.fillText(row.amount, right, top + 24); context.textAlign = 'left';
        top += row.height;
      });
      context.restore();
    }
  };
}
