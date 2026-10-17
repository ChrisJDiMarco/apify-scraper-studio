// Fetch fixtures for the AI runners: JSON replies, Server-Sent Event streams and binary downloads, all in memory. No test
// touches the network; each fake fetch records the requests it was given.
const encoder = new TextEncoder();

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
// events: strings sent as-is (": comment\n\n") or objects sent as `data: <json>\n\n`; done adds `data: [DONE]`.
function sse(events, { status = 200, done = true, split = 0, headers = {} } = {}) {
  const text = events.map((event) => (typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`)).join('') + (done ? 'data: [DONE]\n\n' : '');
  const chunks = split > 0 ? Array.from({ length: Math.ceil(text.length / split) }, (_, index) => text.slice(index * split, (index + 1) * split)) : [text];
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
}
function bytes(data, { status = 200, headers = {} } = {}) {
  return new Response(data, { status, headers: { 'content-length': String(data.length), ...headers } });
}
// A fetch that answers from a list of handlers in order (or a function of the request). Records every call.
function fakeFetch(handlers) {
  const calls = [];
  const queue = Array.isArray(handlers) ? [...handlers] : null;
  const fetchImpl = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body, json: (() => { try { return typeof options.body === 'string' ? JSON.parse(options.body) : null; } catch { return null; } })() };
    calls.push(call);
    const handler = queue ? queue.shift() : handlers;
    if (!handler) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    const reply = typeof handler === 'function' ? await handler(call, calls) : handler;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetchImpl, calls };
}

module.exports = { json, sse, bytes, fakeFetch };
