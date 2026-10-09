import type { DbClient } from '@dxt/db';

type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

export interface FakeCall {
  table: string;
  op: Op;
  values?: unknown;
  filters: [string, ...unknown[]][];
}

/**
 * A tiny stand-in for the Supabase client in unit tests: every `from(table)` chain resolves to the
 * result registered for `table.op` (default `{ data: [] }`), `rpc(name)` to `rpc.name` (a function
 * result gets the arguments as `values`). Calls are
 * recorded so tests can assert what was written. Integration tests use the real local stack instead.
 */
/** Read-only RPCs: recorded in `readCalls`, not `rpcCalls`. */
const READ_RPCS = new Set(['engine_checks', 'engine_monitor_status', 'engine_verify_jobs']);

export function fakeDb(results: Record<string, Result | ((call: FakeCall) => Result)> = {}) {
  const calls: FakeCall[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const readCalls: { name: string; args: unknown }[] = [];
  const storageCalls: { bucket: string; method: string; args: unknown[] }[] = [];

  const resolve = (key: string, call?: FakeCall): Result => {
    const r = results[key];
    const value = typeof r === 'function' ? r(call as FakeCall) : r;
    return {
      data: value && 'data' in value ? value.data : [],
      error: value?.error ?? null,
      count: value?.count ?? null,
    } as Result;
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
      builder.delete = () => {
        call.op = 'delete';
        return builder;
      };
      for (const op of ['insert', 'update', 'upsert'] as const) {
        builder[op] = (values: unknown) => {
          call.op = op;
          call.values = values;
          return builder;
        };
      }
      for (const method of [
        'select',
        'eq',
        'neq',
        'in',
        'is',
        'not',
        'gte',
        'gt',
        'lte',
        'lt',
        'or',
        'order',
        'range',
        'limit',
        'maybeSingle',
        'overrideTypes',
      ]) {
        builder[method] = (...args: unknown[]) => {
          if (!['select', 'order', 'limit', 'maybeSingle', 'overrideTypes'].includes(method))
            call.filters.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
    /** `storage.from(bucket).<method>(...args)` resolves to `storage.<method>`; calls land in `storageCalls`. */
    storage: {
      from(bucket: string) {
        return new Proxy(
          {},
          {
            get:
              (_t, method: string) =>
              (...args: unknown[]) => {
                storageCalls.push({ bucket, method, args });
                return Promise.resolve(
                  resolve(`storage.${method}`, { table: bucket, op: 'select', values: args, filters: [] }),
                );
              },
          },
        );
      },
    },
    rpc(name: string, args: unknown) {
      // The engine's read RPCs (S04b) change nothing: kept apart so `rpcCalls` lists the writes.
      (READ_RPCS.has(name) ? readCalls : rpcCalls).push({ name, args });
      // Keyset paging: a static `rpc.engine_checks` result is the first page; the next one is empty.
      if (name === 'engine_checks' && (args as { p_after_id?: string } | null)?.p_after_id) {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve(
        resolve(`rpc.${name}`, { table: name, op: 'select', values: args, filters: [] }),
      );
    },
  };

  return { db: db as unknown as DbClient, calls, rpcCalls, readCalls, storageCalls };
}
