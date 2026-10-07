/** Merge usage from one subject key onto another. Deletes the source only when that identity is retired. */
export async function carryKey(db: D1Database, fromKey: string, toKey: string, deleteSource: boolean): Promise<void> {
  if (!fromKey || !toKey || fromKey === toKey) return;
  await db
    .prepare(
      `INSERT INTO usage (day, subject_key, count)
       SELECT day, ?2, count FROM usage WHERE subject_key = ?1
       ON CONFLICT(day, subject_key) DO UPDATE SET count = count + excluded.count`,
    )
    .bind(fromKey, toKey)
    .run();
  if (deleteSource) await db.prepare(`DELETE FROM usage WHERE subject_key = ?1`).bind(fromKey).run();
}

/**
 * Account-link step used by Better Auth's anonymous onLinkAccount hook.
 * Anonymous user-id rows move to the Google user. Device rows are copied so the abuse wall stays.
 */
export async function carrySubject(db: D1Database, fromUserId: string, toUserId: string, deviceId?: string | null): Promise<void> {
  await carryKey(db, `u:${fromUserId}`, `u:${toUserId}`, true);
  if (deviceId) await carryKey(db, `d:${deviceId}`, `u:${toUserId}`, false);
}
