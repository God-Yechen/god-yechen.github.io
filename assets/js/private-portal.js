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
    document.querySelectorAll('[data-private-home]').forEach(link => { delete link.dataset.privateHome; delete link.dataset.vaultView; link.removeAttribute('aria-current'); link.closest('.nav-item')?.classList.remove('active'); });
    if (!state) return;
    state.controller.abort();
    state.controller = new AbortController();
    state.root.querySelector('.private-certificate-dialog').close();
    state.root.querySelector('.private-apply-dialog')?.close();
    const confirmPassword = state.root.querySelector('[data-visibility-form] input'); if(confirmPassword) confirmPassword.value = '';
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
    const subnav = document.getElementById('sidebar-category-links');
    const item = node('li');
    item.dataset.privateNavigation = '';
    const link = node('a', '', '私人专栏');
    link.href = '#example3'; link.dataset.vaultView = 'example3';
    item.append(link); subnav?.append(item);
    for (const [id, mode] of Object.entries(state.data.visibility || {})) {
      if (mode !== 'private' || !id.startsWith('category:') || id === 'category:example3') continue;
      const row = node('li'); row.dataset.privateNavigation = '';
      const entry = node('a','',id.slice(9));entry.href='#'+encodeURIComponent(id);entry.dataset.vaultView=id;row.append(entry);subnav?.append(row);
    }
    const list = document.querySelector('#sidebar nav > ul');
    for(const [id,page] of Object.entries(state.data.privatePages || {})) {
      if(state.data.visibility?.[id]!=='private')continue;
      const row=node('li','nav-item');row.dataset.privateNavigation='';const entry=node('a','nav-link',page.title);entry.href='#'+encodeURIComponent(id);entry.dataset.vaultView=id;row.append(entry);list?.append(row);
    }
    document.querySelectorAll('#sidebar a[href="/"], .home-navbar a[href="/"]').forEach(link => {
      link.dataset.privateHome = ''; link.dataset.vaultView = 'recent';
    });
    const honorItem = node('li', 'nav-item'); honorItem.dataset.privateNavigation = '';
    const honorLink = node('a', 'nav-link'); honorLink.href = '#honors'; honorLink.dataset.vaultView = 'honors';
    const icon = node('i', 'fa-fw fas fa-award'); icon.setAttribute('aria-hidden', 'true');
    honorLink.append(icon, node('span', '', '荣誉成果')); honorItem.append(honorLink); list?.append(honorItem);
  }

  function setSectionVisibility(id, initial) {
    if (!state?.key) return;
    const actual = state.data.visibility?.[id] || initial;
    state.section = { id, published: actual };
    const supported = id === 'honors' || id.startsWith('category:') || ['page:/about/','page:/footprints/','page:/bucket-list/'].includes(id);
    state.root.querySelectorAll('[data-visibility]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.visibility === actual)); button.disabled = !supported; });
    state.root.querySelector('[data-visibility-status]').textContent = supported
      ? '本地状态：' + (actual === 'public' ? '公开' : '私密') + '。切换会实际处理本地内容，确认上传后线上才生效。'
      : '这是汇总或系统页面，请在具体专栏、荣誉成果中设置公开或私密。';
  }
  async function applySectionVisibility(event) {
    event.preventDefault();
    if (!state?.key || !state.pendingVisibility) return;
    const root = state.root, form = event.target, input = form.elements.password, password = input.value;
    input.value = '';
    const output = form.querySelector('[data-visibility-result]'), submit = form.querySelector('[type=submit]');
    submit.disabled = true; form.querySelector('[data-visibility-cancel]').disabled = true;
    output.textContent = '正在保护内容并重新构建，请稍候……';
    const pending = { ...state.pendingVisibility };
    try {
      const sessionResponse = await fetch('/__visibility/session', {cache:'no-store'});
      if (!sessionResponse.ok) throw new Error('请从本机管理地址 http://127.0.0.1:4012/private-center/ 打开。');
      const session = await sessionResponse.json();
      const response = await fetch('/__visibility/apply', {method:'POST',headers:{'Content-Type':'application/json','X-Visibility-Token':session.token},body:JSON.stringify({section:pending.id,visibility:pending.value,password,revision:state.manifestRevision})});
      const result = await response.json(); if(!response.ok) throw new Error(result.error || '内容处理失败。');
      if (!state?.key || state.root !== root) return;
      const envelope = await fetch(root.dataset.vaultManifest+'?fresh='+Date.now(),{cache:'no-store'}).then(r=>r.json());
      const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:utf8.encode('wyc-vault:manifest:v1')},state.key,decode(envelope.ciphertext));
      state.data = JSON.parse(new TextDecoder().decode(plain));
      state.manifestRevision = [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(envelope.ciphertext)))].map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,16);
      document.querySelectorAll('[data-private-navigation]').forEach(item=>item.remove());
      const refreshed = new DOMParser().parseFromString(await fetch('/?fresh='+Date.now(),{cache:'no-store'}).then(r=>r.text()),'text/html');
      const publicList = refreshed.querySelector('#sidebar nav > ul');
      if(publicList) document.querySelector('#sidebar nav > ul').replaceChildren(...[...publicList.childNodes].map(item=>document.importNode(item,true)));
      document.querySelector('#sidebar a[href="/honors/"]')?.closest('.nav-item')?.remove();
      const categoryToggle=document.querySelector('.sidebar-category-toggle'), categoryLinks=document.querySelector('#sidebar-category-links');
      categoryToggle?.addEventListener('click',()=>{const expanded=categoryToggle.getAttribute('aria-expanded')==='true';categoryToggle.setAttribute('aria-expanded',String(!expanded));categoryToggle.setAttribute('aria-label',expanded?'展开专栏':'收起专栏');categoryLinks.hidden=expanded;});
      addNavigation();
      root.querySelector('.private-apply-dialog').close();
      if (pending.id === 'honors') render('honors');
      else if (pending.value === 'private') render(pending.id);
      else if(pending.id.startsWith('page:')) await showPublicPage(new URL(pending.id.slice(5),location.origin));
      else await showPublicPage(new URL('/categories/#'+encodeURIComponent(pending.id.slice(9)),location.origin));
      root.querySelector('[data-visibility-status]').textContent += ' 已完成本地处理，线上尚未发布。';
    } catch(error) { output.textContent = error.message; }
    finally { submit.disabled = false;form.querySelector('[data-visibility-cancel]').disabled = false; }
  }

  function render(view = 'recent') {
    if (!state?.data) return;
    viewRevision++;
    setSectionVisibility(view === 'honors' ? 'honors' : view === 'example3' ? 'category:example3' : view.startsWith('category:') || view.startsWith('page:') ? view : 'home', 'private');
    const content = state.root.querySelector('.private-view-content');
    content.replaceChildren();
    content.removeAttribute('aria-busy');
    state.root.querySelector('[data-vault-heading]').textContent = { recent: '首页', example3: '私人专栏', honors: '荣誉成果' }[view] || (view.startsWith('category:') ? view.slice(9) : state.data.privatePages?.[view]?.title || '首页');
    document.querySelectorAll('[data-private-navigation] [data-vault-view], [data-private-home]').forEach(button => {
      if (button.dataset.vaultView === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.closest('.nav-item')?.classList.toggle('active', button.dataset.vaultView === view);
    });
    if(view.startsWith('page:') && state.data.privatePages?.[view]) {
      const parsed=new DOMParser().parseFromString(state.data.privatePages[view].html,'text/html');
      parsed.querySelectorAll('script:not([type="application/json"]),iframe,object,embed,link,style,form').forEach(element=>element.remove());
      for(const element of parsed.body.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.startsWith('on')||(['href','src'].includes(attr.name)&&/^javascript:/i.test(attr.value)))element.removeAttribute(attr.name);
      content.replaceChildren(...[...parsed.body.childNodes].map(child=>document.importNode(child,true)));
      document.dispatchEvent(new CustomEvent('site:content-loaded'));
    } else if (view === 'honors') {
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
      const posts = [...state.data.posts].filter(post => view === 'example3' ? post.category === 'example3' : view.startsWith('category:') ? post.category === view.slice(9) : true).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      for (const post of posts) {
        const article = node('article', 'private-record');
        const time = node('time', '', post.date || ''); time.dateTime = post.date || '';
        article.append(time, node('h2', '', post.title || '未命名记录'), node('div', 'private-record-body', post.content || ''));
        content.append(article);
        if (post.html) {
          const body = article.querySelector('.private-record-body');body.classList.add('has-markdown');
          const parsed = new DOMParser().parseFromString(post.html, 'text/html');
          parsed.querySelectorAll('script,iframe,object,embed,link,style,form').forEach(element=>element.remove());
          for(const element of parsed.body.querySelectorAll('*')) for(const attr of [...element.attributes]) if(attr.name.startsWith('on')||(['href','src'].includes(attr.name)&&/^javascript:/i.test(attr.value)))element.removeAttribute(attr.name);
          for(const element of parsed.body.querySelectorAll('img[src],a[href]')) { const attr=element.tagName==='IMG'?'src':'href';const raw=element.getAttribute(attr);if(post.sourceArchive?.attachments?.some(a=>decodeURIComponent(raw).replace(/^\//,'')===a.path)){element.dataset.protectedPath=raw;element.removeAttribute(attr);} }
          body.replaceChildren(...[...parsed.body.childNodes].map(element=>document.importNode(element,true)));
          const current = generation, viewAtStart = viewRevision;
          for(const attachment of post.sourceArchive?.attachments || []) {
            const matches = [...body.querySelectorAll('[data-protected-path]')].filter(element=>decodeURIComponent(element.dataset.protectedPath||'').replace(/^\//,'')===attachment.path);
            for(const element of matches) { const attr=element.tagName==='IMG'?'src':'href';element.removeAttribute(attr);fileBlob(attachment.file,current).then(blob=>{if(state?.key&&viewRevision===viewAtStart&&element.isConnected){element.setAttribute(attr,keepUrl(blob));if(element.tagName==='A'){element.target='_blank';element.rel='noopener noreferrer';}}}).catch(()=>{element.setAttribute('title','附件读取失败');}); }
          }
        }
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
      let sectionTitle = '';
      if (url.pathname === '/categories/' && url.hash) {
        const selected = [...panel.querySelectorAll('section[id]')].find(section => section.id === decodeURIComponent(url.hash.slice(1)));
        if (selected) { sectionTitle = selected.querySelector('h2')?.textContent || ''; const card=selected.querySelector('[data-column-card]');if(card)card.open=true; panel.replaceChildren(selected); }
      }
      content.replaceChildren(...[...panel.childNodes].map(child => document.importNode(child, true)));
      root.querySelector('[data-vault-heading]').textContent = sectionTitle || page.querySelector('main h1, .home-feed-heading h2')?.textContent || page.title.split('|')[0].trim();
      document.querySelectorAll('[data-private-navigation] [data-vault-view], [data-private-home]').forEach(link => { link.removeAttribute('aria-current'); link.closest('.nav-item')?.classList.remove('active'); });
      setSectionVisibility(url.pathname === '/categories/' && url.hash ? 'category:' + decodeURIComponent(url.hash.slice(1)) : url.pathname === '/honors/' ? 'honors' : 'page:' + url.pathname, 'public');
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
    const dialog = state.root.querySelector('.private-certificate-dialog');
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
      state.key = key; state.data = data; state.manifestRevision = packageId;
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
    root.querySelector('[data-visibility-form]').addEventListener('submit',applySectionVisibility);
    const applyDialog=root.querySelector('.private-apply-dialog');
    applyDialog.addEventListener('close',()=>{applyDialog.querySelector('input').value='';});
    applyDialog.addEventListener('cancel',event=>{if(applyDialog.querySelector('[type=submit]').disabled)event.preventDefault();});
    root.querySelector('.private-certificate-dialog').addEventListener('close', () => { if (state?.root === root) { generation++; releaseFiles(); } });
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-visibility-cancel]')) state?.root.querySelector('.private-apply-dialog').close();
    const choice = event.target.closest('[data-visibility]');
    if (choice && state?.key && state.section) {
      if (choice.dataset.visibility === state.section.published) return;
      const status = state.root.querySelector('[data-visibility-status]');
      if (location.hostname !== '127.0.0.1' || location.port !== '4012') { status.textContent = '请在本机管理地址 http://127.0.0.1:4012/private-center/ 操作；线上页面不直接修改本地文件。'; return; }
      state.pendingVisibility = {id:state.section.id,value:choice.dataset.visibility};
      const dialog = state.root.querySelector('.private-apply-dialog');
      dialog.querySelector('[data-visibility-confirm]').textContent = '将“'+state.root.querySelector('[data-vault-heading]').textContent+'”改为'+(choice.dataset.visibility === 'public' ? '公开' : '私密')+'？';
      dialog.querySelector('[data-visibility-result]').textContent = '';dialog.showModal();dialog.querySelector('input').focus();return;
    }
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
        event.preventDefault(); event.stopImmediatePropagation();
        const privateTarget = url.pathname === '/categories/' && url.hash ? 'category:'+decodeURIComponent(url.hash.slice(1)) : 'page:'+url.pathname;
        if(state.data.visibility?.[privateTarget]==='private') render(privateTarget);
        else showPublicPage(url);
        return;
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
