import type { DbClient } from '@dxt/db';

type Op = 'select' | 'insert' | 'update' | 'upsert';
type Result = { data?: unknown; error?: { message: string } | null };

export interface FakeCall {
  table: string;
  op: Op;
  values?: unknown;
  filters: [string, ...unknown[]][];
}

/**
 * A tiny stand-in for the Supabase client in unit tests: every `from(table)` chain resolves to the
 * result registered for `table.op` (default `{ data: [] }`), `rpc(name)` to `rpc.name`. Calls are
 * recorded so tests can assert what was written. Integration tests use the real local stack instead.
 */
export function fakeDb(results: Record<string, Result | ((call: FakeCall) => Result)> = {}) {
  const calls: FakeCall[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  const resolve = (key: string, call?: FakeCall): Result => {
    const r = results[key];
    const value = typeof r === 'function' ? r(call as FakeCall) : r;
    return { data: value && 'data' in value ? value.data : [], error: value?.error ?? null };
  };

  const db = {
    from(table: string) {
      const call: FakeCall = { table, op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        then(onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(resolve(`${table}.${call.op}`, call)).then(onFulfilled, onRejected);
        },
      };
      for (const op of ['insert', 'update', 'upsert'] as const) {
        builder[op] = (values: unknown) => {
          call.op = op;
          call.values = values;
          return builder;
        };
      }
      for (const method of ['select', 'eq', 'in', 'not', 'gte', 'overrideTypes']) {
        builder[method] = (...args: unknown[]) => {
          if (method !== 'select' && method !== 'overrideTypes') call.filters.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve(resolve(`rpc.${name}`));
    },
  };

  return { db: db as unknown as DbClient, calls, rpcCalls };
}
