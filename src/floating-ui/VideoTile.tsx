import { useEffect, useRef } from 'react';
import { CameraOff, MicOff } from 'lucide-react';

interface Props {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;       // local preview must be muted to avoid echo
  mirror?: boolean;
  hasVideo: boolean;
  micOn: boolean;
  className?: string;
  tint?: 'gum' | 'sky';
  compact?: boolean;
}

export function VideoTile({ stream, label, muted, mirror, hasVideo, micOn, className = '', tint = 'gum', compact }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    const kick = () => { void el.play().catch(() => undefined); }; // may need a gesture for remote audio
    kick();
    // Remote tracks arrive (addtrack) and start delivering frames (unmute) *after* the stream is
    // handed to the element, so nudge playback again at each of those moments.
    const tracks = new Set<MediaStreamTrack>();
    const watch = (t: MediaStreamTrack) => {
      if (tracks.has(t)) return;
      tracks.add(t);
      t.addEventListener('unmute', kick);
    };
    stream.getTracks().forEach(watch);
    const onAdd = (e: MediaStreamTrackEvent) => { watch(e.track); kick(); };
    stream.addEventListener('addtrack', onAdd);
    el.addEventListener('loadedmetadata', kick);
    return () => {
      stream.removeEventListener('addtrack', onAdd);
      el.removeEventListener('loadedmetadata', kick);
      tracks.forEach((t) => t.removeEventListener('unmute', kick));
    };
  }, [stream]);

  const grad = tint === 'gum' ? 'bg-gum' : 'bg-sky';
  return (
    // Gradient "frame" made from padding, with the video clipped inside.
    // No `relative` here: callers position the tile (e.g. `absolute` for the picture-in-picture), and the inner box anchors the label.
    <div className={`rounded-[18px] ${grad} p-[2px]  ${className}`}>
      <div className="relative h-full w-full overflow-hidden rounded-[16px] bg-grape-900">
        <video
          ref={ref}
          muted={muted}
          playsInline
          autoPlay
          className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''} ${hasVideo ? '' : 'invisible'}`}
        />
        {!hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 from-grape-800 to-grape-900">
            <div className={`flex items-center justify-center rounded-full ${grad} font-display font-black text-grape-950 ${compact ? 'h-7 w-7 text-[13px]' : 'h-12 w-12 text-[20px]'}`}>
              {label.slice(0, 1).toUpperCase() || '?'}
            </div>
            {!compact && <CameraOff size={12} className="text-mute" />}
          </div>
        )}
        {!(compact && micOn && label === 'You') && <div className={`absolute flex items-center gap-1 rounded-full bg-[#0e1322] text-white ${compact ? 'bottom-1 left-1 px-1.5 py-px text-[11px]' : 'bottom-2 left-2 px-2.5 py-1 text-[13px]'} font-bold`}>
          {!micOn && <MicOff size={compact ? 8 : 10} className="text-gum" />}
          <span className={`${compact ? 'max-w-[70px]' : 'max-w-[140px]'} truncate`}>{label}</span>
        </div>}
      </div>
    </div>
  );
}
