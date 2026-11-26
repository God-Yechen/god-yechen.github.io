import { readFile, writeFile, mkdir, readdir, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { webcrypto, randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const utf8 = new TextEncoder();
const exists = async p => { try { return await readFile(p); } catch(e) { if(e.code==='ENOENT') return null; throw e; } };
const ruby = process.env.VISIBILITY_RUBY || 'C:/Ruby34-x64/bin/ruby.exe';
async function run(repo, args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(ruby,args,{cwd:repo,windowsHide:true,env:{...process.env,JEKYLL_ENV:'production',PATH:'C:/Ruby34-x64/bin;'+process.env.PATH}});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let out='',err=''; child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
    child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error('本地构建未通过，已取消更改。'+err.slice(-600))));
  });
}
export async function buildSite(repo) { await run(repo,['-rbundler/setup',path.join(repo,'vendor/bundle/ruby/3.4.0/bin/jekyll'),'build']); }
async function publicPosts(repo) {
  const script=`require 'yaml'; require 'json'; require 'date'; require 'kramdown'; puts JSON.generate(Dir.glob('_posts/*').filter_map { |f| s=File.read(f, encoding:'UTF-8'); m=s.match(/\\A---\\s*\\n(.*?)\\n---\\s*\\n(.*)\\z/m); next unless m; h=YAML.safe_load(m[1],permitted_classes:[Date,Time],aliases:false)||{}; {path:f,source:s,title:h['title'],date:h['date'].to_s,categories:Array(h['categories']||h['category']),content:m[2],html:Kramdown::Document.new(m[2]).to_html} })`;
  return JSON.parse(await run(repo,['-rbundler/setup','-e',script]));
}
export async function applyVisibility({repo,section,visibility,password,revision,build=buildSite}) {
  if(!['public','private'].includes(visibility)||typeof section!=='string'||typeof password!=='string'||password.length<8) throw new Error('设置或密码格式不正确。');
  repo=await realpath(repo);
  const manifestPath='assets/private-vault/manifest.json';
  const old=await readFile(path.join(repo,manifestPath)); const envelope=JSON.parse(old);
  const fingerprint=createHash('sha256').update(envelope.ciphertext).digest('hex').slice(0,16);
  if(revision && revision!==fingerprint) throw new Error('加密文件已更新，请重新解锁后操作。');
  const material=await webcrypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt:Buffer.from(envelope.salt,'base64'),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt','encrypt']);
  let data;
  try {data=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:utf8.encode('wyc-vault:manifest:v1')},key,Buffer.from(envelope.ciphertext,'base64'))));} catch {throw new Error('密码不正确，未修改任何内容。');}
  if(!Array.isArray(data.posts)||!Array.isArray(data.honors))throw new Error('私人空间格式无效。');
  const changes=new Map(); const originals=new Map();
  async function safe(name) {
    if(!name||name.includes('\\')||name.split('/').some(v=>!v||v==='.'||v==='..'||v.includes(':')))throw new Error('不允许操作这个文件路径。');
    const target=path.resolve(repo,name);let parent=path.dirname(target);
    while(true){try{const real=await realpath(parent);if(path.relative(repo,real).startsWith('..'))throw new Error('文件路径超出网站目录。');break;}catch(e){if(e.code!=='ENOENT')throw e;parent=path.dirname(parent);}}
    try{if(path.relative(repo,await realpath(target)).startsWith('..'))throw new Error('不支持目录外的链接。');}catch(e){if(e.code!=='ENOENT')throw e;}
    return target;
  }
  async function change(name,bytes) {await safe(name);changes.set(name,bytes===null?null:Buffer.from(bytes));}
  async function encryptFile(name) {
    const plain=await readFile(await safe(name)),id=randomUUID(),iv=randomBytes(12);
    const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode('wyc-vault:file:'+id)},key,plain);
    await change('assets/private-vault/files/'+id+'.bin',Buffer.from(cipher));
    return {id,iv:iv.toString('base64'),name:path.basename(name),type:({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf'})[path.extname(name).toLowerCase()]||'application/octet-stream'};
  }
  async function decryptFile(file) {
    if(!/^[0-9a-f-]{36}$/.test(file.id))throw new Error('附件标识无效。');
    return Buffer.from(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(file.iv,'base64'),additionalData:utf8.encode('wyc-vault:file:'+file.id)},key,await readFile(await safe('assets/private-vault/files/'+file.id+'.bin'))));
  }
  const statusPath='_data/section_visibility.json'; const statuses=JSON.parse((await exists(path.join(repo,statusPath)))?.toString()||'{}');
  data.visibility ||= {};data.publishedSections ||= {};
  let changedPosts=0;
  if(section.startsWith('category:')) {
    const category=section.slice(9);if(!category||category.length>100)throw new Error('栏目名称无效。');
    const posts=await publicPosts(repo);
    if(visibility==='private') {
      const selected=posts.filter(p=>p.categories.includes(category));
      if(selected.some(p=>p.categories.length!==1))throw new Error('这个栏目含跨栏目文章，请先调整为单一栏目，避免误隐藏其他栏目内容。');
      for(const post of selected) {
        const attachments=[];const refs=[...post.source.matchAll(/(?:\]\(|(?:src|href)=["'])(\/assets\/[^\s)"'#?]+)/g)].map(m=>decodeURIComponent(m[1]).slice(1));
        if(/!\[[^\]]*\]\(https?:|<img[^>]+src=["']https?:/i.test(post.content))throw new Error('文章包含外部图片，需先下载为本地附件，才能一起保护。');
        for(const ref of [...new Set(refs)]) {
          if(!ref.startsWith('assets/img/posts/'))throw new Error('文章引用了共享资源，暂未移动。请把专属附件放进 assets/img/posts/。');
          if(posts.some(other=>!selected.includes(other)&&(other.source.includes('/'+ref)||other.source.includes(encodeURI('/'+ref)))))throw new Error('附件被其他公开文章引用，需先复制为独立附件。');
          const file=await encryptFile(ref);attachments.push({path:ref,file});await change(ref,null);
        }
        data.posts.push({title:post.title,date:post.date,category,content:post.content,html:post.html,sourceArchive:{path:post.path,source:post.source,attachments}});
        await change(post.path,null);changedPosts++;
      }
    } else {
      const privatePosts=data.posts.filter(p=>p.category===category);
      for(const post of privatePosts) {
        let archived=post.sourceArchive;
        if(!archived){const date=(post.date||new Date().toISOString()).slice(0,10);const name=date+'-private-'+randomUUID()+'.md';archived={path:'_posts/'+name,source:'---\n'+JSON.stringify({title:post.title||'未命名记录',date,categories:[category]})+'\n---\n\n'+(post.content||''),attachments:[]};}
        if(await exists(await safe(archived.path)))throw new Error('恢复位置已有同名文章，未覆盖。');
        for(const attachment of archived.attachments||[])await change(attachment.path,await decryptFile(attachment.file));
        await change(archived.path,archived.source);changedPosts++;
      }
      data.posts=data.posts.filter(p=>p.category!==category);
      const names=JSON.parse(await run(repo,['-ryaml','-rjson','-e',"puts JSON.generate(YAML.safe_load(File.read('_data/category_sections.yml',encoding:'UTF-8')))"]));
      if(!names.includes(category)){names.push(category);await change('_data/category_sections.yml',names.map(v=>'- '+JSON.stringify(v)).join('\n')+'\n');}
    }
  } else if(section.startsWith('page:')) {
    const url=section.slice(5);
    const pages={ '/growth-resume/':{path:'_tabs/growth-resume.md',files:[]}, '/about/':{path:'_tabs/about.md',files:[]}, '/footprints/':{path:'_tabs/footprints.md',files:['_data/footprints.yml']}, '/bucket-list/':{path:'_tabs/bucket-list.md',files:['_data/bucket_list.yml']} };
    const entry=pages[url];if(!entry)throw new Error('请在具体专栏或内容页设置，汇总页面不能整体切换。');
    data.privatePages ||= {};
    if(visibility==='private') {
      const source=(await readFile(await safe(entry.path))).toString('utf8');
      if(/!\[[^\]]*\]\(|<img/i.test(source))throw new Error('此页面含独立图片，请先整理附件，避免仅保护正文。');
      const compiled=(await readFile(await safe('_site'+url+'index.html'))).toString('utf8');
      const matched=compiled.match(/<div id="panel-content">([\s\S]*?)<\/div>\s*<\/main>/);
      if(!matched)throw new Error('请先生成该页面的本地预览。');
      const title=source.match(/^title:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g,'') || url;
      const files=[];for(const name of entry.files){files.push({path:name,bytes:(await readFile(await safe(name))).toString('base64')});await change(name,null);}
      data.privatePages[section]={title,path:entry.path,source,html:matched[1],files};await change(entry.path,null);
    } else {
      const saved=data.privatePages[section];if(!saved)throw new Error('没有找到可恢复的页面备份。');
      if(await exists(await safe(saved.path)))throw new Error('恢复位置已有同名页面，未覆盖。');
      await change(saved.path,saved.source);for(const file of saved.files)await change(file.path,Buffer.from(file.bytes,'base64'));delete data.privatePages[section];
    }
  } else if(section==='honors') {
    const exported=data.publishedSections.honors || [];
    if(visibility==='public') {
      const publicHonors=structuredClone(data.honors),files=[];
      for(const group of publicHonors)for(const record of group.records||[]) {
        for(const slot of ['certificates','certificate_pdf']) {
          const items=slot==='certificates'?record[slot]||[]:[record[slot]].filter(Boolean); const mapped=[];
          for(const item of items){const target='assets/published-honors/'+item.id+path.extname(item.name);await change(target,await decryptFile(item));files.push(target);mapped.push('/'+target);}
          record[slot]=slot==='certificates'?mapped:mapped[0]||null;
        }
      }
      const page='_tabs/published-honors.md',json='_data/published_honors.json';
      await change(page,'---\ntitle: 荣誉成果\nlayout: published-honors\npermalink: /honors/\norder: 3\n---\n');await change(json,JSON.stringify(publicHonors));data.publishedSections.honors=[page,json,...files];
    } else {for(const name of exported)await change(name,null);delete data.publishedSections.honors;}
  } else throw new Error('首页是汇总入口；请在具体专栏或荣誉成果中设置可见性。');
  statuses[section]=visibility;data.visibility[section]=visibility;
  const iv=randomBytes(12);const ciphertext=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode('wyc-vault:manifest:v1')},key,utf8.encode(JSON.stringify(data)));
  await change(manifestPath,JSON.stringify({...envelope,iv:iv.toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')}));
  await change(statusPath,JSON.stringify(statuses,null,2)+'\n');
  await change('.private-local/visibility-managed.json',JSON.stringify({managed:true,updatedAt:new Date().toISOString()}));
  const backup='.private-local/visibility-backups/'+Date.now()+'-'+randomUUID();
  for(const [name] of changes){const bytes=await exists(await safe(name));originals.set(name,bytes);if(bytes){const target=path.join(repo,backup,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}}
  await mkdir(path.join(repo,backup),{recursive:true});await writeFile(path.join(repo,backup,'operation.json'),JSON.stringify({section,visibility,paths:[...changes.keys()]}));
  async function writeChanges(map){for(const [name,bytes] of map){const target=await safe(name);if(bytes===null)await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e});else {await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}}}
  try{await writeChanges(changes);await build(repo);}catch(e){await writeChanges(originals);await build(repo).catch(()=>{});throw e;}
  return {ok:true,section,visibility,changedPosts,message:'本地内容处理与构建已完成；线上尚未发布。'};
}
