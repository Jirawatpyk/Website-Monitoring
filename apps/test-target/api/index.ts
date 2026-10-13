import { readEdgeConfigItem } from '../src/edge-config.js';
import { handle } from '../src/handler.js';

// Every path is rewritten here (vercel.json). The mode lives in the Global Config (formerly Edge
// Config) store connected to this project — env GLOBAL_CONFIG (EDGE_CONFIG on older stores) — item `mode`.
const respond = (request: Request) =>
  handle({
    readMode: () => readEdgeConfigItem(process.env.GLOBAL_CONFIG ?? process.env.EDGE_CONFIG, 'mode'),
    userAgent: request.headers.get('user-agent'),
    country: request.headers.get('x-vercel-ip-country'),
    referer: request.headers.get('referer'),
  });

export const GET = respond;
export const HEAD = respond;
