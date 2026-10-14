-- F2 executable assertion harness. Loaded before every F2 suite by run_f2_sql.sh.
-- A check passes only when the observed outcome equals the expectation EXACTLY:
--   * error checks compare the SQLSTATE, byte for byte;
--   * success checks compare the exact row count;
--   * post-state checks compare a boolean or an integer computed from the database.
-- Results are kept in a temporary table. finish() raises an exception, so psql exits nonzero, when any check failed or
-- when the number of checks run differs from the number the suite declares. A skipped check therefore fails the run.
-- Statements are run under SET LOCAL ROLE with JWT claims (role authenticated, anon or service_role), or as the session
-- owner when the role is NULL. Owner-context checks are used only for fixture setup and post-state reads.
\set ON_ERROR_STOP 1

CREATE TEMP TABLE IF NOT EXISTS f2_results (seq serial, label text NOT NULL, ok boolean NOT NULL, detail text);
CREATE TEMP TABLE IF NOT EXISTS f2_values (name text PRIMARY KEY, value text NOT NULL);
-- Captured values are read inside role-switched statements, so the role needs read access to this temp table.
GRANT SELECT ON f2_values TO PUBLIC;

-- Run one statement and assert its outcome exactly.
CREATE OR REPLACE FUNCTION pg_temp.chk(
  p_label        text,
  p_role         text,
  p_uid          uuid,
  p_sql          text,
  p_expect_state text,   -- SQLSTATE that must be raised, or NULL for success
  p_expect_rows  int     -- exact row count required on success, or NULL for any
)
RETURNS boolean
LANGUAGE plpgsql
AS $f$
DECLARE
  v_rows  int  := -1;
  v_state text := NULL;
  v_msg   text := NULL;
  v_ok    boolean;
  v_detail text;
BEGIN
  BEGIN
    IF p_role IS NOT NULL THEN
      EXECUTE format('SET LOCAL ROLE %I', p_role);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
      PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    END IF;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';

  IF v_state IS NULL THEN
    v_ok := p_expect_state IS NULL AND (p_expect_rows IS NULL OR v_rows = p_expect_rows);
  ELSE
    v_ok := p_expect_state IS NOT NULL AND v_state = p_expect_state;
  END IF;

  v_detail := format('expect state=%s rows=%s | actual state=%s rows=%s msg=%s',
    coalesce(p_expect_state, 'none'), coalesce(p_expect_rows::text, 'any'),
    coalesce(v_state, 'none'), v_rows, left(coalesce(v_msg, ''), 120));
  INSERT INTO f2_results (label, ok, detail) VALUES (p_label, v_ok, v_detail);
  RAISE NOTICE '% | % | %', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, p_label, v_detail;
  RETURN v_ok;
END;
$f$;

-- Run one statement that must succeed and capture its single text value. A failure here stops the run.
CREATE OR REPLACE FUNCTION pg_temp.cap(p_name text, p_role text, p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $f$
DECLARE v text;
BEGIN
  IF p_role IS NOT NULL THEN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  END IF;
  EXECUTE p_sql INTO STRICT v;
  EXECUTE 'RESET ROLE';
  INSERT INTO f2_values (name, value) VALUES (p_name, v)
    ON CONFLICT (name) DO UPDATE SET value = excluded.value;
  RETURN v;
END;
$f$;

-- Owner-context post-state assertion that a boolean expression is TRUE.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_label text, p_expr text)
RETURNS boolean
LANGUAGE plpgsql
AS $f$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT (' || p_expr || ')' INTO STRICT v;
  v := coalesce(v, false);
  INSERT INTO f2_results (label, ok, detail) VALUES (p_label, v, 'post-state expression ' || CASE WHEN v THEN 'is true' ELSE 'is NOT true' END);
  RAISE NOTICE '% | % | post-state', CASE WHEN v THEN 'PASS' ELSE 'FAIL' END, p_label;
  RETURN v;
END;
$f$;

-- Owner-context post-state assertion of an exact integer.
CREATE OR REPLACE FUNCTION pg_temp.assert_int(p_label text, p_expr text, p_expected int)
RETURNS boolean
LANGUAGE plpgsql
AS $f$
DECLARE v bigint; ok boolean;
BEGIN
  EXECUTE 'SELECT (' || p_expr || ')::bigint' INTO STRICT v;
  ok := v = p_expected;
  INSERT INTO f2_results (label, ok, detail) VALUES (p_label, ok, format('expected %s, observed %s', p_expected, v));
  RAISE NOTICE '% | % | expected %, observed %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, p_label, p_expected, v;
  RETURN ok;
END;
$f$;

-- The exact error text a statement raises, or the literal 'NO ERROR'. Used to prove two refusals are identical, not
-- merely equal in SQLSTATE. Runs under the given role, with the same claims as chk.
CREATE OR REPLACE FUNCTION pg_temp.errmsg(p_role text, p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $f$
DECLARE v_msg text := 'NO ERROR';
BEGIN
  BEGIN
    IF p_role IS NOT NULL THEN
      EXECUTE format('SET LOCAL ROLE %I', p_role);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
      PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    END IF;
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v_msg;
END;
$f$;

-- Fixed synthetic identifiers: pg_temp.u('a4') is the member MEM, and so on. Defined in the fixture, not in the environment.
CREATE OR REPLACE FUNCTION pg_temp.u(p text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $f$ SELECT ('00000000-0000-4000-8000-0000000000' || p)::uuid $f$;

-- Owner-context post-state assertion that two integer expressions are equal (used for "unchanged" checks).
CREATE OR REPLACE FUNCTION pg_temp.assert_same(p_label text, p_expr_a text, p_expr_b text)
RETURNS boolean
LANGUAGE plpgsql
AS $f$
DECLARE a bigint; b bigint; ok boolean;
BEGIN
  EXECUTE 'SELECT (' || p_expr_a || ')::bigint' INTO STRICT a;
  EXECUTE 'SELECT (' || p_expr_b || ')::bigint' INTO STRICT b;
  ok := a = b;
  INSERT INTO f2_results (label, ok, detail) VALUES (p_label, ok, format('left %s, right %s', a, b));
  RAISE NOTICE '% | % | left %, right %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, p_label, a, b;
  RETURN ok;
END;
$f$;

-- Fixture-existence assertion. Used before any suite check so that a missing fixture fails loudly.
CREATE OR REPLACE FUNCTION pg_temp.fixture(p_label text, p_expr text)
RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE v boolean;
BEGIN
  EXECUTE 'SELECT (' || p_expr || ')' INTO STRICT v;
  IF NOT coalesce(v, false) THEN
    RAISE EXCEPTION 'FIXTURE MISSING: %', p_label USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO f2_results (label, ok, detail) VALUES ('fixture: ' || p_label, true, 'present');
END;
$f$;

-- Final verdict. The declared total must equal the number of checks recorded, and no check may have failed.
CREATE OR REPLACE FUNCTION pg_temp.finish(p_declared_total int)
RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE v_total int; v_failed int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO v_total, v_failed FROM f2_results WHERE label NOT LIKE 'fixture: %';
  RAISE NOTICE '== F2 SQL VERDICT: % checks recorded (declared %), % failed', v_total, p_declared_total, v_failed;
  IF v_total <> p_declared_total THEN
    RAISE EXCEPTION 'F2 SQL SUITE INCOMPLETE: % checks ran, % declared', v_total, p_declared_total USING ERRCODE = 'P0001';
  END IF;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'F2 SQL SUITE FAILED: % of % checks', v_failed, v_total USING ERRCODE = 'P0001';
  END IF;
END;
$f$;
