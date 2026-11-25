import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { applyVisibility } from './section-visibility.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=4012,host='127.0.0.1:'+port,origin='http://'+host,token=randomBytes(32).toString('hex');let busy=false;
http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const json=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  try {
    if(req.headers.host!==host)return json(403,{error:'仅支持本机管理。'});
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/__visibility/')) {
      if((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'不允许跨站访问。'});
      if(url.pathname==='/__visibility/session'&&req.method==='GET')return json(200,{token,service:'local-section-visibility'});
      const supplied=req.headers['x-visibility-token'];
      if(typeof supplied!=='string'||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(403,{error:'本机授权失效，请重新打开管理页面。'});
      if(url.pathname!=='/__visibility/apply'||req.method!=='POST')return json(404,{error:'接口不存在。'});
      if(busy)return json(409,{error:'正在处理上一项设置，请稍候。'});
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)return json(413,{error:'请求过大。'});chunks.push(chunk);}
      const args=JSON.parse(Buffer.concat(chunks));busy=true;
      try{return json(200,await applyVisibility({repo,...{section:args.section,visibility:args.visibility,password:args.password,revision:args.revision}}));}
      finally{busy=false;args.password='';}
    }
    if(!['GET','HEAD'].includes(req.method))return json(405,{error:'方法不支持。'});
    const response=await fetch('http://127.0.0.1:4000'+url.pathname+url.search,{redirect:'manual',signal:AbortSignal.timeout(30000)});
    res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')||'application/octet-stream');
    if(response.headers.has('location'))res.setHeader('Location',response.headers.get('location').replace('http://127.0.0.1:4000',origin));
    res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  } catch(error){json(400,{error:error.message||'处理失败。'});}
}).listen(port,'127.0.0.1',()=>console.log(origin+'/private-center/'));
