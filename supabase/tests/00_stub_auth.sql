create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','owner@x.com'),
 ('00000000-0000-0000-0000-00000000000b','emp@x.com'),
 ('00000000-0000-0000-0000-00000000000c','other@y.com'),
 ('00000000-0000-0000-0000-00000000000d','mgr@x.com');
