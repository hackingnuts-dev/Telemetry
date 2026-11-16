// Protected by Cloudflare Access: all requests to this dedicated auth Worker.
const encoder = new TextEncoder();
const CODE_TTL = 90000;
function err(status, message) { return Object.assign(new Error(message), { status }); }
function isHex(v,len) { return typeof v==='string' && new RegExp('^[0-9a-f]{'+len+'}$').test(v); }
function hexBytes(length=32) {
 const bytes=new Uint8Array(length);
 crypto.getRandomValues(bytes);
 return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
}
async function hash(str) {
 const data=await crypto.subtle.digest('SHA-256', encoder.encode(str));
 return Array.from(new Uint8Array(data),n=>n.toString(16).padStart(2,'0')).join('');
}
function emailOf(identity) {
 const email=typeof identity?.email==='string'?identity.email.trim().toLowerCase():'';
 return email.length<=254 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email) && !email.includes('..')?email:null;
}
async function accessComplete(req, env, ctx) {
  // This context is populated by the Cloudflare Access edge after policy checks.
  // Never trust an email or JWT pasted in request headers.
  const identity = await ctx?.access?.getIdentity?.();
  const email = emailOf(identity);
  if (!email) throw err(403, 'Cloudflare Access authentication required');
  const url = new URL(req.url);
  const state = url.searchParams.get('state'),
    challenge = url.searchParams.get('challenge');
  if (!isHex(state, 32) || !isHex(challenge, 64)) throw err(400, 'Invalid login request');
  const code = hexBytes(),
    now = Date.now();
  await env.DB.prepare(
    'INSERT INTO access_login_codes(code_hash,state_hash,verifier_hash,authenticated_email,issued_at,expires_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(await hash(code), await hash(state), challenge, email, now, now + CODE_TTL)
    .run();
  const callback = new URL('telemetry://family-auth');
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: { Location: callback.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export default {
 async fetch(req,env,ctx) {
  try {
   if (new URL(req.url).pathname !== '/auth/access/complete' || req.method !== 'GET')
     return Response.json({error:'Not found'},{status:404});
   return await accessComplete(req,env,ctx);
  } catch(e) {
   const status=e?.status>=400&&e.status<500?e.status:503;
   return Response.json({error:status===503?'Service unavailable':e.message},{status,headers:{'Cache-Control':'no-store'}});
  }
 }
};
