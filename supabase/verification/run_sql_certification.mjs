import fs from 'fs';
import { openReplay } from './pglite_replay.mjs';
const [dir, sqlFile] = process.argv.slice(2);
const { db } = await openReplay(dir);
const sql = fs.readFileSync(sqlFile, 'utf8');
try {
  const res = await db.exec(sql);
  for (const set of res) for (const r of set.rows) {
    if ('result' in r) console.log(r.result.padEnd(5), (r.area ?? '').padEnd(12), r.check_name ?? '', r.evidence ? `[${r.evidence}]` : '');
    else if ('failures' in r) console.log('SUMMARY failures=', r.failures, 'checks=', r.checks);
  }
} catch (e) { console.error('SQL ERROR', e.message, e.where ?? ''); process.exit(1); }
