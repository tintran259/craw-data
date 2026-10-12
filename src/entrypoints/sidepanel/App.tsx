import { useEffect } from 'react';
import { onBroadcast } from '@/core/messaging';
import { DebugPanel } from './components/DebugPanel';
import { LinkInput } from './components/LinkInput';
import { Messages } from './components/Messages';
import { QueuePanel } from './components/QueuePanel';
import { SettingsPanel } from './components/SettingsPanel';
import { usePanelStore } from './store';

export default function App() {
  const init = usePanelStore((s) => s.init);
  const setSettings = usePanelStore((s) => s.setSettings);
  const setDebugStatus = usePanelStore((s) => s.setDebugStatus);
  const setQueue = usePanelStore((s) => s.setQueue);
  const debugMode = usePanelStore((s) => s.settings?.debugMode ?? false);
  const queueStatus = usePanelStore((s) => s.queue.status);

  useEffect(() => {
    void init();
    const offs = [
      onBroadcast('settings/changed', setSettings),
      onBroadcast('debug/status', setDebugStatus),
      onBroadcast('queue/state', setQueue),
    ];
    return () => offs.forEach((off) => off());
  }, [init, setSettings, setDebugStatus, setQueue]);

  const queueActive = ['running', 'paused', 'blocked'].includes(queueStatus);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4 text-sm">
      <header>
        <h1 className="text-lg font-semibold">Social Comment Exporter</h1>
        <p className="text-slate-500">
          Thu thập bình luận bằng phiên đăng nhập sẵn có. Dữ liệu chỉ lưu trên máy này.
        </p>
      </header>

      <Messages />
      <LinkInput disabled={queueActive} />
      <QueuePanel />
      <SettingsPanel />
      {debugMode && <DebugPanel />}
    </main>
  );
}
