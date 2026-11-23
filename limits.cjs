'use strict';
const { randomUUID, createHmac } = require('node:crypto');
class LimitError extends Error { constructor(status,message){super(message);this.status=status;} }
function sharedLimits({ url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SECRET_KEY, fetchImpl=fetch }={}) {
  async function rpc(name,body) {
    if (!url || !secret || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new LimitError(503,'ระบบจำกัดการใช้งานยังไม่พร้อม');
    try {
      const r=await fetchImpl(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:secret,...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw new Error('Limiter unavailable');
      return await r.json();
    }catch{throw new LimitError(503,'ระบบจำกัดการใช้งานยังไม่พร้อม กรุณาลองภายหลัง');}
  }
  const hash=value=>createHmac('sha256',secret||'').update(value).digest('hex');
  return {
    async auth(ip) { const data=await rpc('bizplan_auth_limit',{p_ip:hash(ip)}); if(data!==true)throw new LimitError(429,'ดำเนินการถี่เกินไป กรุณารอสักครู่'); },
    async reserve(ip,user,session) {
      const lease=randomUUID();
      const data=await rpc('bizplan_reserve_ai',{p_ip:hash(ip),p_user:user,p_session:session,p_lease:lease});
      if(data!==true)throw new LimitError(429,'ถึงเพดานการใช้งานหรือมีคำขอค้าง กรุณาลองภายหลัง');
      return async()=>{try{await rpc('bizplan_release_ai',{p_lease:lease});}catch{/* Lease expires automatically; no unsafe retry. */}};
    }
  };
}
module.exports={sharedLimits,LimitError};
