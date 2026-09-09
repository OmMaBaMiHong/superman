import { useState } from 'react';
import { getSubscriptionVideoStreamUrl } from '@/lib/api/apiClient';

/** Same-origin playback keeps platform request headers and Range handling on the host. */
export default function SubscriptionVideoPlayer({ id, title, poster }: { id: string; title: string; poster?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  return <div className="mt-5">
    <video key={attempt} controls playsInline preload="metadata" aria-label={`播放：${title}`}
      src={getSubscriptionVideoStreamUrl(id)} poster={poster}
      className="max-h-[60vh] min-h-40 w-full rounded-2xl bg-black" onError={() => setFailed(true)} />
    {failed && <div role="alert" className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-secondary p-3 text-xs">
      <span>视频加载失败，可重试；若仍失败，请刷新订阅源。</span>
      <button className="min-h-11 shrink-0 rounded-full border border-border px-3 text-primary" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>重试播放</button>
    </div>}
  </div>;
}
