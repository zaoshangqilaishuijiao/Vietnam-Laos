#!/usr/bin/env node
// Optional local PostgreSQL/WASM integration; never connects to a remote project.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const modulePath=process.env.TRAVEL_GUIDE_PGLITE_MODULE;
if(!modulePath){console.log('SKIP SQL engine: set TRAVEL_GUIDE_PGLITE_MODULE to a local @electric-sql/pglite package');process.exit(0);}
const {PGlite}=require(modulePath),{pgcrypto}=require(path.join(modulePath,'dist/contrib/pgcrypto.cjs'));
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(`create schema auth; create schema extensions; create role anon; create role authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public, auth to authenticated, anon;
 create publication supabase_realtime;
 insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 const migrations=fs.readdirSync(path.join(__dirname,'../supabase')).filter(f=>f.endsWith('.sql')).sort();
 for(const name of migrations.slice(0,8))await db.exec(fs.readFileSync(path.join(__dirname,'../supabase',name),'utf8'));
 await db.exec(`insert into public.guide_collab_trips(guide_id,edit_code_hash,created_by) values('old-guide',extensions.crypt('12345678',extensions.gen_salt('bf')),'00000000-0000-0000-0000-000000000001');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase',migrations[8]),'utf8'));
 assert.equal((await db.query("select count(*)::int as n from guide_collab_trips where guide_id='old-guide'")).rows[0].n,1);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`);
 for(const code of ['1234567','123456789','abcdefgh',null]) await assert.rejects(db.query('select bootstrap_guide_collab($1,$2,$3)',['test-guide',code,'device_1234567890123456']),/8 digits/);
 await db.query('select bootstrap_guide_collab($1,$2,$3)',['test-guide','12345678','device_1234567890123456']);
 assert.equal((await db.query('select restore_guide_collab($1,$2) as ok',['test-guide','device_1234567890123456'])).rows[0].ok,true);
 await db.query('select save_guide_checklist_state($1,$2,$3,now(),$4)',['test-guide','check1',true,'device_1234567890123456']);
 for(const table of ['guide_execution_state','guide_checklist_state','guide_custom_checklist']) await assert.rejects(db.exec(`delete from ${table} where guide_id='test-guide'`),/permission denied/);
 await db.query('select leave_guide_collab($1,$2)',['test-guide','device_1234567890123456']);
 await assert.rejects(db.query('select save_guide_checklist_state($1,$2,$3,now(),$4)',['test-guide','check1',false,'device_1234567890123456']),/device session invalid/);
 await db.query('select join_guide_collab($1,$2,$3)',['test-guide','12345678','device_1234567890123456']);
 await db.exec("reset role; delete from guide_collab_members where guide_id='test-guide'; set role authenticated;");
 assert.equal((await db.query('select restore_guide_collab($1,$2) as ok',['test-guide','device_1234567890123456'])).rows[0].ok,false);
 await assert.rejects(db.query('select save_guide_checklist_state($1,$2,$3,now(),$4)',['test-guide','check1',false,'device_1234567890123456']),/editor required/);
 await assert.rejects(db.query('select save_guide_custom_checklist($1,$2,$3,false,false,now(),$4)',['test-guide','check2','事项','device_1234567890123456']),/editor required/);
 console.log('PASS PostgreSQL engine: all migrations, existing rows, first owner, code validation, RPC and revocation');
 }finally{await db.close();}
}
main().catch(error=>{console.error(error.message);process.exit(1)});
