import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { normalizeEmail, validCode } from '../src/index.mjs';

function makeEnv() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0002_email_auth.sql', import.meta.url), 'utf8'));
  const makeStatement = (statement, values=[]) => ({
    bind(...args) { return makeStatement(statement,args); },
    async first() { return sql.prepare(statement).get(...values) ?? null; },
    async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { return sql.prepare(statement).run(...values); },
  });
  const DB = {
    prepare(statement) { return makeStatement(statement); },
    async batch(items) {
      sql.exec('BEGIN');
      try {
        const result=[];
        for(const item of items) result.push(await item.run());
        sql.exec('COMMIT');
        return result;
      } catch(e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const messages=[];
  const env = {
    DB, AUTH_PEPPER: '9a28be9309cd474ebbed908c0e88f4d8cf890d55',
    EMAIL_FROM: 'login@example.com',
    EMAIL: { async send(message) { messages.push(message); return {messageId:'test-id'}; } },
  };
  return { env,messages,sql };
}
async function call(env, path, {method='GET',body,token}={}) {
  const headers={...(body?{'content-type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})};
  const request=new Request('https://telemetry.example.invalid'+path,{
    method,headers,body:body?JSON.stringify(body):undefined,
  });
  const res=await worker.fetch(request,env);
  return {status:res.status,data:await res.json()};
}
test('email normalization and code validation',()=>{
  assert.equal(normalizeEmail('  FAMILY@Example.Com  '),'family@example.com');
  assert.equal(normalizeEmail('invalid'),null);
  assert.equal(normalizeEmail('x..y@example.com'),null);
  assert.equal(validCode('012345'),true);
  assert.equal(validCode('0000000'),false);
});
test('no email sending without configured secret and binding',async()=>{
  const {env}=makeEnv();delete env.EMAIL;
  const r=await call(env,'/v1/auth/email/start',{method:'POST',body:{email:'family@example.com'}});
  assert.equal(r.status,503);
});
test('email sign-in is one-time, session protected, and sharing disabled',async()=>{
  const {env,messages}=makeEnv();
  const health=await call(env,'/health');
  assert.equal(health.data.emailSchemaReady,true);
  const email='a.family@example.com';
  const started=await call(env,'/v1/auth/email/start',{method:'POST',body:{email}});
  assert.equal(started.status,200);
  assert.equal(messages.length,1);
  assert.ok(!JSON.stringify(started.data).includes('sign-in code is'));
  const code=messages[0].text.match(/code is ([0-9]{6})/)[1];
  const challengeId=started.data.challengeId;
  const bad=await call(env,'/v1/auth/email/verify',{method:'POST',body:{email,code:'000000',challengeId}});
  assert.equal(bad.status,401);
  const confirmed=await call(env,'/v1/auth/email/verify',{method:'POST',body:{email,code,challengeId,name:'Family A'}});
  assert.equal(confirmed.status,200);
  assert.equal(confirmed.data.user.email,email);
  assert.equal(confirmed.data.user.familyReady,false);
  assert.equal(confirmed.data.user.sharingEnabled,false);
  const token=confirmed.data.token;
  assert.equal(typeof token,'string');
  const replay=await call(env,'/v1/auth/email/verify',{method:'POST',body:{email,code,challengeId}});
  assert.equal(replay.status,401);
  const unauthorized=await call(env,'/v1/me');
  assert.equal(unauthorized.status,401);
  const me=await call(env,'/v1/me',{token});
  assert.equal(me.status,200);
  assert.equal(me.data.user.email,email);
  const denied=await call(env,'/v1/location',{method:'POST',token,body:{lat:40,lng:-74}});
  assert.equal(denied.status,503);
  const signedOut=await call(env,'/v1/auth/logout',{method:'POST',token});
  assert.equal(signedOut.status,200);
  assert.equal((await call(env,'/v1/me',{token})).status,401);
});

