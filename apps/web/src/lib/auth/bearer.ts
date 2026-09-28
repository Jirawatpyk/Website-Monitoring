import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of `Authorization: Bearer <secret>`. */
export function hasBearer(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

/** Placeholder for routes that are wired and authenticated but not built yet. */
export function notImplemented(what: string): Response {
  return Response.json({ error: 'not_implemented', what }, { status: 501 });
}
