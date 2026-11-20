(() => {
  const version = document.querySelector('meta[name="site-version"]')?.content;
  const source = document.currentScript?.src;
  if (!version || !source) return;
  const base = new URL('../../', source);
  const arrival = new URL(location.href);
  const arrivalVersion = arrival.searchParams.get('_site_v');
  if (arrival.searchParams.has('_site_v') || arrival.searchParams.has('_site_r')) {
    arrival.searchParams.delete('_site_v');
    arrival.searchParams.delete('_site_r');
    history.replaceState(history.state, '', arrival.href);
  }

  let pendingVersion = null;
  let checking = false;
  let refreshing = false;
  let registration = null;
  const guardKey = 'site-update-attempt:' + base.pathname;

  function refreshWhenReady() {
    if (!pendingVersion || refreshing || document.visibilityState !== 'visible') return;
    if (document.querySelector('dialog[open], main[aria-busy="true"]')) return;
    const focused = document.activeElement;
    if (focused?.matches('input, textarea, select, [contenteditable="true"]')) return;
    // A temporarily mixed deployment must never cause a reload loop.
    let previous;
    try { previous = JSON.parse(sessionStorage.getItem(guardKey)); } catch {}
    if (previous?.version === pendingVersion && Date.now() - previous.time < 60000) return;
    if (!previous && arrivalVersion === pendingVersion) return;
    try { sessionStorage.setItem(guardKey, JSON.stringify({ version: pendingVersion, time: Date.now() })); } catch {}
    refreshing = true;
    const fresh = new URL(location.href);
    fresh.searchParams.set('_site_v', pendingVersion);
    fresh.searchParams.set('_site_r', String(Date.now()));
    history.replaceState({
      ...history.state,
      panelNavigation: { url: location.href, x: scrollX, y: scrollY }
    }, '', location.href);
    location.replace(fresh.href);
  }

  function requestRefresh(nextVersion) {
    if (typeof nextVersion !== 'string' || !/^\d+$/.test(nextVersion) || nextVersion === version) return;
    pendingVersion = nextVersion;
    refreshWhenReady();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type !== 'SITE_VERSION_CHECK') return;
      event.ports[0]?.postMessage({ managed: true, version });
      requestRefresh(event.data.version);
    });
    navigator.serviceWorker.register(new URL('sw.min.js', base), {
      scope: base.pathname,
      updateViaCache: 'none'
    }).then(result => {
      registration = result;
      const activate = () => registration.waiting?.postMessage('SKIP_WAITING');
      activate();
      result.addEventListener('updatefound', () => {
        result.installing?.addEventListener('statechange', activate);
      });
      result.update().catch(() => {});
    }).catch(() => {});
  }

  async function checkVersion() {
    if (checking || refreshing || document.visibilityState !== 'visible' || !navigator.onLine) return;
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const endpoint = new URL('site-version.json', base);
      endpoint.searchParams.set('check', String(Date.now()));
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
      if (response.ok) requestRefresh((await response.json()).version);
    } catch {
      // Leave the current page usable while offline or during a deployment.
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
    registration?.update().catch(() => {});
    refreshWhenReady();
  }

  for (const event of ['focus', 'online']) window.addEventListener(event, checkVersion);
  document.addEventListener('visibilitychange', checkVersion);
  for (const event of ['close', 'focusout', 'site:content-loaded']) {
    document.addEventListener(event, () => setTimeout(refreshWhenReady, 0), true);
  }
  setInterval(checkVersion, 60000);
  checkVersion();
})();
