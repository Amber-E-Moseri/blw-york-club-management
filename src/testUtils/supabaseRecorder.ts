// A recording stand-in for the Supabase client, for query-layer tests. Every from(...) chain and rpc(...) call is logged
// with its arguments, and each table or RPC can be given a queued response. Unqueued calls resolve to { data: null }.
// Imported by tests through jest.mock('../lib/supabase', () => require('../testUtils/supabaseRecorder')).

export interface RecorderResponse {
  data: unknown;
  error: { message: string } | null;
}

export interface RecordedCall {
  target: string;
  op: string;
  args: unknown[];
}

const log: RecordedCall[] = [];
const queued: Record<string, RecorderResponse[]> = {};

function take(key: string): RecorderResponse {
  const list = queued[key];
  const next = list ? list.shift() : undefined;
  return next ?? { data: null, error: null };
}

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const ops = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'match', 'order', 'gte'];
  for (const op of ops) {
    chain[op] = (...args: unknown[]) => {
      log.push({ target: table, op, args });
      return chain;
    };
  }
  chain.single = () => Promise.resolve(take(table));
  chain.maybeSingle = () => Promise.resolve(take(table));
  chain.then = (resolve: (r: RecorderResponse) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(take(table)).then(resolve, reject);
  return chain;
}

export const supabase = {
  from: (table: string) => builder(table),
  rpc: (name: string, params: unknown) => {
    log.push({ target: `rpc:${name}`, op: 'rpc', args: [params] });
    return Promise.resolve(take(`rpc:${name}`));
  },
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
  },
};

export const __fake = {
  log,
  queue(key: string, response: RecorderResponse) {
    const list = queued[key] ? queued[key] : (queued[key] = []);
    list.push(response);
  },
  reset() {
    log.length = 0;
    for (const key of Object.keys(queued)) delete queued[key];
  },
};
