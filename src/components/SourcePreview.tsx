import { useEffect, useRef, useState } from 'react'
import { AudioLines, Pause, Play, X } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { formatTime } from '@engine/clock'
import { mediaUrl } from '@engine/media'

/**
 * Prévia de um arquivo do bin na tela central, por cima da composição do
 * projeto (que fica montada e pausada por baixo — os decks não podem ser
 * desmontados). Player independente: espaço toca/pausa, Esc volta ao projeto.
 */
export function SourcePreview({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(item.duration ?? 0)

  const isImage = item.kind === 'image'

  useEffect(() => {
    setTime(0)
    setDuration(item.duration ?? 0)
  }, [item.id, item.duration])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === ' ' && !isImage) {
        // O handler global do App ignora o espaço no modo prévia — o player é este.
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const toggle = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => undefined)
    else el.pause()
  }

  const seek = (value: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = value
    setTime(value)
  }

  return (
    <div className="source-preview">
      <div className="source-banner">
        <span>
          Prévia: <b>{item.name}</b>
        </span>
        <button className="icon-btn" title="Voltar ao projeto (Esc)" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="source-media" onClick={isImage ? undefined : toggle}>
        {isImage ? (
          <img src={mediaUrl(item.path)} alt={item.name} draggable={false} />
        ) : (
          <video
            key={item.id}
            ref={videoRef}
            src={mediaUrl(item.path)}
            autoPlay
            playsInline
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || item.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}
        {item.kind === 'audio' && (
          <div className="source-audio-badge">
            <AudioLines size={38} strokeWidth={1.4} />
          </div>
        )}
      </div>

      {!isImage && (
        <div className="transport source-transport">
          <button className="icon-btn active" title="Reproduzir / pausar (Espaço)" onClick={toggle}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <input
            type="range"
            className="source-seek"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(time, duration)}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="timecode">
            <b>{formatTime(time)}</b> / {formatTime(duration)}
          </span>
        </div>
      )}
    </div>
  )
}
