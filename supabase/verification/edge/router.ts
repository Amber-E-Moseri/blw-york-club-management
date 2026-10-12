// Test router for the Edge Functions, run in the Deno runtime.
//
// Supabase's edge runtime can't be started where its dependencies are unreachable. This router loads each function's
// real index.ts, captures the handler that the function registers with Deno.serve, and then serves all of them on one
// port: GET/POST http://host:PORT/<function-name>. The function code is not changed. The gateway's JWT check is not
// performed here, so the functions still authenticate their own callers.
//
// Run with: deno run -A --node-modules-dir=none --import-map=supabase/verification/edge/import_map.json \
//             supabase/verification/edge/router.ts
// Environment is read by the functions themselves (see supabase/functions/*/index.ts).

const FUNCTIONS = ['send-email', 'unsubscribe', 'process-scheduled-emails', 'notify-event'];
const PORT = Number(Deno.env.get('EDGE_ROUTER_PORT') ?? '54321');

type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();

// Each function calls Deno.serve at module load. Capture the handler instead of letting it listen.
const realServe = Deno.serve;
let captured: Handler | null = null;
(Deno as unknown as { serve: unknown }).serve = (handler: Handler) => {
  captured = handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve() };
};

try {
  for (const name of FUNCTIONS) {
    captured = null;
    await import(new URL(`../../functions/${name}/index.ts`, import.meta.url).href);
    if (!captured) throw new Error(`${name} did not register a handler`);
    handlers.set(name, captured);
  }
} finally {
  (Deno as unknown as { serve: unknown }).serve = realServe;
}

Deno.serve({ port: PORT, hostname: '127.0.0.1', onListen: () => console.log(`edge router on ${PORT}`) }, (req) => {
  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const handler = handlers.get(name);
  if (!handler) return new Response(JSON.stringify({ error: 'Function not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
  return handler(req);
});
