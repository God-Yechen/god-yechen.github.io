(() => {
  if (window.__privatePortalReady) return;
  window.__privatePortalReady = true;
  const utf8 = new TextEncoder();
  const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  let state = null;
  let generation = 0;
  let timer;
  let viewRevision = 0;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function releaseFiles() {
    if (!state) return;
    state.blobs.forEach(url => URL.revokeObjectURL(url));
    state.blobs.clear();
    state.root.querySelector('.honors-certificate-body').replaceChildren();
    state.root.querySelector('.private-file-actions').replaceChildren();
  }

  function lock(message = '已锁定，请输入密码重新解锁。') {
    generation++;
    viewRevision++;
    clearTimeout(timer);
    document.querySelectorAll('[data-private-navigation]').forEach(item => item.remove());
    if (!state) return;
    state.controller.abort();
    state.controller = new AbortController();
    state.root.querySelector('dialog').close();
    releaseFiles();
    state.key = null;
    state.data = null;
    state.records = [];
    state.root.querySelector('.private-view-content').replaceChildren();
    state.root.querySelector('.private-view-content').removeAttribute('aria-busy');
    state.root.querySelector('.private-workspace').hidden = true;
    state.root.querySelector('.private-lock-screen').hidden = false;
    state.root.querySelector('#private-password').value = '';
    state.root.querySelector('#private-password').type = 'password';
    state.root.querySelector('[data-vault-show]').textContent = '显示';
    state.root.querySelector('[data-vault-show]').setAttribute('aria-pressed', 'false');
    state.root.querySelector('#private-status').textContent = message;
  }

  function postponeLock() {
    clearTimeout(timer);
    if (state?.key) timer = setTimeout(() => lock('一段时间没有操作，已自动锁定。'), 15 * 60 * 1000);
  }

  function addNavigation() {
    const lockButton = node('button', 'private-session-lock', '锁定'); lockButton.type = 'button'; lockButton.dataset.vaultLock = ''; lockButton.dataset.privateNavigation = ''; lockButton.setAttribute('aria-label', '锁定私人空间');
    document.querySelector('.home-navbar-tools')?.prepend(lockButton);
    const subnav = document.getElementById('sidebar-category-links');
    const item = node('li');
    item.dataset.privateNavigation = '';
    const link = node('a', '', '私人专栏');
    link.href = '#example3'; link.dataset.vaultView = 'example3';
    item.append(link); subnav?.append(item);
    const list = document.querySelector('#sidebar nav > ul');
    const recentItem = node('li', 'nav-item'); recentItem.dataset.privateNavigation = '';
    const recentLink = node('a', 'nav-link'); recentLink.href = '#recent'; recentLink.dataset.vaultView = 'recent';
    recentLink.append(node('span', '', '最近记录')); recentItem.append(recentLink); list?.prepend(recentItem);
    const honorItem = node('li', 'nav-item'); honorItem.dataset.privateNavigation = '';
    const honorLink = node('a', 'nav-link'); honorLink.href = '#honors'; honorLink.dataset.vaultView = 'honors';
    const icon = node('i', 'fa-fw fas fa-award'); icon.setAttribute('aria-hidden', 'true');
    honorLink.append(icon, node('span', '', '荣誉成果')); honorItem.append(honorLink); list?.append(honorItem);
  }

  function render(view = 'recent') {
    if (!state?.data) return;
    viewRevision++;
    const content = state.root.querySelector('.private-view-content');
    content.replaceChildren();
    content.removeAttribute('aria-busy');
    state.root.querySelector('[data-vault-heading]').textContent = { recent: '最近记录', example3: '私人专栏', honors: '荣誉成果' }[view] || '最近记录';
    document.querySelectorAll('[data-private-navigation] [data-vault-view]').forEach(button => {
      if (button.dataset.vaultView === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.closest('.nav-item')?.classList.toggle('active', button.dataset.vaultView === view);
    });
    if (view === 'honors') {
      let index = 0;
      state.records = [];
      for (const section of state.data.honors) {
        content.append(node('h2', '', section.title || '荣誉记录'));
        const wrapper = node('div', 'private-table-wrap');
        const table = node('table', 'private-table');
        const row = node('tr');
        for (const name of ['时间', '名称', '奖项 / 状态', '单位 / 刊物']) row.append(node('th', '', name));
        const head = node('thead'); head.append(row); table.append(head);
        const body = node('tbody');
        const records = [...(section.records || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        for (const record of records) {
          const tr = node('tr');
          tr.append(node('td', '', record.date || ''));
          const name = node('td');
          const button = node('button', '', record.name || '未命名记录'); button.type = 'button'; button.dataset.privateCertificate = String(index++);
          name.append(button); tr.append(name, node('td', '', record.award || record.status || ''), node('td', '', record.organizer || record.publisher || ''));
          body.append(tr); state.records.push(record);
        }
        table.append(body); wrapper.append(table); content.append(wrapper);
      }
      if (!state.records.length) content.append(node('p', 'private-empty', '还没有加入私人荣誉记录。'));
    } else {
      const posts = [...state.data.posts].filter(post => view !== 'example3' || post.category === 'example3').sort((a, b) => String(b.date).localeCompare(String(a.date)));
      for (const post of posts) {
        const article = node('article', 'private-record');
        const time = node('time', '', post.date || ''); time.dateTime = post.date || '';
        article.append(time, node('h2', '', post.title || '未命名记录'), node('div', 'private-record-body', post.content || ''));
        content.append(article);
      }
      if (!posts.length) content.append(node('p', 'private-empty', '这里还没有记录，慢慢写就好。'));
    }
  }

  async function showPublicPage(url) {
    const current = ++viewRevision;
    const root = state.root;
    const content = root.querySelector('.private-view-content');
    content.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url.href, { signal: state.controller.signal });
      if (!response.ok) throw new Error('无法读取页面');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const panel = page.querySelector('#panel-content');
      if (!panel) throw new Error('页面内容不可用');
      if (current !== viewRevision || !state?.key || state.root !== root) return;
      panel.querySelectorAll('script').forEach(script => script.remove());
      content.replaceChildren(...[...panel.childNodes].map(child => document.importNode(child, true)));
      root.querySelector('[data-vault-heading]').textContent = page.querySelector('main h1, .home-feed-heading h2')?.textContent || page.title.split('|')[0].trim();
      document.querySelectorAll('[data-private-navigation] [data-vault-view]').forEach(link => { link.removeAttribute('aria-current'); link.closest('.nav-item')?.classList.remove('active'); });
      history.replaceState(history.state, '', '#public=' + encodeURIComponent(url.pathname + url.search + url.hash));
      document.dispatchEvent(new CustomEvent('site:content-loaded'));
      if (url.hash) {
        const target = [...content.querySelectorAll('[id]')].find(element => element.id === decodeURIComponent(url.hash.slice(1)));
        target?.scrollIntoView({ block: 'start' });
      }
    } catch (error) {
      if (current === viewRevision && state?.key && error.name !== 'AbortError') content.replaceChildren(node('p', 'private-empty', '页面暂时无法加载，请重新点击左侧栏目。私人空间仍保持解锁。'));
    } finally { if (current === viewRevision) content.removeAttribute('aria-busy'); }
  }

  async function fileBlob(file, current) {
    if (!/^[0-9a-f-]{36}$/.test(file.id)) throw new Error('Invalid attachment');
    const base = new URL(state.root.dataset.vaultManifest, location.href);
    const url = new URL('files/' + file.id + '.bin', base);
    const response = await fetch(url, { cache: 'no-store', signal: state.controller.signal });
    if (!response.ok) throw new Error('Missing attachment');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(file.iv), additionalData: utf8.encode('wyc-vault:file:' + file.id) }, state.key, await response.arrayBuffer());
    if (current !== generation || !state.key) throw new Error('Locked');
    return new Blob([plain], { type: file.type });
  }

  function keepUrl(blob) {
    const url = URL.createObjectURL(blob); state.blobs.add(url); return url;
  }

  function download(blob, name) {
    const url = keepUrl(blob);
    const link = node('a'); link.href = url; link.download = name; link.hidden = true;
    state.root.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); state?.blobs.delete(url); }, 60000);
  }

  async function preview(index) {
    const record = state?.records?.[index];
    if (!record || !state.key) return;
    const current = ++generation;
    releaseFiles();
    const dialog = state.root.querySelector('dialog');
    const body = dialog.querySelector('.honors-certificate-body');
    dialog.querySelector('.private-certificate-title').textContent = record.name;
    body.append(node('p', '', '正在读取证书…')); dialog.showModal();
    try {
      const imageFile = record.certificates?.[0];
      const file = imageFile || record.certificate_pdf;
      if (!file) { body.replaceChildren(node('p', '', '这项记录还没有添加证书。')); return; }
      const blob = await fileBlob(file, current);
      if (current !== generation || !dialog.open) return;
      const element = node(imageFile ? 'img' : 'iframe', 'honors-certificate-image');
      element.src = keepUrl(blob); element.title = record.name; element.alt = record.name;
      body.replaceChildren(element);
      const actions = dialog.querySelector('.private-file-actions');
      if (imageFile) {
        const png = node('button', '', '下载 PNG'); png.type = 'button'; png.disabled = true;
        element.onload = () => { png.disabled = false; };
        png.onclick = async () => {
          png.disabled = true;
          try {
            const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
            canvas.getContext('2d').drawImage(element, 0, 0);
            const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (result && current === generation && state.key) download(result, imageFile.name.replace(/\.[^.]+$/, '') + '.png');
          } finally { png.disabled = false; }
        };
        actions.append(png);
      }
      if (record.certificate_pdf) {
        const pdf = node('button', '', '下载 PDF'); pdf.type = 'button';
        pdf.onclick = async () => {
          pdf.disabled = true;
          try { const result = await fileBlob(record.certificate_pdf, current); if (current === generation) download(result, record.certificate_pdf.name); }
          catch { if (current === generation) body.append(node('p', '', '下载失败，请重试。')); }
          finally { pdf.disabled = false; }
        };
        actions.append(pdf);
      }
    } catch { if (current === generation && dialog.open) body.replaceChildren(node('p', '', '证书暂时无法读取，请确认附件已上传。')); }
  }

  async function unlock(event) {
    event.preventDefault();
    const root = event.target.closest('[data-private-portal]');
    if (!root || state?.root !== root) return;
    const password = root.querySelector('#private-password');
    const status = root.querySelector('#private-status');
    const button = root.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const enteredBytes = utf8.encode(password.value);
    const enteredLength = password.value.length;
    password.value = '';
    let packageId = '';
    const current = ++generation;
    button.disabled = true; status.textContent = '正在解锁，请稍候…';
    try {
      if (!crypto.subtle) throw new Error('此浏览器不支持解锁，请使用 HTTPS 或本地预览访问。');
      const manifestUrl = new URL(root.dataset.vaultManifest, location.href);
      manifestUrl.searchParams.set('fresh', crypto.randomUUID());
      const response = await fetch(manifestUrl, { cache: 'no-store', signal: state.controller.signal });
      if (response.status === 404) throw new Error('私人空间尚未启用。请先在电脑上运行“设置私人空间.ps1”并上传加密内容。');
      if (!response.ok) throw new Error('暂时无法读取私人空间，请稍后再试。');
      const envelope = await response.json();
      if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 600000) throw new Error('加密文件格式不受支持。');
      packageId = [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(envelope.ciphertext)))].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const material = await crypto.subtle.importKey('raw', enteredBytes, 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: decode(envelope.salt), iterations: envelope.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      let data;
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: utf8.encode('wyc-vault:manifest:v1') }, key, decode(envelope.ciphertext));
        data = JSON.parse(new TextDecoder().decode(plain));
        if (!Array.isArray(data.posts) || !Array.isArray(data.honors)) throw new Error();
      } catch (error) {
        const diagnostic = new URL(location.href).searchParams.has('diagnose') ? '（诊断：' + packageId + '；' + error.name + '；输入 ' + enteredLength + ' 位）' : '';
        throw new Error('密码不正确，或加密文件已损坏，请重试。' + diagnostic);
      }
      if (current !== generation || !document.contains(root)) return;
      state.key = key; state.data = data;
      root.querySelector('.private-lock-screen').hidden = true;
      root.querySelector('.private-workspace').hidden = false;
      addNavigation(); render(['honors', 'example3'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'recent');
      postponeLock();
    } catch (error) { if (current === generation) status.textContent = error.name === 'AbortError' ? '已取消解锁。' : error.message; }
    finally { enteredBytes.fill(0); password.value = ''; password.type = 'password'; root.querySelector('[data-vault-show]').textContent = '显示'; root.querySelector('[data-vault-show]').setAttribute('aria-pressed', 'false'); button.disabled = false; }
  }

  function initialize() {
    const root = document.querySelector('[data-private-portal]');
    if (state?.root === root) return;
    lock(); state = null;
    if (!root) return;
    state = { root, data: null, key: null, records: [], blobs: new Set(), controller: new AbortController() };
    root.querySelector('form.private-unlock-form').addEventListener('submit', unlock);
    root.querySelector('dialog').addEventListener('close', () => { if (state?.root === root) { generation++; releaseFiles(); } });
  }
  document.addEventListener('click', event => {
    const visibility = event.target.closest('[data-vault-show]');
    if (visibility && state) {
      const password = state.root.querySelector('#private-password');
      const shown = password.type === 'password';
      password.type = shown ? 'text' : 'password';
      visibility.textContent = shown ? '隐藏' : '显示';
      visibility.setAttribute('aria-pressed', String(shown));
    }
    const view = event.target.closest('[data-vault-view]');
    if (view && state?.key) {
      event.preventDefault(); event.stopPropagation();
      render(view.dataset.vaultView);
      history.replaceState(history.state, '', '#' + view.dataset.vaultView);
    }
    if (event.target.closest('[data-vault-lock]')) { lock(); return; }
    const link = event.target.closest('a[href]');
    if (state?.key && link && !view && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.button && !link.target && !link.hasAttribute('download') && link.getAttribute('role') !== 'button') {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname !== location.pathname && !/\.[a-z0-9]+$/i.test(url.pathname) && !url.pathname.startsWith('/assets/')) {
        event.preventDefault(); event.stopImmediatePropagation(); showPublicPage(url); return;
      }
    }
    const proof = event.target.closest('[data-private-certificate]');
    if (proof) preview(Number(proof.dataset.privateCertificate));
  }, true);
  document.addEventListener('pointerdown', postponeLock, { passive: true });
  document.addEventListener('keydown', postponeLock);
  document.addEventListener('site:content-loaded', initialize);
  window.addEventListener('pagehide', () => lock());
  initialize();
  const localSetupNonce = new URL(location.href).searchParams.get('_local_setup');
  if (localSetupNonce && window.opener && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    Object.defineProperty(window, '__wycSetupUnlock', { value: (password, nonce) => {
      if (nonce !== localSetupNonce || typeof password !== 'string' || !state?.root || state.key) return false;
      state.root.querySelector('#private-password').value = password;
      state.root.querySelector('.private-unlock-form').requestSubmit();
      return true;
    }});
  }
})();
