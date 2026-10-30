import { useEffect, useState } from 'preact/hooks';
import { Database, Lock } from '../../ui/icons';
import { href } from '../../app/router';

/** Honest storage status: data lives on this device (sync arrives later); shows if the browser may evict it. */
export function StorageChip() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  const label = persisted ? 'Saved on this device · protected' : 'Saved on this device';
  return (
    <a class="badge" href={href('settings')} title={persisted ? 'The browser has agreed not to evict this data.' : 'Stored locally. Export backups regularly; see Settings → Data.'}>
      {persisted ? <Lock size={13} aria-hidden="true" /> : <Database size={13} aria-hidden="true" />}
      <span>{label}</span>
    </a>
  );
}
