#!/usr/bin/env bash
# Two-session race on a local PostgreSQL 18 instance. Reproduces the last-website-permission trigger logic, with and
# without the role row lock, to show the write-skew under READ COMMITTED and that the lock closes it.
set -u
BIN=/c/Users/moser/scoop/apps/postgresql/current/bin
D=/c/Users/moser/AppData/Local/Temp/claude/7e3e6d7ed9dfed16/7e3d8436-2338-46d4-8572-9224697fc0eb/scratchpad/pgdata
PORT=54399
rm -rf "$D"; "$BIN/initdb" -D "$D" -U postgres -A trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
"$BIN/pg_ctl" -D "$D" -o "-p $PORT -k /tmp" -l "$D.log" -w start >/dev/null || { echo "start failed"; exit 1; }
P="$BIN/psql -X -q -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=0"

run_case() {  # $1 = label, $2 = "lock" or "nolock"
  local label=$1 mode=$2
  $P -d postgres -c "drop database if exists race;" -c "create database race;" >/dev/null
  $P -d race >/dev/null <<SQL
create table roles (id int primary key);
create table perms (role_id int references roles(id), permission_key text, primary key (role_id, permission_key));
insert into roles values (1);
insert into perms values (1,'website.a'), (1,'website.b');

create function guard() returns trigger language plpgsql as \$\$
declare v int;
begin
  if '${mode}' = 'lock' then
    perform 1 from roles r where r.id = old.role_id for update;
  end if;
  select count(*) into v from perms p where p.role_id = old.role_id
    and not (p.role_id = old.role_id and p.permission_key = old.permission_key);
  if v = 0 then raise exception 'A role needs at least one website permission.'; end if;
  return old;
end; \$\$;
create trigger g before delete on perms for each row execute function guard();
SQL
  # Session A removes key a and holds the transaction open. Session B removes key b, starting while A is open.
  ( $P -d race -c "begin; delete from perms where role_id=1 and permission_key='website.a'; select pg_sleep(3); commit;" > "$D.$label.A" 2>&1 ) &
  sleep 1
  ( $P -d race -c "begin; delete from perms where role_id=1 and permission_key='website.b'; commit;" > "$D.$label.B" 2>&1 )
  wait
  local left; left=$($P -d race -tA -c "select count(*) from perms where role_id=1")
  echo "[$label] keys left: $left   (session B said: $(grep -o 'ERROR.*' "$D.$label.B" | head -1 | cut -c1-80) )"
}

run_case nolock nolock
run_case lock lock
"$BIN/pg_ctl" -D "$D" -m fast stop >/dev/null
