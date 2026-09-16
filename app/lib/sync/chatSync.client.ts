import type { Message } from 'ai';
import { getBoltSyncClient } from './supabaseSync.client';

interface LocalChat {
  id: string;
  messages: Message[];
  urlId?: string;
  description?: string;
  timestamp?: string;
  metadata?: unknown;
  syncId?: string;
  cloudUpdatedAt?: string;
}

interface CloudChat {
  sync_id: string;
  local_id?: string | null;
  url_id?: string | null;
  description?: string | null;
  messages: Message[];
  metadata?: unknown;
  created_at?: string;
  updated_at?: string;
}

function getAllLocalChats(db: IDBDatabase): Promise<LocalChat[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chats', 'readonly');
    const request = tx.objectStore('chats').getAll();

    request.onsuccess = () => resolve(request.result as LocalChat[]);
    request.onerror = () => reject(request.error);
  });
}

function getLocalChat(db: IDBDatabase, id: string): Promise<LocalChat | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chats', 'readonly');
    const request = tx.objectStore('chats').get(id);

    request.onsuccess = () => resolve(request.result as LocalChat | undefined);
    request.onerror = () => reject(request.error);
  });
}

function putLocalChat(db: IDBDatabase, chat: LocalChat): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chats', 'readwrite');
    tx.objectStore('chats').put(chat);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function nextLocalId(db: IDBDatabase): Promise<string> {
  const chats = await getAllLocalChats(db);

  const highest = chats.reduce((max, chat) => {
    const numeric = Number(chat.id);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return String(highest + 1);
}

async function getUser() {
  const supabase = await getBoltSyncClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? { supabase, user } : null;
}

async function uploadChat(
  db: IDBDatabase,
  local: LocalChat,
): Promise<void> {
  const auth = await getUser();

  if (!auth) {
    return;
  }

  const { supabase, user } = auth;

  /*
   * IMPORTANT:
   * Generate the permanent cross-device ID locally BEFORE upload.
   * If an upload fails, the next attempt reuses exactly the same ID.
   */
  if (!local.syncId) {
    local.syncId = crypto.randomUUID();
    await putLocalChat(db, local);
  }

  const { data, error } = await supabase
    .from('bolt_chats')
    .upsert(
      {
        user_id: user.id,
        sync_id: local.syncId,
        local_id: local.id,
        url_id: local.urlId ?? null,
        description: local.description ?? null,
        messages: local.messages,
        metadata: local.metadata ?? null,
      },
      {
        onConflict: 'user_id,sync_id',
      },
    )
    .select('updated_at')
    .single();

  if (error) {
    throw error;
  }

  local.cloudUpdatedAt = data.updated_at;
  await putLocalChat(db, local);
}

export async function syncChatByLocalId(
  db: IDBDatabase,
  localId: string,
): Promise<void> {
  const local = await getLocalChat(db, localId);

  if (!local) {
    return;
  }

  await uploadChat(db, local);
}

export async function deleteCloudChat(
  db: IDBDatabase,
  localId: string,
): Promise<void> {
  const auth = await getUser();

  if (!auth) {
    return;
  }

  const local = await getLocalChat(db, localId);

  if (!local?.syncId) {
    return;
  }

  const { error } = await auth.supabase
    .from('bolt_chats')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('sync_id', local.syncId);

  if (error) {
    throw error;
  }
}

export async function synchronizeChats(db: IDBDatabase): Promise<void> {
  const auth = await getUser();

  if (!auth) {
    return;
  }

  const { supabase, user } = auth;

  /*
   * FIRST pull the cloud state.
   *
   * This is intentionally different from the old implementation:
   * already-synchronised local chats are NOT blindly uploaded on startup.
   */
  const { data, error } = await supabase
    .from('bolt_chats')
    .select(
      'sync_id, local_id, url_id, description, messages, metadata, created_at, updated_at',
    )
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const cloudChats = (data || []) as CloudChat[];
  let localChats = await getAllLocalChats(db);

  /*
   * Pull all known cloud chats first.
   */
  for (const cloud of cloudChats) {
    let local = localChats.find(
      (item) => item.syncId === cloud.sync_id,
    );

    /*
     * urlId fallback is only used to migrate old pre-sync chats.
     */
    if (!local && cloud.url_id) {
      local = localChats.find(
        (item) => !item.syncId && item.urlId === cloud.url_id,
      );
    }

    if (local) {
      const localTime = new Date(local.timestamp || 0).getTime();
      const cloudTime = new Date(cloud.updated_at || 0).getTime();
      const knownCloudTime = new Date(local.cloudUpdatedAt || 0).getTime();

      /*
       * If this device has edited the chat since its last known cloud
       * version, keep the local version and upload it afterwards.
       *
       * Otherwise the cloud version wins.
       */
      const localChanged =
        Boolean(local.cloudUpdatedAt) &&
        localTime > knownCloudTime;

      if (!localChanged || cloudTime >= localTime) {
        const downloaded: LocalChat = {
          ...local,
          syncId: cloud.sync_id,
          cloudUpdatedAt: cloud.updated_at,
          urlId: cloud.url_id ?? local.urlId,
          description: cloud.description ?? undefined,
          messages: cloud.messages || [],
          metadata: cloud.metadata ?? undefined,
          timestamp:
            cloud.updated_at ||
            cloud.created_at ||
            local.timestamp ||
            new Date().toISOString(),
        };

        await putLocalChat(db, downloaded);

        localChats = localChats.map((item) =>
          item.id === downloaded.id ? downloaded : item,
        );
      }
    } else {
      const id = await nextLocalId(db);

      const downloaded: LocalChat = {
        id,
        syncId: cloud.sync_id,
        cloudUpdatedAt: cloud.updated_at,
        urlId: cloud.url_id ?? undefined,
        description: cloud.description ?? undefined,
        messages: cloud.messages || [],
        metadata: cloud.metadata ?? undefined,
        timestamp:
          cloud.updated_at ||
          cloud.created_at ||
          new Date().toISOString(),
      };

      await putLocalChat(db, downloaded);
      localChats = [...localChats, downloaded];
    }
  }

  /*
   * SECOND:
   * Upload only
   *   1. old local chats that have never been synced, or
   *   2. local chats edited after their last known cloud version.
   */
  localChats = await getAllLocalChats(db);

  for (const local of localChats) {
    if (!local.syncId) {
      /*
       * Migration: if the same old Bolt chat already exists in cloud
       * under its urlId, adopt that cloud ID instead of duplicating it.
       */
      const matchingCloud = local.urlId
        ? cloudChats.find((cloud) => cloud.url_id === local.urlId)
        : undefined;

      if (matchingCloud) {
        const migrated: LocalChat = {
          ...local,
          syncId: matchingCloud.sync_id,
          cloudUpdatedAt: matchingCloud.updated_at,
        };

        await putLocalChat(db, migrated);
        continue;
      }

      await uploadChat(db, local);
      continue;
    }

    if (!local.cloudUpdatedAt) {
      await uploadChat(db, local);
      continue;
    }

    const localTime = new Date(local.timestamp || 0).getTime();
    const cloudTime = new Date(local.cloudUpdatedAt).getTime();

    if (localTime > cloudTime) {
      await uploadChat(db, local);
    }
  }

  window.dispatchEvent(
    new CustomEvent('bolt-chat-sync-complete'),
  );
}
