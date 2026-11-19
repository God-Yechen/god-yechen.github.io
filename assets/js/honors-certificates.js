(() => {
  const dialog = document.getElementById('honors-certificate-dialog');
  if (!dialog) return;
  const title = dialog.querySelector('#honors-certificate-title');
  const meta = dialog.querySelector('#honors-certificate-meta');
  const body = dialog.querySelector('#honors-certificate-body');

  function message(text) {
    const paragraph = document.createElement('p');
    paragraph.className = 'honors-certificate-message';
    paragraph.textContent = text;
    return paragraph;
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-certificate-trigger]');
    if (!trigger) return;
    title.textContent = trigger.dataset.certificateTitle;
    meta.textContent = [trigger.dataset.certificateDate, trigger.dataset.certificateAward,
      trigger.dataset.certificateAuthor, trigger.dataset.certificateDetail].filter(Boolean).join(' · ');
    body.replaceChildren();
    let files = [];
    try { files = JSON.parse(trigger.dataset.certificateFiles || '[]'); } catch { /* No valid images yet. */ }
    if (!Array.isArray(files)) files = [];
    for (const [index, file] of files.entries()) {
      if (typeof file !== 'string') continue;
      let url;
      try { url = new URL(file, location.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin) continue;
      const figure = document.createElement('figure');
      figure.className = 'honors-certificate-figure';
      const image = document.createElement('img');
      image.className = 'honors-certificate-image';
      image.alt = title.textContent + '，证书或证明材料' + (files.length > 1 ? '第 ' + (index + 1) + ' 张' : '');
      image.decoding = 'async';
      image.addEventListener('error', () => {
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
    if (!body.childElementCount) body.append(message('证书或证明材料正在整理中，稍后补充。'));
    if (!dialog.open) dialog.showModal();
    body.scrollTop = 0;
  });

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => body.replaceChildren());
  document.addEventListener('site:content-loaded', () => {
    if (dialog.open) dialog.close();
  });
})();
