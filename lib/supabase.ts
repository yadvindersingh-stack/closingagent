// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// These MUST point to your own Supabase project (set in .env)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env'
  );
}

// This client is used in React components (browser + server components)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Simple placeholder types so other files compile.
// You can tighten these later if you want.
export type TransactionStatus = string;
export type DocumentStatus = string;
export type DocumentType = string;
