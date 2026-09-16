import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient | null> | undefined;

interface SyncConfig {
  url?: string;
  anonKey?: string;
}

async function loadConfig(): Promise<SyncConfig> {
  const response = await fetch('/api/bolt-sync-config');

  if (!response.ok) {
    throw new Error('Bolt Sync-Konfiguration konnte nicht geladen werden.');
  }

  return response.json();
}

export function getBoltSyncClient(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = loadConfig().then(({ url, anonKey }) => {
      if (!url || !anonKey) {
        console.warn('Bolt Cloud Sync ist nicht konfiguriert.');
        return null;
      }

      return createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'bolt-diy-sync-auth',
        },
      });
    });
  }

  return clientPromise;
}
