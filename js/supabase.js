import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('PASTE');

// The anon key is public by design; Row Level Security is what protects the data.
export const db = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Await a supabase query and throw a readable Error on failure.
export async function must(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
