Probe construction (PostgreSQL 18 private cluster, database cert_full1 = certified 000-101 migration tree of 60825c0).
Each probe file is appended to: bsc_test_source.sql lines 1-143 (fixtures, rls_test helpers), probe_head.sql, probe_fix.sql,
probe_body.sql (audience fixtures and the six refusal writes), then one probe_partN.sql. Wrapped in begin; ... rollback;
Run:  psql -d cert_full1 -f <wrapper>.sql   (ON_ERROR_STOP=0; every scenario also runs inside savepoints or is rolled back)
