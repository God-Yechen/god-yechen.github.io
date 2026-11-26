import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir, rename, realpath, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

export const workspaceId = repo => createHash('sha256').update(path.resolve(repo).toLowerCase()).digest('hex');

export async function startVaultBridge({ repo, port = 4011, upstream = 'http://127.0.0.1:4000' }) {
  repo = await realpath(repo);
  const token = randomBytes(32).toString('hex');
  const origin = `http://127.0.0.1:${port}`;
  const id = workspaceId(repo);
  let idle;
  const within = target => target === repo || (!path.relative(repo, target).startsWith('..') && !path.isAbsolute(path.relative(repo, target)));
  function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
  function relative(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) fail(403, '路径不受支持。');
    const parts = value.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) fail(403, '路径不受支持。');
    return parts.join('/');
  }
  async function safeTarget(value, create = false) {
    const name = relative(value);
    const target = path.resolve(repo, ...name.split('/'));
    if (!within(target)) fail(403, '路径超出本地网站目录。');
    let ancestor = path.dirname(target);
    for (;;) {
      try { if (!within(await realpath(ancestor))) fail(403, '路径超出本地网站目录。'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
    }
    if (create) await mkdir(path.dirname(target), { recursive: true });
    return target;
  }
  async function sourceData() {
    try { await readFile(path.join(repo,'.private-local/visibility-managed.json')); fail(409,'栏目已通过可见性管理器更新，请勿使用旧源文件重新生成。请打开 4012 本机管理页面。'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
    const target = await safeTarget('.private-local/vault.json');
    if (!within(await realpath(target))) fail(403, '私人源文件超出网站目录。');
    const data = JSON.parse((await readFile(target, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(data.posts) || !Array.isArray(data.honors)) fail(400, '私人源文件格式有误。');
    return data;
  }
  async function readAllowed(value) {
    const name = relative(value);
    if (!['.private-local/vault.json', 'assets/private-vault/manifest.json'].includes(name)) {
      const source = await sourceData();
      const paths = new Set();
      for (const section of source.honors) for (const record of section.records || []) {
        for (const file of [...(record.certificates || []), record.certificate_pdf].filter(Boolean)) {
          const decoded = decodeURIComponent(file);
          paths.add(relative(decoded.startsWith('/') ? decoded.slice(1) : decoded));
        }
      }
      for (const page of Object.values(source.privatePages || {})) for (const appointment of page.appointments || []) {
        for (const file of [...(appointment.certificates || []),appointment.certificate_pdf].filter(Boolean)) {
          const decoded=decodeURIComponent(file);paths.add(relative(decoded.startsWith('/')?decoded.slice(1):decoded));
        }
      }
      if (!paths.has(name)) fail(403, '仅可读取私人源文件及其证书附件。');
    }
    const target = await safeTarget(name);
    if (!within(await realpath(target))) fail(403, '文件超出本地网站目录。');
    return readFile(target);
  }
  function checkEnvelope(bytes) {
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); } catch { fail(400, '加密入口文件不是有效 JSON。'); }
    const keys = ['version', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'];
    if (Object.keys(data).some(key => !keys.includes(key)) || data.version !== 1 || data.kdf !== 'PBKDF2-SHA256' || data.iterations !== 600000) fail(400, '只允许保存加密入口文件。');
    for (const key of ['salt', 'iv', 'ciphertext']) if (typeof data[key] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data[key])) fail(400, '加密参数无效。');
    if (Buffer.from(data.salt, 'base64').length !== 32 || Buffer.from(data.iv, 'base64').length !== 12 || Buffer.from(data.ciphertext, 'base64').length < 16) fail(400, '加密参数无效。');
  }
  async function writeAllowed(value, bytes) {
    const name = relative(value);
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const binary = new RegExp('^assets/private-vault/files/' + uuid + '\\.bin$').test(name);
    const backup = new RegExp('^\\.private-local/backups/manifest-browser-[0-9]+-' + uuid + '\\.json$').test(name);
    if (name !== 'assets/private-vault/manifest.json' && !binary && !backup) fail(403, '仅可保存加密输出和密文备份。');
    if (!binary) checkEnvelope(bytes);
    else if (bytes.length < 16) fail(400, '加密附件无效。');
    const target = await safeTarget(name, true);
    const temporary = path.join(path.dirname(target), '.vault-write-' + randomUUID() + '.tmp');
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  async function body(request) {
    let length = 0; const chunks = [];
    for await (const chunk of request) { length += chunk.length; if (length > 64 * 1024 * 1024) fail(413, '单个附件超过 64 MB。'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  function authenticated(request) {
    if (request.headers.origin && request.headers.origin !== origin) fail(403, '仅允许本机助手页面操作。');
    if (request.headers['sec-fetch-site'] === 'cross-site') fail(403, '不允许跨站操作。');
    const candidate = request.headers['x-vault-token'];
    if (typeof candidate !== 'string' || candidate.length !== token.length || !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) fail(403, '本机助手连接已失效，请重新打开。');
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.host !== `127.0.0.1:${port}`) fail(403, '只允许本机访问。');
      const url = new URL(request.url, origin);
      clearTimeout(idle); idle = setTimeout(() => server.close(), 30 * 60 * 1000); idle.unref();
      if (url.pathname === '/__vault/health' && request.method === 'GET') {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ service: 'wyc-local-vault', workspace: id })); return;
      }
      if (url.pathname === '/local-vault-setup.html' && request.method === 'GET') {
        const nonce = randomBytes(18).toString('base64');
        const template = await readFile(path.join(repo, 'tools/private-vault-setup.html'), 'utf8');
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        response.end(template.replaceAll('__NONCE__', nonce).replaceAll('__BRIDGE_TOKEN__', token)); return;
      }
      if (url.pathname.startsWith('/__vault/')) {
        authenticated(request);
        if (url.pathname === '/__vault/read' && request.method === 'GET') {
          const bytes = await readAllowed(url.searchParams.get('path'));
          response.setHeader('Content-Type', 'application/octet-stream'); response.end(bytes); return;
        }
        if (url.pathname === '/__vault/write' && request.method === 'PUT') {
          await writeAllowed(url.searchParams.get('path'), await body(request));
          response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true}'); return;
        }
        fail(404, '接口不存在。');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') fail(405, '方法不支持。');
      const target = new URL(url.pathname + url.search, upstream);
      const result = await fetch(target, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      response.statusCode = result.status;
      response.setHeader('Content-Type', result.headers.get('content-type') || 'application/octet-stream');
      const location = result.headers.get('location');
      if (location) response.setHeader('Location', location.replace(upstream, origin));
      response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      response.statusCode = error.status || (error.code === 'ENOENT' ? 404 : 500);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: error.status ? error.message : error.code === 'ENOENT' ? '本地文件不存在。' : '本机助手暂时无法完成操作。' }));
    }
  });
  server.once('close', () => clearTimeout(idle));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
