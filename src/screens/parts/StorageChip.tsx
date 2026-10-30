import { useEffect, useState } from 'preact/hooks';
import { Cloud, CloudOff, Database, Lock, RefreshCw } from '../../ui/icons';
import { href } from '../../app/router';
import { syncStatus } from '../../app/sync';

/** Honest storage status: data lives on this device (sync arrives later); shows if the browser may evict it. */
export function StorageChip() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  const st = syncStatus.value;
  if (st.state !== 'off') {
    const [Icon, text] = st.state === 'syncing' ? [RefreshCw, 'Syncing…'] : st.state === 'offline' ? [CloudOff, 'Offline · saved here'] : st.state === 'error' ? [CloudOff, 'Sync problem'] : [Cloud, 'Synced'];
    return (
      <a class={st.state === 'error' ? 'badge warn' : 'badge'} href={href('settings')} title={st.state === 'error' ? st.message : `Signed in as ${st.email}`}>
        <Icon size={13} aria-hidden="true" /><span>{text}</span>
      </a>
    );
  }
  const label = persisted ? 'Saved on this device · protected' : 'Saved on this device';
  return (
    <a class="badge" href={href('settings')} title={persisted ? 'The browser has agreed not to evict this data.' : 'Stored locally. Export backups regularly; see Settings → Data.'}>
      {persisted ? <Lock size={13} aria-hidden="true" /> : <Database size={13} aria-hidden="true" />}
      <span>{label}</span>
    </a>
  );
}
