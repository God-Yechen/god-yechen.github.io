(() => {
  const dialog = document.getElementById('honors-certificate-dialog');
  if (!dialog) return;
  const title = dialog.querySelector('#honors-certificate-title');
  const meta = dialog.querySelector('#honors-certificate-meta');
  const body = dialog.querySelector('#honors-certificate-body');
  const actions = dialog.querySelector('.honors-certificate-actions');
  const pngButton = dialog.querySelector('[data-certificate-png]');
  const pdfButton = dialog.querySelector('[data-certificate-pdf]');
  const downloadStatus = dialog.querySelector('#honors-certificate-download-status');
  let currentPdf = null;
  let revision = 0;

  function localUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === location.origin ? url : null;
    } catch { return null; }
  }

  function filename(url, extension) {
    let name = url.pathname.split('/').pop();
    try { name = decodeURIComponent(name); } catch { /* Keep the URL basename. */ }
    return extension ? name.replace(/\.[^.]+$/, '') + '.' + extension : name;
  }

  function download(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    dialog.append(link);
    link.click();
    link.remove();
  }

  function message(text) {
    const paragraph = document.createElement('p');
    paragraph.className = 'honors-certificate-message';
    paragraph.textContent = text;
    return paragraph;
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-certificate-trigger]');
    if (!trigger) return;
    const current = ++revision;
    title.textContent = trigger.dataset.certificateTitle;
    meta.textContent = [trigger.dataset.certificateDate, trigger.dataset.certificateAward,
      trigger.dataset.certificateAuthor, trigger.dataset.certificateDetail].filter(Boolean).join(' · ');
    body.replaceChildren();
    downloadStatus.textContent = '';
    downloadStatus.classList.add('visually-hidden');
    pngButton.disabled = true;
    pngButton.querySelector('span').textContent = '下载 PNG';
    currentPdf = localUrl(trigger.dataset.certificatePdf);
    pdfButton.disabled = !currentPdf;
    let files = [];
    try { files = JSON.parse(trigger.dataset.certificateFiles || '[]'); } catch { /* No valid images yet. */ }
    if (!Array.isArray(files)) files = [];
    for (const [index, file] of files.entries()) {
      if (typeof file !== 'string') continue;
      const url = localUrl(file);
      if (!url) continue;
      const figure = document.createElement('figure');
      figure.className = 'honors-certificate-figure';
      const image = document.createElement('img');
      image.className = 'honors-certificate-image';
      image.alt = title.textContent + '，证书或证明材料' + (files.length > 1 ? '第 ' + (index + 1) + ' 张' : '');
      image.decoding = 'async';
      image.addEventListener('load', () => {
        if (revision === current && image === body.querySelector('.honors-certificate-image')) pngButton.disabled = false;
      }, { once: true });
      image.addEventListener('error', () => {
        if (image === body.querySelector('.honors-certificate-image') && revision === current) pngButton.disabled = true;
        figure.replaceChildren(message('这张证书暂时无法显示。'));
      }, { once: true });
      image.src = url.href;
      figure.append(image);
      if (files.length > 1) {
        const caption = document.createElement('figcaption');
        caption.textContent = '第 ' + (index + 1) + ' 张';
        figure.append(caption);
      }
      body.append(figure);
    }
    actions.hidden = !body.querySelector('.honors-certificate-image') && !currentPdf;
    if (!body.childElementCount) body.append(message('证书或证明材料正在整理中，稍后补充。'));
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
  });

  pngButton.addEventListener('click', async () => {
    const image = body.querySelector('.honors-certificate-image');
    if (!image?.naturalWidth) return;
    const current = revision;
    pngButton.disabled = true;
    pngButton.querySelector('span').textContent = '准备中…';
    downloadStatus.classList.add('visually-hidden');
    downloadStatus.textContent = '正在准备 PNG 文件';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image export unavailable');
      context.drawImage(image, 0, 0);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image export failed')), 'image/png'));
      if (revision !== current || !dialog.open) return;
      const url = URL.createObjectURL(blob);
      download(url, filename(new URL(image.src), 'png'));
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      downloadStatus.textContent = 'PNG 文件已准备好';
    } catch {
      if (revision === current && dialog.open) {
        downloadStatus.classList.remove('visually-hidden');
        downloadStatus.textContent = 'PNG 下载失败，请重试。';
      }
    } finally {
      if (revision === current) {
        pngButton.disabled = !body.querySelector('.honors-certificate-image')?.naturalWidth;
        pngButton.querySelector('span').textContent = '下载 PNG';
      }
    }
  });

  pdfButton.addEventListener('click', () => {
    if (currentPdf) download(currentPdf.href, filename(currentPdf));
  });

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    revision++;
    body.replaceChildren();
    currentPdf = null;
    pngButton.disabled = true;
    pdfButton.disabled = true;
    actions.hidden = true;
    downloadStatus.textContent = '';
  });
  document.addEventListener('site:content-loaded', () => {
    if (dialog.open) dialog.close();
  });
})();
