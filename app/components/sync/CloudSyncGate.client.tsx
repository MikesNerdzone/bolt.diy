import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getBoltSyncClient } from '~/lib/sync/supabaseSync.client';
import { synchronizeChats } from '~/lib/sync/chatSync.client';
import { db } from '~/lib/persistence';

export function CloudSyncGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function runSync() {
    if (!db) {
      return;
    }

    setSyncing(true);

    try {
      await synchronizeChats(db);
    } catch (err) {
      console.error('Bolt Cloud Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    getBoltSyncClient()
      .then(async (supabase) => {
        if (!supabase) {
          setError('Cloud-Sync ist nicht konfiguriert.');
          setLoading(false);
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        setSignedIn(Boolean(session));
        setLoading(false);

        if (session) {
          await runSync();
        }

        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setSignedIn(Boolean(nextSession));

          if (nextSession) {
            setTimeout(() => {
              runSync().catch(console.error);
            }, 0);
          }
        });

        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch((err) => {
        console.error(err);
        setError('Cloud-Sync konnte nicht initialisiert werden.');
        setLoading(false);
      });

    return () => unsubscribe?.();
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');

    try {
      const supabase = await getBoltSyncClient();

      if (!supabase) {
        setError('Cloud-Sync ist nicht konfiguriert.');
        return;
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        setError(loginError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    }
  }

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bolt-elements-background-depth-1">
        <div className="text-bolt-elements-textSecondary">Cloud-Sync wird geladen…</div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bolt-elements-background-depth-1 p-4">
        <form
          onSubmit={login}
          className="w-full max-w-sm rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg"
        >
          <h1 className="text-xl font-semibold text-bolt-elements-textPrimary">Bolt Cloud Sync</h1>

          <p className="mt-1 mb-5 text-sm text-bolt-elements-textSecondary">
            Melde dich auf PC und Handy mit demselben Konto an.
          </p>

          <label className="block mb-3">
            <span className="block mb-1 text-sm text-bolt-elements-textSecondary">E-Mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-bolt-elements-textPrimary"
            />
          </label>

          <label className="block mb-4">
            <span className="block mb-1 text-sm text-bolt-elements-textSecondary">Passwort</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-bolt-elements-textPrimary"
            />
          </label>

          {error && <div className="mb-4 text-sm text-red-500">{error}</div>}

          <button
            type="submit"
            className="w-full rounded-lg bg-bolt-elements-button-primary-background px-4 py-2 text-bolt-elements-button-primary-text"
          >
            Anmelden
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {syncing && (
        <div className="fixed right-4 top-4 z-[9999] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-xs text-bolt-elements-textSecondary shadow">
          Chats werden synchronisiert…
        </div>
      )}
      {children}
    </>
  );
}
