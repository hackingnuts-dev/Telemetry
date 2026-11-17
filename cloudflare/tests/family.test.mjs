import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.mjs';

function setup() {
 const db=new DatabaseSync(':memory:');
 for(const n of ['0002_email_auth.sql','0003_access_exchange.sql','0004_family_sharing.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 function stmt(sql,args=[]) {return {bind(...v){return stmt(sql,v)}, async first(){return db.prepare(sql).get(...args)??null},async all(){return {results:db.prepare(sql).all(...args)}}, async run(){return db.prepare(sql).run(...args)}}}
 const env={DB:{prepare:stmt,async batch(statements){ db.exec('BEGIN');try{for(const p of statements)await p.run();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}}};
 const now=Date.now(),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
 for(const [id,email] of [[A,'a@example.com'],[B,'b@example.com'],[C,'c@example.com']]){
  db.prepare('INSERT INTO email_accounts(id,email,display_name,created_at) VALUES (?,?,?,?)').run(id,email,email,now);
 }
 return {env,db,A,B,C,now};
}
async function sha(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('')}
async function session(f,user){const t=user==='a'?'ab'.repeat(32):user==='b'?'bc'.repeat(32):'cd'.repeat(32);const id=f[user.toUpperCase()];f.db.prepare('INSERT INTO email_sessions(token_hash,account_id,created_at,expires_at) VALUES (?,?,?,?)').run(await sha(t),id,f.now,f.now+86400000);return t}
async function req(env,token,path,method='GET',body) {
 const headers={Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})};
 const request=new Request('https://example.invalid'+path,{method,headers,body:body?JSON.stringify(body):undefined});
 const r=await worker.fetch(request,env);return {status:r.status,data:await r.json()};
}
test('Invitation requires a recipient login, explicit acceptance and independent sharing switch',async()=>{
 const f=setup(),a=await session(f,'a'),b=await session(f,'b'),c=await session(f,'c');
 const invited=await req(f.env,a,'/v1/invites','POST',{email:'b@example.com'});
 assert.equal(invited.status,201);
 const inviteId=invited.data.id;
 assert.equal((await req(f.env,a,'/v1/family/contacts')).data.contacts.length,0);
 assert.equal((await req(f.env,c,'/v1/invites')).data.invitations.length,0);
 assert.equal((await req(f.env,c,'/v1/invites/'+inviteId+'/accept','POST',{})).status,404);
 assert.equal((await req(f.env,b,'/v1/invites')).data.invitations.length,1);
 assert.equal((await req(f.env,b,'/v1/invites/'+inviteId+'/accept','POST',{})).status,200);
 let contacts=(await req(f.env,a,'/v1/family/contacts')).data.contacts;
 assert.equal(contacts.length,1);
 assert.equal(contacts[0].sharing,false);
 assert.equal(contacts[0].latitude,null);
 assert.equal((await req(f.env,b,'/v1/location','POST',{lat:40.7,lng:-74.0})).status,403);
 assert.equal((await req(f.env,a,'/v1/family/contacts/'+f.B+'/history')).status,403);
 assert.equal((await req(f.env,b,'/v1/family/sharing','POST',{enabled:true})).data.sharingEnabled,true);
 assert.equal((await req(f.env,b,'/v1/location','POST',{lat:40.7,lng:-74.0,battery:78})).status,200);
 contacts=(await req(f.env,a,'/v1/family/contacts')).data.contacts;
 assert.equal(contacts[0].latitude,40.7);
 assert.equal(contacts[0].battery,78);
 assert.equal((await req(f.env,a,'/v1/family/contacts/'+f.B+'/history')).data.history.length,1);
 assert.equal((await req(f.env,c,'/v1/family/contacts/'+f.B+'/history')).status,403);
 await req(f.env,b,'/v1/family/sharing','POST',{enabled:false});
 assert.equal((await req(f.env,a,'/v1/family/contacts')).data.contacts[0].latitude,null);
 assert.equal((await req(f.env,a,'/v1/family/contacts/'+f.B+'/history')).status,403);
 assert.equal((await req(f.env,b,'/v1/location','POST',{lat:40.8,lng:-74.1})).status,403);
 const viewers=(await req(f.env,b,'/v1/family/viewers')).data.viewers;
 assert.equal(viewers.length,1);
 assert.equal((await req(f.env,b,'/v1/family/viewers/'+f.A,'DELETE')).status,200);
 await req(f.env,b,'/v1/family/sharing','POST',{enabled:true});
 assert.equal((await req(f.env,a,'/v1/family/contacts')).data.contacts.length,0);
});
test('Rejects location pollution, self invitation and unaccepted access',async()=>{
 const f=setup(),a=await session(f,'a');
 assert.equal((await req(f.env,a,'/v1/invites','POST',{email:'a@example.com'})).status,400);
 assert.equal((await req(f.env,a,'/v1/location','POST',{lat:500,lng:-74})).status,403);
 assert.equal((await req(f.env,a,'/v1/family/sharing','POST',{enabled:'yes'})).status,400);
});
