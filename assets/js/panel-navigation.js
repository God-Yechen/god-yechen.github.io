(() => {
  const panel = document.querySelector('main.home-posts');
  const content = document.getElementById('panel-content');
  const privateCenterUrl = new URL(document.currentScript?.dataset.privateCenterUrl || '/private-center/', location.origin);
  if (!panel || !content) return;

  const status = document.getElementById('panel-status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const dependencies = new Map();
  const stylesheets = new Map();
  const theme = typeof Theme === 'undefined' ? null : Theme;
  let request = null;
  let displayedUrl = new URL(location.href);
  let revision = 0;
  let animation = null;
  let clipboard = null;
  let activeToc = null;
  let lightbox = null;
  let scrollFrame = null;

  function savePosition() {
    history.replaceState({
      ...history.state,
      panelNavigation: { url: location.href, x: scrollX, y: scrollY }
    }, '', location.href);
  }

  function loadScript(source) {
    if (dependencies.has(source)) return dependencies.get(source);
    if ([...document.scripts].some(script => script.src === source)) {
      return Promise.resolve();
    }
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        dependencies.delete(source);
        reject(new Error('Could not load a page dependency.'));
      };
      document.head.append(script);
    });
    dependencies.set(source, promise);
    return promise;
  }

  async function loadDependencies(page, url) {
    const styles = [...page.head.querySelectorAll('link[rel="stylesheet"]')];
    await Promise.all(styles.map(link => {
      const source = new URL(link.getAttribute('href'), url).href;
      if (stylesheets.has(source)) return stylesheets.get(source);
      if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(item => item.href === source)) {
        return Promise.resolve();
      }
      const promise = new Promise((resolve, reject) => {
        const stylesheet = link.cloneNode(true);
        stylesheet.href = source;
        stylesheet.onload = resolve;
        stylesheet.onerror = () => {
          stylesheet.remove();
          stylesheets.delete(source);
          reject(new Error('Could not load page styling.'));
        };
        document.head.append(stylesheet);
      });
      stylesheets.set(source, promise);
      return promise;
    }));

    for (const script of page.head.querySelectorAll('script[src]')) {
      const source = new URL(script.getAttribute('src'), url);
      if (script.hasAttribute('data-panel-navigation') || script.hasAttribute('data-site-updates') ||
          source.pathname.includes('/assets/js/dist/') ||
          source.pathname.endsWith('/app.min.js') ||
          source.pathname.endsWith('/livereload.js')) continue;
      if (window.MathJax?.typesetPromise && /mathjax/i.test(source.href)) continue;
      await loadScript(source.href);
    }
  }

  function destroyContentFeatures() {
    clipboard?.destroy();
    lightbox?.destroy();
    clipboard = null;
    lightbox = null;
    activeToc?.destroy();
    activeToc = null;
    window.MathJax?.typesetClear?.([content]);
  }

  function setupLightbox() {
    lightbox?.destroy();
    lightbox = null;
    if (!window.GLightbox || !content.querySelector('.popup')) return;
    const selector = theme?.isDark ? '.popup:not(.light)' : '.popup:not(.dark)';
    lightbox = window.GLightbox({ selector: '#panel-content ' + selector });
  }

  async function refreshContent() {
    for (const time of content.querySelectorAll('time[data-ts][data-df]')) {
      if (window.dayjs) {
        time.textContent = window.dayjs.unix(Number(time.dataset.ts))
          .locale(document.documentElement.lang.toLowerCase())
          .format(time.dataset.df);
      }
    }

    for (const image of content.querySelectorAll('img')) {
      const reveal = () => image.parentElement?.classList.remove('shimmer', 'blur');
      image.addEventListener('load', reveal, { once: true });
      if (image.dataset.src) {
        image.src = image.dataset.src;
        image.removeAttribute('data-src');
      }
      if (image.complete) reveal();
    }

    clipboard?.destroy();
    clipboard = null;
    if (window.ClipboardJS && content.querySelector('.code-header > button')) {
      clipboard = new window.ClipboardJS('#panel-content .code-header > button', {
        target: button => button.parentElement.nextElementSibling.querySelector('code .rouge-code, code')
      });
      clipboard.on('success', event => {
        event.clearSelection();
        const button = event.trigger;
        const icon = button.querySelector('i');
        const previous = icon?.className;
        button.title = button.dataset.titleSucceed || '已复制';
        if (icon) icon.className = 'fas fa-check';
        setTimeout(() => {
          button.removeAttribute('title');
          if (icon) icon.className = previous;
        }, 2000);
      });
    }

    setupLightbox();
    if (window.tocbot && content.querySelector('#toc')) {
      activeToc = window.tocbot;
      activeToc.init({
        tocSelector: '#toc',
        contentSelector: '#panel-content .content',
        headingSelector: 'h2, h3, h4',
        ignoreSelector: '[data-toc-skip]',
        orderedList: false,
        scrollSmooth: false
      });
      content.querySelector('#toc-wrapper').classList.remove('invisible');
    }

    const diagrams = [];
    for (const source of content.querySelectorAll('.language-mermaid')) {
      const diagram = document.createElement('pre');
      diagram.className = 'mermaid';
      diagram.textContent = source.textContent;
      const block = source.closest('.highlighter-rouge') || source.closest('pre') || source;
      block.classList.add('d-none');
      block.after(diagram);
      diagrams.push(diagram);
    }
    if (window.mermaid && diagrams.length) {
      window.mermaid.initialize({ startOnLoad: false, theme: theme?.isDark ? 'dark' : 'default' });
      await window.mermaid.run({ nodes: diagrams });
    }
    if (window.MathJax?.typesetPromise) {
      await window.MathJax.startup?.promise;
      await window.MathJax.typesetPromise([content]);
    }
  }

  function updateNavigation(page) {
    for (const link of document.querySelectorAll('.home-navbar-links a, #sidebar nav a.nav-link')) {
      const incoming = [...page.querySelectorAll('.home-navbar-links a, #sidebar nav a.nav-link')]
        .find(item => item.getAttribute('href') === link.getAttribute('href') &&
          item.closest('nav').getAttribute('class') === link.closest('nav').getAttribute('class'));
      const active = !!incoming && (incoming.hasAttribute('aria-current') ||
        incoming.closest('.nav-item')?.classList.contains('active'));
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      link.closest('.nav-item')?.classList.toggle('active', active);
    }
  }

  function updateMetadata(page) {
    document.title = page.title;
    const selector = 'meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], meta[property^="twitter:"], meta[property^="article:"], link[rel="canonical"]';
    document.head.querySelectorAll(selector).forEach(item => item.remove());
    page.head.querySelectorAll(selector).forEach(item => document.head.append(item.cloneNode(true)));
  }

  function resetSearch() {
    const cancel = document.getElementById('search-cancel');
    if (cancel.classList.contains('d-block')) cancel.click();
    const input = document.getElementById('search-input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function showAnchor(url) {
    if (!url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target && content.contains(target)) target.scrollIntoView({ block: 'nearest' });
  }

  async function runPageScripts(page) {
    const target = document.getElementById('panel-page-scripts');
    target.replaceChildren();
    for (const original of page.querySelectorAll('#panel-page-scripts script, #panel-content script')) {
      const script = document.createElement('script');
      for (const attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
      script.textContent = original.textContent;
      target.append(script);
    }
  }

  async function navigate(url, options = {}) {
    request?.abort();
    const current = ++revision;
    request = new AbortController();
    panel.setAttribute('aria-busy', 'true');
    status.textContent = '正在加载内容';
    animation?.cancel();
    const deadline = setTimeout(() => {
      if (current === revision) location.assign(url.href);
    }, 15000);

    try {
      const response = await fetch(url.href, { signal: request.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Page request failed.');
      const anchor = url.hash;
      url = new URL(response.url);
      url.hash = anchor;
      if (url.origin !== location.origin) throw new Error('Page redirected to another site.');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const incoming = page.getElementById('panel-content');
      const incomingPanel = page.querySelector('main.home-posts');
      if (!incoming || !incomingPanel) throw new Error('Page has no shared content panel.');
      const currentBuild = document.querySelector('meta[name="site-version"]')?.content;
      const incomingBuild = page.querySelector('meta[name="site-version"]')?.content;
      if (currentBuild && incomingBuild && currentBuild !== incomingBuild) {
        const fresh = new URL(url.href);
        fresh.searchParams.set('_site_v', incomingBuild);
        fresh.searchParams.set('_site_r', String(Date.now()));
        clearTimeout(deadline);
        location.replace(fresh.href);
        return;
      }
      await loadDependencies(page, url);
      if (current !== revision) return;

      const position = options.position || { x: scrollX, y: scrollY };
      if (!options.fromHistory) {
        savePosition();
        history.pushState({ panelNavigation: { url: url.href, ...position } }, '', url.href);
      }
      destroyContentFeatures();
      resetSearch();
      content.replaceChildren(...[...incoming.childNodes].map(node => document.importNode(node, true)));
      panel.setAttribute('aria-label', incomingPanel.getAttribute('aria-label'));
      panel.dataset.pageLayout = incomingPanel.dataset.pageLayout;
      displayedUrl = new URL(url.href);
      updateNavigation(page);
      updateMetadata(page);
      window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
      await refreshContent();
      if (current !== revision) return;
      await runPageScripts(page);
      if (current !== revision) return;
      if (!options.fromHistory) showAnchor(url);
      panel.focus({ preventScroll: true });
      if (!reducedMotion.matches) {
        animation = content.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
      }
      status.textContent = (page.title.split('|')[0].trim() || '页面') + '已加载';
      document.dispatchEvent(new CustomEvent('site:content-loaded', { detail: { url: url.href } }));
    } catch (error) {
      if (error.name !== 'AbortError' && current === revision) location.assign(url.href);
    } finally {
      clearTimeout(deadline);
      if (current === revision) {
        request = null;
        panel.removeAttribute('aria-busy');
      }
    }
  }

  let privateShortcutHeld = false;
  const resetPrivateShortcut = () => { privateShortcutHeld = false; };
  document.addEventListener('keydown', event => {
    const modifier = ['Control', 'Shift', 'Alt'].includes(event.key);
    if (event.defaultPrevented || !modifier || !event.ctrlKey || !event.shiftKey || !event.altKey || event.metaKey || event.isComposing || event.getModifierState?.('AltGraph')) return;
    event.preventDefault();
    if (event.repeat || privateShortcutHeld) return;
    privateShortcutHeld = true;
    if (location.pathname === privateCenterUrl.pathname) {
      document.getElementById('private-password')?.focus({ preventScroll: true });
      return;
    }
    navigate(new URL(privateCenterUrl.href));
  }, { capture: true });
  document.addEventListener('keyup', event => {
    if (!event.ctrlKey || !event.shiftKey || !event.altKey) resetPrivateShortcut();
  }, { capture: true });
  window.addEventListener('blur', resetPrivateShortcut);

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || link.target || link.getAttribute('role') === 'button') return;
    const url = new URL(link.href, location.href);
    const filename = url.pathname.split('/').pop();
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol) ||
        (filename.includes('.') && !filename.endsWith('.html'))) return;
    event.preventDefault();
    if (url.pathname === displayedUrl.pathname && url.search === displayedUrl.search) {
      request?.abort();
      request = null;
      revision++;
      panel.removeAttribute('aria-busy');
      status.textContent = '';
      if (url.href !== location.href) {
        savePosition();
        history.pushState({ panelNavigation: { url: url.href, x: scrollX, y: scrollY } }, '', url.href);
        showAnchor(url);
      }
      return;
    }
    navigate(url);
  });

  window.addEventListener('popstate', event => {
    navigate(new URL(location.href), { fromHistory: true, position: event.state?.panelNavigation || { x: 0, y: 0 } });
  });

  window.addEventListener('scroll', () => {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (!panel.hasAttribute('aria-busy')) savePosition();
    });
  }, { passive: true });

  window.addEventListener('message', event => {
    if (event.source === window && event.data?.id === theme?.eventId) setupLightbox();
  });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const restoredPosition = history.state?.panelNavigation;
  if (restoredPosition?.url === location.href) {
    requestAnimationFrame(() => window.scrollTo({ left: restoredPosition.x, top: restoredPosition.y, behavior: 'instant' }));
  }
  savePosition();
  refreshContent().catch(error => console.error('Could not initialize page content.', error));
})();
