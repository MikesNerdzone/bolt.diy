import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

export async function loader({ context }: LoaderFunctionArgs) {
  const contextEnv =
    (context as any)?.cloudflare?.env ??
    (context as any)?.env ??
    {};

  const url =
    contextEnv.VITE_BOLT_SYNC_SUPABASE_URL ||
    process.env.VITE_BOLT_SYNC_SUPABASE_URL ||
    '';

  const anonKey =
    contextEnv.VITE_BOLT_SYNC_SUPABASE_ANON_KEY ||
    process.env.VITE_BOLT_SYNC_SUPABASE_ANON_KEY ||
    '';

  return json(
    {
      url,
      anonKey,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
