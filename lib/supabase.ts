// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// These MUST point to your own Supabase project (set in .env)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  // Warn instead of throwing so Next.js build-time imports don't crash.
  // Pages that actually use the client will see a clear runtime error.
  // eslint-disable-next-line no-console
  console.warn('Warning: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Supabase client will be unavailable until configured.');
}

function createClientIfConfigured() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey);
}

const clientHandler: ProxyHandler<any> = {
  get(_t, prop) {
    const client = createClientIfConfigured();
    if (!client) {
      throw new Error('Supabase client used but NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const val = (client as any)[prop];
    if (typeof val === 'function') return val.bind(client);
    return val;
  },
  set(_t, prop, value) {
    const client = createClientIfConfigured();
    if (!client) {
      throw new Error('Supabase client used but NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (client as any)[prop] = value;
    return true;
  },
};

export const supabase = new Proxy({}, clientHandler) as any;

// Simple placeholder types so other files compile.
// You can tighten these later if you want.
export type TransactionStatus = string;
export type DocumentStatus = string;
export type DocumentType = string;
