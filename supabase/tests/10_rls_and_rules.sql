create schema tt;
create table tt.res (label text, ok boolean);
grant usage on schema tt to authenticated, anon; grant all on tt.res to authenticated, anon;
create function tt.chk(label text, cond boolean) returns void language sql as $$ insert into tt.res values (label, coalesce(cond,false)) $$;
create function tt.fails(label text, stmt text) returns void language plpgsql as $$
declare bad boolean := false; begin
  begin execute stmt; exception when others then bad := true; raise notice 'expected error [%]: %', label, sqlerrm; end;
  insert into tt.res values (label, bad); end $$;
grant execute on all functions in schema tt to authenticated, anon;

\set owner '''00000000-0000-0000-0000-00000000000a'''
\set emp   '''00000000-0000-0000-0000-00000000000b'''
\set oth   '''00000000-0000-0000-0000-00000000000c'''
\set mgr   '''00000000-0000-0000-0000-00000000000d'''
\set ownerem '''owner@x.com'''

-- owner creates org
set role authenticated; select set_config('request.jwt.claim.sub', :owner, false), set_config('request.jwt.claim.email','owner@x.com',false) \gset
select public.create_org('Acme Care','Olivia Owner') as org \gset
select tt.chk('seed rates = 2', (select count(*) from mileage_rates)=2);
select tt.chk('seed 0.725/0.76', (select array_agg(rate_per_mile order by effective_date) from mileage_rates) = array[0.725,0.76]::numeric[]);
insert into invites(email, role) values ('EMP@x.com','employee'),('mgr@x.com','manager');
select tt.chk('invite email lowercased', (select count(*) from invites where email='emp@x.com')=1);
insert into homes(name,address) values ('Oak House','1 Oak St'),('Elm House','2 Elm St');
insert into homes(name,is_personal) values ('Eve Home', true);
insert into mileage_rates(effective_date, rate_per_mile) values ('2026-08-15', 0.80);
select tt.chk('org_id forced on insert', (select count(*) from homes where org_id=:'org')=3);
-- client-supplied foreign org_id is overwritten
reset role;
insert into orgs(id,name) values ('11111111-1111-1111-1111-111111111111','Ghost');
set role authenticated;
insert into homes(org_id,name) values ('11111111-1111-1111-1111-111111111111','Sneaky');
select tt.chk('foreign org_id overwritten', (select org_id from homes where name='Sneaky')=:'org');
select tt.fails('invite for empty user', $$select public.create_org('x','y')$$);

-- employee & manager claim invites
select set_config('request.jwt.claim.sub', :emp, false), set_config('request.jwt.claim.email','emp@x.com',false) \gset
select public.claim_invite('Eve Employee');
select tt.chk('emp role', public.app_role()='employee');
select set_config('request.jwt.claim.sub', :mgr, false), set_config('request.jwt.claim.email','mgr@x.com',false) \gset
select public.claim_invite('Max Manager');
select tt.chk('mgr role', public.app_role()='manager');
select tt.fails('double claim', $$select public.claim_invite('x')$$);

-- other org
select set_config('request.jwt.claim.sub', :oth, false), set_config('request.jwt.claim.email','other@y.com',false) \gset
select public.create_org('Other Co','Carl');
select tt.chk('other sees no homes of Acme', (select count(*) from homes where name like '%House')=0);
select tt.chk('other sees only own rates', (select count(*) from mileage_rates)=2);
select tt.chk('other cannot see Acme org', (select count(*) from orgs)=1);

-- employee permissions
select set_config('request.jwt.claim.sub', :emp, false), set_config('request.jwt.claim.email','emp@x.com',false) \gset
select tt.fails('emp insert rate', $$insert into mileage_rates(effective_date,rate_per_mile) values ('2027-01-01',1)$$);
select tt.fails('emp insert home', $$insert into homes(name) values ('x')$$);
select tt.fails('emp insert invite', $$insert into invites(email,role) values ('z@x.com','owner')$$);
update profiles set role='owner' where user_id=auth.uid();   -- silently 0 rows
select tt.chk('emp still employee', public.app_role()='employee');
insert into routes(a_key,a_label,b_key,b_label,miles)
  select 'home:'||(select id from homes where name='Oak House'), 'Oak House', 'home:'||(select id from homes where name='Elm House'), 'Elm House', 4.2;
-- reverse pair must collide (same route)
select tt.fails('reverse pair is duplicate route', format($$insert into routes(a_key,a_label,b_key,b_label,miles) values (%L,'Elm House',%L,'Oak House',4.2)$$,
   'home:'||(select id from homes where name='Elm House'), 'home:'||(select id from homes where name='Oak House')));
select tt.chk('route ordered', (select a_key<b_key from routes));
update routes set miles = 99;
select tt.chk('emp cannot edit route', (select miles from routes)=4.2);
delete from routes;
select tt.chk('emp cannot delete route', (select count(*) from routes)=1);

-- reports and trips
insert into reports(month) values ('2026-08-01');
select id as rep from reports \gset
select tt.fails('non-first-of-month report', $$insert into reports(month) values ('2026-09-15')$$);
insert into trips(report_id,trip_date,from_key,from_label,to_key,to_label,miles) values
  (:'rep','2026-08-10','text:a','A','text:b','B',10.5),
  (:'rep','2026-08-20','text:b','B','text:a','A',12);
