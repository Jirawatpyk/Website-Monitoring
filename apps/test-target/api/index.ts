import { readEdgeConfigItem } from '../src/edge-config';
import { handle } from '../src/handler';

// Every path is rewritten here (vercel.json). The mode lives in the Edge Config store connected to
// this project (env EDGE_CONFIG), item `mode`.
const respond = (request: Request) =>
  handle({
    readMode: () => readEdgeConfigItem(process.env.EDGE_CONFIG, 'mode'),
    userAgent: request.headers.get('user-agent'),
  });

export const GET = respond;
export const HEAD = respond;
