const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createApp,createHandler}=require('../server.cjs');
const {createSupabase}=require('../supabase.cjs');
const {sharedLimits}=require('../limits.cjs');
const root=path.resolve(__dirname,'..');
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);this.headersSent=true;},end(body){this.body=body;}};}
const preview={vercel:true,deploymentEnv:'preview',previewHost:'bizplan-test.vercel.app'};
const request=(extras={})=>({url:'/api/auth/login',method:'POST',headers:{host:'bizplan-test.vercel.app',origin:'https://bizplan-test.vercel.app','content-type':'application/json','x-vercel-forwarded-for':'203.0.113.10'},body:{email:'test@example.invalid',password:'test-only-password'},...extras});
test('preview handler accepts parsed Vercel bodies, awaits shared auth limit and never listens',async()=>{
  const calls=[];const storage={handle:async(req,_,body,send)=>{calls.push('handle');assert.equal(body.email,'test@example.invalid');assert.equal(req.bizplanOrigin,'https://bizplan-test.vercel.app');send(200,{ok:true});return true;}};
  const handle=createHandler({...preview,storage,limiter:{auth:async ip=>{assert.equal(ip,'203.0.113.10');calls.push('limit');}}});
  const res=response();await handle(request(),res);assert.equal(res.status,200);assert.deepEqual(calls,['limit','handle']);
});
test('preview rejects unapproved hosts, cross-origin requests, unsupported environments and missing IP',async()=>{
  const handle=createHandler({...preview,limiter:{auth:async()=>{}},storage:{handle:async()=>false}});
  for(const [req,status] of [[request({headers:{host:'attacker.example'}}),403],[request({headers:{...request().headers,origin:'https://attacker.example'}}),403],[request({headers:{...request().headers,'x-vercel-forwarded-for':''}}),503]]){const res=response();await handle(req,res);assert.equal(res.status,status);}
  const res=response();await createHandler({...preview,deploymentEnv:'development'})(request(),res);assert.equal(res.status,503);
});
test('preview API fails closed if shared limiter is unavailable, not file-backed fallback',async()=>{
  let handled=false;const res=response();
  await createHandler({...preview,storage:{handle:async()=>{handled=true;}},limiter:sharedLimits({url:'',secret:''})})(request(),res);
  assert.equal(res.status,503);assert.equal(handled,false);
});
test('preview Gemini reserves/releases shared budget and preserves chat API',async()=>{
  const calls=[];
  const storage={handle:async()=>false,authenticate:async()=>({user:{id:'owner'}}),startTurn:async()=>({messages:[{role:'user',content:'ธุรกิจออนไลน์'}]}),finishTurn:async(_,__,reply)=>reply};
  const handle=createHandler({...preview,key:'test-only',storage,limiter:{reserve:async(ip,user,session)=>{assert.equal(user,'owner');assert.equal(session,'session');calls.push('reserve');return async()=>calls.push('release');}},fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'คำถามถัดไป'}]}}]})})});
  const res=response();await handle(request({url:'/api/idea-chat',body:{sessionId:'session',content:'ธุรกิจออนไลน์'}}),res);assert.equal(res.status,200);assert.deepEqual(calls,['reserve','release']);
});
test('shared limiter hashes IPs, enforces deny, and uses server-only RPCs',async()=>{
  const calls=[];
  const limits=sharedLimits({url:'https://test.supabase.co',secret:'sb_secret_test',fetchImpl:async(url,init)=>{calls.push({url,body:JSON.parse(init.body),key:init.headers.apikey});return{ok:true,json:async()=>true};}});
  await limits.auth('203.0.113.1');const release=await limits.reserve('203.0.113.1','owner','session');await release();
  assert.equal(calls.length,3);assert.equal(calls[0].key,'sb_secret_test');assert.match(calls[0].body.p_ip,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(calls).includes('203.0.113.1'),false);
  const deny=sharedLimits({url:'https://test.supabase.co',secret:'test',fetchImpl:async()=>({ok:true,json:async()=>false})});await assert.rejects(deny.auth('ip'),e=>e.status===429);
});
test('HTTPS cookie flags and email redirect preserve exact approved origin',async()=>{
  let sent;
  const storage=createSupabase({url:'https://test.supabase.co',publishable:'sb_publishable_test',secureCookies:true,fetchImpl:async(url,init)=>{sent={url,init};return{ok:true,status:200,json:async()=>({access_token:'access-test',refresh_token:'refresh-test',expires_in:3600})};}});
  const res=response();await storage.handle({...request(),bizplanOrigin:'https://bizplan-test.vercel.app'},res,request().body,()=>{});
  assert.ok(res.headers['Set-Cookie'].every(c=>c.includes('; Secure')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')));
  await storage.handle({...request(),url:'/api/auth/register',bizplanOrigin:'https://bizplan-test.vercel.app'},response(),request().body,()=>{});
  assert.equal(new URL(sent.url).searchParams.get('redirect_to'),'https://bizplan-test.vercel.app/#/login');
});
test('build output contains only unchanged public assets and Vercel routes point to function',()=>{
  require('../scripts/build.cjs');
  assert.deepEqual(fs.readdirSync(path.join(root,'dist')).sort(),['account.js','app.js','index.html','styles.css']);
  for(const file of fs.readdirSync(path.join(root,'dist')))assert.equal(fs.readFileSync(path.join(root,'dist',file),'utf8'),fs.readFileSync(path.join(root,file),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));assert.equal(config.outputDirectory,'dist');assert.equal(config.rewrites[0].source,'/api/:path*');assert.equal(config.rewrites[0].destination,'/api/index?route=:path*');
});
test('Vercel adapter restores API paths and rejects unsafe rewrite input',async()=>{
  const serverPath=require.resolve('../server.cjs');const apiPath=require.resolve('../api/index.js');
  const previous=require.cache[serverPath].exports;const seen=[];
  try{
    require.cache[serverPath].exports={...previous,createHandler:()=>async req=>seen.push(req.url)};
    delete require.cache[apiPath];const adapter=require(apiPath);
    await adapter({url:'/api/index?route=auth/session',query:{route:'auth/session'}},{});
    await adapter({url:'/api/index',query:{route:['chat-sessions','id','messages']}},{});
    await adapter({url:'/api/index?route=../../.env'},{});
    assert.deepEqual(seen,['/api/auth/session','/api/chat-sessions/id/messages','/api/not-found']);
  }finally{require.cache[serverPath].exports=previous;delete require.cache[apiPath];}
});
test('email callback tokens are removed from URL without importing them into browser state',()=>{
  const vm=require('node:vm');const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const prelude=source.slice(0,source.indexOf('// Change the product name'));
  for(const fragment of ['#access_token=test-only-token&refresh_token=test-only-refresh','#error=access_denied&error_description=test-only-error']){
    let replaced;const ctx=vm.createContext({location:{hash:fragment,pathname:'/',search:''},history:{replaceState(_,__,url){replaced=url;}},accountError:''});
    vm.runInContext(prelude,ctx);assert.equal(replaced,'/#/login');assert.ok(ctx.accountError);assert.ok(!ctx.accountError.includes('test-only'));
  }
});

 test('production accepts only exact deployment and production origins with shared limits',async()=>{
  let calls=0;const handle=createHandler({...preview,deploymentEnv:'production',productionHost:'spu-ai-championship.vercel.app',limiter:{auth:async()=>{calls++;}},storage:{handle:async(_,__,___,send)=>{send(200,{ok:true});return true;}}});
  for(const host of ['spu-ai-championship.vercel.app','bizplan-test.vercel.app']){const res=response();await handle(request({headers:{...request().headers,host,origin:'https://'+host}}),res);assert.equal(res.status,200);}
  for(const [host,origin] of [['attacker.vercel.app','https://attacker.vercel.app'],['spu-ai-championship.vercel.app','https://attacker.example'],['spu-ai-championship.vercel.app','http://spu-ai-championship.vercel.app']]){const res=response();await handle(request({headers:{...request().headers,host,origin}}),res);assert.equal(res.status,403);}
  assert.equal(calls,2);
});
test('production fails closed without distributed limits configuration',async()=>{
  const res=response();await createHandler({...preview,deploymentEnv:'production',limiter:sharedLimits({url:'',secret:''}),storage:{handle:async()=>{throw new Error('must not run');}}})(request(),res);assert.equal(res.status,503);
});