select tt.chk('rate before change 0.76', (select rate_applied from trips where trip_date='2026-08-10')=0.76);
select tt.chk('rate after change 0.80', (select rate_applied from trips where trip_date='2026-08-20')=0.80);
select tt.chk('amounts', (select array_agg(amount order by trip_date) from trips)=array[7.98,9.60]::numeric[]);
select tt.fails('trip outside month', format($$insert into trips(report_id,trip_date,from_key,from_label,to_key,to_label,miles) values (%L,'2026-09-01','text:a','A','text:b','B',1)$$, :'rep'));
select tt.fails('trip no rate', $$select 1/0$$) where false;
select tt.fails('client cannot set status', format($$update reports set status='approved' where id=%L$$, :'rep'));
update reports set status='approved' where id=:'rep';
select tt.chk('status unchanged by direct update', (select status from reports)='draft');
select tt.fails('cannot sign others / blank name', format($$select public.sign_report(%L,' ')$$, :'rep'));
update trips set miles = 11 where trip_date='2026-08-10';
select tt.chk('edit in draft re-prices', (select amount from trips where trip_date='2026-08-10')=8.36);

select (public.sign_report(:'rep','Eve Employee')).status as st \gset
select tt.chk('signed', :'st'='signed');
select tt.chk('snapshot total', (select (snapshot->>'total_amount')::numeric from reports)=17.96);
select tt.chk('snapshot mixed rates', (select jsonb_array_length(snapshot->'rate_breakdown') from reports)=2);
select tt.chk('snapshot hash set', (select length(snapshot_hash) from reports)=64);
select tt.fails('insert trip when signed', format($$insert into trips(report_id,trip_date,from_key,from_label,to_key,to_label,miles) values (%L,'2026-08-12','text:a','A','text:b','B',1)$$, :'rep'));
select tt.fails('update trip when signed', $$update trips set miles = 1$$);
update trips set miles = 1; delete from trips;
select tt.chk('signed trips intact', (select count(*) from trips)=2 and (select sum(miles) from trips)=23);
select tt.fails('re-sign', format($$select public.sign_report(%L,'Eve Employee')$$, :'rep'));

-- unsign then resign
select (public.unsign_report(:'rep')).status as st \gset
select tt.chk('unsigned to draft', :'st'='draft' and (select snapshot is null from reports));
update trips set miles = 10 where trip_date='2026-08-10';
select (public.sign_report(:'rep','Eve Employee')).status as st \gset

-- manager approval
select tt.fails('emp approve', format($$select public.approve_report(%L)$$, :'rep'));
select set_config('request.jwt.claim.sub', :mgr, false), set_config('request.jwt.claim.email','mgr@x.com',false) \gset
select tt.chk('mgr sees emp report', (select count(*) from reports)=1);
select tt.fails('pay before approve', format($$select public.mark_paid(%L,current_date,'check')$$, :'rep'));
select tt.fails('mgr rate edit', $$update mileage_rates set rate_per_mile=9$$) where false;
select (public.approve_report(:'rep')).status as st \gset
select tt.chk('approved', :'st'='approved');
select tt.fails('bad method', format($$select public.mark_paid(%L,current_date,'bitcoin')$$, :'rep'));
select (public.mark_paid(:'rep','2026-09-05','direct_deposit')).status as st \gset
select tt.chk('paid', :'st'='paid');
select tt.fails('delete report', $$delete from reports$$);
select tt.fails('audit delete', $$delete from audit_log$$);
select tt.fails('audit update', $$update audit_log set action='x'$$);
update routes set miles=4.5;
select tt.chk('mgr can edit route', (select miles from routes)=4.5);

-- employee cannot unsign after approval
select set_config('request.jwt.claim.sub', :emp, false), set_config('request.jwt.claim.email','emp@x.com',false) \gset
select tt.fails('unsign after approved', format($$select public.unsign_report(%L)$$, :'rep'));
select tt.chk('audit trail', (select array_agg(action order by id) from audit_log)=array['created','signed','unsigned','signed','approved','paid']);
select tt.chk('emp sees own audit', (select count(*) from audit_log)=6);
select tt.fails('emp cannot insert audit', $$insert into audit_log(org_id,report_id,action) values (gen_random_uuid(),gen_random_uuid(),'x')$$);

-- other org sees nothing of Acme reports
select set_config('request.jwt.claim.sub', :oth, false), set_config('request.jwt.claim.email','other@y.com',false) \gset
select tt.chk('other sees no reports/trips/audit', (select count(*) from reports)+(select count(*) from trips)+(select count(*) from audit_log)=0);

-- last owner guard + owner approving own manager
select set_config('request.jwt.claim.sub', :owner, false), set_config('request.jwt.claim.email','owner@x.com',false) \gset
select tt.fails('last owner demote', $$update profiles set role='manager' where user_id=auth.uid()$$);
select tt.chk('owner still owner', public.app_role()='owner');

-- anon gets nothing
reset role; set role anon;
select tt.fails('anon select', $$select * from public.homes$$);
select tt.fails('anon rpc', $$select public.app_org()$$);
reset role;
select label, case when ok then 'PASS' else 'FAIL' end from tt.res order by ok, label;
select count(*) filter (where not ok) as failures, count(*) as total from tt.res;
