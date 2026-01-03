// lib/supabase_admin.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function createAdminClient(): SupabaseClient | null {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Export a Proxy that lazily creates the real client when first used.
// This prevents throwing during module import (which breaks Next.js build-time page collection)
// while still providing clear runtime errors if envs are missing when actually used.
const proxyHandler: ProxyHandler<any> = {
  get(_target, prop) {
    const client = createAdminClient();
    if (!client) {
      throw new Error(
        'Supabase admin client used but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.'
      );
    }
    // Delegate property access to the real client
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const value = (client as any)[prop];
    if (typeof value === 'function') return value.bind(client);
    return value;
  },
  set(_target, prop, value) {
    const client = createAdminClient();
    if (!client) {
      throw new Error(
        'Supabase admin client used but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.'
      );
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    (client as any)[prop] = value;
    return true;
  },
};

export const supabaseAdmin = new Proxy({}, proxyHandler) as unknown as SupabaseClient;
