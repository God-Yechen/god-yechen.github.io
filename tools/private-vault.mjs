import { readFile, writeFile, mkdir, copyFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { startVaultBridge, workspaceId } from './private-vault-bridge.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(repo, '.private-local');
const input = path.join(local, 'vault.json');
const output = path.join(repo, 'assets/private-vault');
const utf8 = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64');
const action = process.argv[2];

async function initialize() {
  await mkdir(local, { recursive: true });
  try { await readFile(input); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(path.join(repo, 'tools/private-vault.example.json'), input);
  }
}

async function encryptVault(password, source = input, destination = output) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('密码至少 8 个字符，建议使用随机长密码；不要使用姓名、生日或手机号。');
  const data = JSON.parse((await readFile(source, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(data.posts) || !Array.isArray(data.honors)) throw new Error('vault.json 需要 posts 和 honors 数组。');
  const salt = randomBytes(32);
  const material = await webcrypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  if (path.resolve(destination) === path.resolve(output)) {
    let previous;
    try { previous = await readFile(path.join(output, 'manifest.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      const backups = path.join(local, 'backups');
      await mkdir(backups, { recursive: true });
      await writeFile(path.join(backups, 'manifest-' + Date.now() + '-' + randomUUID() + '.json'), previous, { flag: 'wx' });
      console.log('已备份上一份加密入口文件。原文章、证书和旧密文附件保持不变。');
    }
  }
  await mkdir(path.join(destination, 'files'), { recursive: true });
  const files = new Map();
  async function protectFile(sourcePath) {
    if (!sourcePath) return null;
    if (files.has(sourcePath)) return files.get(sourcePath);
    const resolved = await realpath(path.resolve(repo, decodeURIComponent(sourcePath.replace(/^\//, ''))));
    const relative = path.relative(await realpath(repo), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('附件必须放在网站文件夹内。');
    const bytes = await readFile(resolved);
    const id = randomUUID();
    const iv = randomBytes(12);
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode('wyc-vault:file:' + id) }, key, bytes);
    const extension = path.extname(resolved).toLowerCase();
    const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' }[extension];
    if (!type) throw new Error('证书附件仅支持 JPG、PNG 和 PDF。');
    const descriptor = { id, iv: b64(iv), name: path.basename(resolved), type };
    await writeFile(path.join(destination, 'files', id + '.bin'), Buffer.from(ciphertext));
    files.set(sourcePath, descriptor);
    return descriptor;
  }
  for (const section of data.honors) {
    for (const record of section.records || []) {
      record.certificates = await Promise.all((record.certificates || []).map(protectFile));
      record.certificate_pdf = await protectFile(record.certificate_pdf);
    }
  }
  const iv = randomBytes(12);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode('wyc-vault:manifest:v1') }, key, utf8.encode(JSON.stringify(data)));
  const envelope = { version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
  await writeFile(path.join(destination, 'manifest.json.tmp'), JSON.stringify(envelope));
  await rename(path.join(destination, 'manifest.json.tmp'), path.join(destination, 'manifest.json'));
  console.log('加密完成。公开输出只有密文，不包含密码和明文标题。附件数量：' + files.size);
}

async function verifyVault(password, destination = output) {
  const envelope = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'));
  if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 600000) throw new Error('加密文件格式有误，未修改任何文件。');
  const material = await webcrypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: envelope.iterations, salt: Buffer.from(envelope.salt, 'base64') }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try { plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), additionalData: utf8.encode('wyc-vault:manifest:v1') }, key, Buffer.from(envelope.ciphertext, 'base64')); }
  catch { throw new Error('验证未通过：输入密码与当前加密文件不匹配。未修改任何文件。'); }
  const data = JSON.parse(Buffer.from(plain).toString('utf8'));
  if (!Array.isArray(data.posts) || !Array.isArray(data.honors)) throw new Error('解密成功，但私人内容格式有误。未修改任何文件。');
  console.log('密码验证通过。私人文章：' + data.posts.length + ' 篇，荣誉记录：' + data.honors.reduce((count, section) => count + (section.records || []).length, 0) + ' 项。没有修改加密文件。');
}

async function main() {
  if (action === 'serve-browser') {
    const server = await startVaultBridge({ repo });
    await new Promise(resolve => server.once('close', resolve));
    return;
  }
  if (action === 'browser') {
    const url = 'http://127.0.0.1:4011/local-vault-setup.html?fresh=' + Date.now();
    const id = workspaceId(await realpath(repo));
    const ready = async () => {
      try { const response = await fetch('http://127.0.0.1:4011/__vault/health', { signal: AbortSignal.timeout(500) }); const data = await response.json(); return data.service === 'wyc-local-vault' && data.workspace === id; }
      catch { return false; }
    };
    if (!await ready()) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve-browser'], { cwd: repo, detached: true, windowsHide: true, stdio: 'ignore' });
      child.unref();
      let started = false;
      for (let attempt = 0; attempt < 50; attempt++) { if (await ready()) { started = true; break; } await new Promise(resolve => setTimeout(resolve, 100)); }
      if (!started) { child.kill(); throw new Error('无法启动本机助手，4011 端口可能已被占用。'); }
    }
    const directory = path.join(repo, '_site');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'local-vault-setup.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + url + '"><a href="' + url + '">打开更新的本机设置助手</a>');
    console.log(url);
    return;
  }
  if (action === 'init') { await initialize(); console.log('请编辑 .private-local/vault.json；这个文件不会上传到 GitHub。'); return; }
  if (action === 'import-honors') {
    await initialize();
    const result = spawnSync('C:/Ruby34-x64/bin/ruby.exe', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', path.join(repo, '.private-local/legacy/honors.yml')], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('未能读取原荣誉数据：' + result.stderr);
    const data = JSON.parse(await readFile(input, 'utf8'));
    if (data.honors.length) throw new Error('本地已有荣誉数据，未覆盖。');
    data.honors = JSON.parse(result.stdout);
    await writeFile(input, JSON.stringify(data, null, 2));
    console.log('已复制荣誉数据到本地私人源文件。原公开文件与 Git 历史没有删除。');
    return;
  }
  if (!['encrypt', 'verify'].includes(action)) throw new Error('用法：node tools/private-vault.mjs init | import-honors | encrypt | verify | browser');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const packet = Buffer.concat(chunks).toString('utf8');
  const request = JSON.parse(packet.replace(/^\uFEFF/, ''));
  const { source, destination } = request;
  const password = typeof request.password_base64 === 'string'
    ? Buffer.from(request.password_base64, 'base64').toString('utf8')
    : request.password;
  if (typeof password !== 'string') throw new Error('未收到密码。');
  // Source/destination overrides support isolated tests, never a browser request.
  if (action === 'verify') await verifyVault(password, destination);
  else await encryptVault(password, source, destination);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
