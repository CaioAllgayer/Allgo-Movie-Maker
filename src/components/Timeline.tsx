import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Magnet, Scissors, Trash2, ZoomIn, ZoomOut, Blend, X } from 'lucide-react'
import type { AudioClip, ImageClip, MediaItem, Project } from '@shared/types'
import { computeLayout, totalDuration, type ClipLayout } from '@engine/computeLayout'
import { clock, formatShort } from '@engine/clock'
import { mediaUrl } from '@engine/media'
import { useThumbnails, useWaveform } from '../hooks/useMediaAssets'
import { MAX_ZOOM, MIN_ZOOM, useUi } from '@store/ui'
import { useProject } from '@store/project'

const LABEL_W = 68
/** Tolerância do snap, em pixels de tela. */
const SNAP_PX = 8
const MIN_CLIP = 0.1
const DRAG_MIME = 'application/x-allgo-media'

export function Timeline() {
  const project = useProject((s) => s.project)
  const zoom = useUi((s) => s.zoom)
  const setZoom = useUi((s) => s.setZoom)
  const snapping = useUi((s) => s.snapping)
  const toggleSnapping = useUi((s) => s.toggleSnapping)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)

  const layout = useMemo(() => computeLayout(project), [project])
  const duration = useMemo(() => totalDuration(project), [project])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapGuide, setSnapGuide] = useState<number | null>(null)

  const contentWidth = Math.max(400, duration * zoom + 320)
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])

  /* ---------------------------- snapping ---------------------------- */

  const snapPoints = useMemo(() => {
    const points = new Set<number>([0])
    for (const c of layout.clips) {
      points.add(c.timelineStart)
      points.add(c.timelineEnd)
    }
    for (const track of project.overlayTracks) {
      for (const c of track) {
        points.add(c.start)
        points.add(c.start + c.duration)
      }
    }
    for (const c of project.musicTrack) {
      points.add(c.start)
      points.add(c.start + (c.outPoint - c.inPoint))
    }
    return [...points].sort((a, b) => a - b)
  }, [layout, project.overlayTracks, project.musicTrack])

  const snap = useCallback(
    (time: number, exclude: number[] = []): number => {
      if (!snapping) return time
      const tolerance = SNAP_PX / zoom
      const candidates = [...snapPoints, clock.time].filter((p) => !exclude.some((e) => Math.abs(e - p) < 1e-6))
      let best: number | null = null
      let bestDist = tolerance
      for (const p of candidates) {
        const dist = Math.abs(p - time)
        if (dist < bestDist) {
          bestDist = dist
          best = p
        }
      }
      setSnapGuide(best)
      return best ?? time
    },
    [snapping, snapPoints, zoom]
  )

  const clearSnap = useCallback(() => setSnapGuide(null), [])

  /* ------------------------------ seek ------------------------------ */

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const el = scrollRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left + el.scrollLeft - LABEL_W
      return Math.max(0, x / zoom)
    },
    [zoom]
  )

  const startSeek = (event: React.PointerEvent) => {
    clock.setPlaying(false)
    clock.setTime(timeFromEvent(event.clientX))
    const move = (e: PointerEvent) => clock.setTime(timeFromEvent(e.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* --------------------------- ctrl + scroll ------------------------ */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const pointerX = event.clientX - rect.left + el.scrollLeft - LABEL_W
      const timeAtPointer = pointerX / zoom
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
      setZoom(next)
      // Mantém o instante sob o cursor parado durante o zoom.
      requestAnimationFrame(() => {
        el.scrollLeft = timeAtPointer * next - (event.clientX - rect.left - LABEL_W)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, setZoom])

  /* ------------------------------ drops ----------------------------- */

  const dropMedia = (event: React.DragEvent, target: 'video' | 'audio' | { overlay: number }) => {
    const mediaId = event.dataTransfer.getData(DRAG_MIME)
    if (!mediaId) return
    event.preventDefault()
    const media = mediaById.get(mediaId)
    if (!media) return
    const time = timeFromEvent(event.clientX)
    const store = useProject.getState()

    if (target === 'video' && media.kind === 'video') {
      const index = layout.clips.findIndex((c) => time < (c.timelineStart + c.timelineEnd) / 2)
      const id = store.appendVideoClip(mediaId, index < 0 ? undefined : index)
      if (id) select({ type: 'video', id })
    } else if (target === 'audio' && media.kind === 'audio') {
      const id = store.addAudioClip(mediaId, snap(time))
      if (id) select({ type: 'audio', id })
    } else if (typeof target === 'object' && media.kind === 'image') {
      const id = store.addImageClip(mediaId, target.overlay, snap(time))
      if (id) select({ type: 'image', id })
    }
    clearSnap()
  }

  const allowDrop = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(DRAG_MIME)) event.preventDefault()
  }

  /* ----------------------------- render ----------------------------- */

  // Uma trilha vazia extra em cima: soltar nela cria a próxima trilha.
  const overlayCount = Math.max(project.overlayTracks.length, 1) + 1
  const overlayIndices = Array.from({ length: overlayCount }, (_, i) => i).reverse()

  const selectedId = selection.type === 'video' || selection.type === 'image' || selection.type === 'audio' ? selection.id : null

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button
          className="icon-btn"
          title="Dividir no playhead (S)"
          onClick={() => useProject.getState().splitAt(clock.time)}
          disabled={!project.videoTrack.length}
        >
          <Scissors size={15} />
        </button>
        <button
          className="icon-btn"
          title="Remover selecionado (Del)"
          disabled={!selectedId}
          onClick={() => {
            if (selectedId) {
              useProject.getState().removeClip(selectedId)
              select({ type: 'none' })
            }
          }}
        >
          <Trash2 size={15} />
        </button>
        <div className="spacer" />
        <div className="zoom">
          <ZoomOut size={14} color="var(--text-dim)" />
          <input
            type="range"
            min={Math.log(MIN_ZOOM)}
            max={Math.log(MAX_ZOOM)}
            step={0.01}
            value={Math.log(zoom)}
            onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
            title="Zoom da timeline (Ctrl+scroll)"
          />
          <ZoomIn size={14} color="var(--text-dim)" />
        </div>
        <button
          className={`icon-btn${snapping ? ' active' : ''}`}
          title="Ímã (snap)"
          onClick={toggleSnapping}
        >
          <Magnet size={15} />
        </button>
      </div>

      <div className="timeline-scroll" ref={scrollRef} onPointerDown={() => select({ type: 'none' })}>
        <div className="timeline-inner" style={{ width: LABEL_W + contentWidth }}>
          <Ruler width={contentWidth} zoom={zoom} onSeek={startSeek} />

          <div className="tracks">
            {overlayIndices.map((index) => (
              <OverlayTrack
                key={index}
                index={index}
                clips={project.overlayTracks[index] ?? []}
                mediaById={mediaById}
                zoom={zoom}
                width={contentWidth}
                selectedId={selectedId}
                snap={snap}
                clearSnap={clearSnap}
                onDrop={(e) => dropMedia(e, { overlay: index })}
                onDragOver={allowDrop}
              />
            ))}

            <VideoTrack
              project={project}
              layout={layout.clips}
              mediaById={mediaById}
              zoom={zoom}
              width={contentWidth}
              selection={selection}
              onDrop={(e) => dropMedia(e, 'video')}
              onDragOver={allowDrop}
            />

            <MusicTrack
              clips={project.musicTrack}
              mediaById={mediaById}
              zoom={zoom}
              width={contentWidth}
              selectedId={selectedId}
              snap={snap}
              clearSnap={clearSnap}
              onDrop={(e) => dropMedia(e, 'audio')}
              onDragOver={allowDrop}
            />
          </div>

          {snapGuide !== null && (
            <div className="snap-guide" style={{ left: LABEL_W + snapGuide * zoom }} />
          )}
          <Playhead zoom={zoom} />
        </div>
      </div>
    </div>
  )
}

/* ==================================================================== */
/* Régua e playhead                                                      */
/* ==================================================================== */

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

function Ruler({
  width,
  zoom,
  onSeek
}: {
  width: number
  zoom: number
  onSeek: (event: React.PointerEvent) => void
}) {
  const step = TICK_STEPS.find((s) => s * zoom >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const count = Math.ceil(width / (step * zoom)) + 1
  return (
    <div className="ruler-row">
      <div className="track-label ruler-spacer" />
      <div className="ruler" style={{ width }} onPointerDown={onSeek}>
        {Array.from({ length: count }, (_, i) => {
          const time = i * step
          return (
            <div key={i} className="ruler-tick" style={{ left: time * zoom }}>
              {formatShort(time)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Playhead({ zoom }: { zoom: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(
    () =>
      clock.subscribe((time) => {
        // Escrita direta no DOM: a 60 fps isso não pode passar pelo React.
        if (ref.current) ref.current.style.transform = `translateX(${LABEL_W + time * zoom}px)`
      }),
    [zoom]
  )
  return <div className="playhead" ref={ref} />
}

/* ==================================================================== */
/* Trilha de vídeo                                                       */
/* ==================================================================== */

function VideoTrack({
  project,
  layout,
  mediaById,
  zoom,
  width,
  selection,
  onDrop,
  onDragOver
}: {
  project: Project
  layout: ClipLayout[]
  mediaById: Map<string, MediaItem>
  zoom: number
  width: number
  selection: ReturnType<typeof useUi.getState>['selection']
  onDrop: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
}) {
  const select = useUi((s) => s.select)
  const [drag, setDrag] = useState<{ index: number; dx: number } | null>(null)

  const startReorder = (event: React.PointerEvent, index: number) => {
    event.stopPropagation()
    const clip = project.videoTrack[index]
    select({ type: 'video', id: clip.id })
    const startX = event.clientX
    let moved = 0
    const move = (e: PointerEvent) => {
      moved = e.clientX - startX
      setDrag({ index, dx: moved })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (Math.abs(moved) < 6) return
      const centers = layout.map((c) => (c.timelineStart + c.timelineEnd) / 2)
      const newCenter = centers[index] + moved / zoom
      let target = 0
      for (let j = 0; j < centers.length; j++) {
        if (j !== index && centers[j] < newCenter) target++
      }
      if (target !== index) useProject.getState().moveVideoClip(index, target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startTrim = (event: React.PointerEvent, index: number, edge: 'left' | 'right') => {
    event.stopPropagation()
    const clip = project.videoTrack[index]
    const media = mediaById.get(clip.mediaId)
    const maxDuration = media?.duration ?? clip.outPoint
    select({ type: 'video', id: clip.id })
    useProject.getState().commit()

    const startX = event.clientX
    const originIn = clip.inPoint
    const originOut = clip.outPoint
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) / zoom
      useProject.getState().update((p) => {
        const target = p.videoTrack[index]
        if (!target) return
        if (edge === 'left') {
          target.inPoint = Math.max(0, Math.min(originIn + delta, originOut - MIN_CLIP))
        } else {
          target.outPoint = Math.min(maxDuration, Math.max(originOut + delta, originIn + MIN_CLIP))
        }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggleTransition = (junction: number, enabled: boolean) => {
    useProject.getState().setTransition(junction, enabled ? null : 1.0)
    if (!enabled) select({ type: 'junction', index: junction })
  }

  return (
    <div className="track video">
      <div className="track-label">Vídeo</div>
      <div className="track-lane" style={{ width }} onDrop={onDrop} onDragOver={onDragOver}>
        {layout.map((l, index) => {
          const clip = project.videoTrack[index]
          const media = mediaById.get(clip.mediaId)
          const left = l.timelineStart * zoom
          const clipWidth = Math.max(6, (l.timelineEnd - l.timelineStart) * zoom)
          const isSelected = selection.type === 'video' && selection.id === clip.id
          const isDragging = drag?.index === index
          return (
            <div
              key={clip.id}
              className={`clip video${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}${media?.missing ? ' missing' : ''}`}
              style={{
                left,
                width: clipWidth,
                transform: isDragging ? `translateX(${drag.dx}px)` : undefined,
                zIndex: isDragging ? 6 : undefined
              }}
              onPointerDown={(e) => startReorder(e, index)}
            >
              {media && !media.missing && (
                <Filmstrip media={media} inPoint={l.inPoint} outPoint={l.outPoint} width={clipWidth} />
              )}
              <div className="clip-title">{media?.name ?? 'mídia ausente'}</div>
              <div className="clip-badges">
                <span className="badge">{formatShort(l.sourceDuration)}</span>
                {clip.muted && <span className="badge">mudo</span>}
              </div>
              <div className="trim-handle left" onPointerDown={(e) => startTrim(e, index, 'left')} />
              <div className="trim-handle right" onPointerDown={(e) => startTrim(e, index, 'right')} />
            </div>
          )
        })}

        {layout.slice(0, -1).map((l, junction) => {
          const next = layout[junction + 1]
          const regionLeft = next.timelineStart * zoom
          const regionWidth = Math.max(2, (l.timelineEnd - next.timelineStart) * zoom)
          const center = regionLeft + regionWidth / 2
          const isSelected = selection.type === 'junction' && selection.index === junction
          return (
            <div key={`j${junction}`}>
              {l.hasCrossfade && (
                <div
                  className={`xfade-region${isSelected ? ' selected' : ''}`}
                  style={{ left: regionLeft, width: regionWidth, pointerEvents: 'auto', cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    select({ type: 'junction', index: junction })
                  }}
                />
              )}
              <button
                className={`junction-btn${l.hasCrossfade ? ' on' : ''}`}
                style={{ left: center, top: '50%' }}
                title={l.hasCrossfade ? 'Remover desvanecimento' : 'Adicionar desvanecimento'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleTransition(junction, l.hasCrossfade)
                }}
              >
                {l.hasCrossfade ? <X size={11} /> : <Blend size={11} />}
              </button>
            </div>
          )
        })}

        {!layout.length && <div className="lane-empty">Arraste vídeos aqui</div>}
      </div>
    </div>
  )
}

function Filmstrip({
  media,
  inPoint,
  outPoint,
  width
}: {
  media: MediaItem
  inPoint: number
  outPoint: number
  width: number
}) {
  const thumbs = useThumbnails(media.path, 16, 64)
  if (!thumbs.length || !media.duration) return null
  const tiles = Math.max(1, Math.round(width / 100))
  const range = Math.max(0.001, outPoint - inPoint)
  return (
    <div className="filmstrip">
      {Array.from({ length: tiles }, (_, i) => {
        const sourceTime = inPoint + ((i + 0.5) / tiles) * range
        const index = Math.max(
          0,
          Math.min(thumbs.length - 1, Math.round((sourceTime / (media.duration || 1)) * thumbs.length - 0.5))
        )
        return <img key={i} src={thumbs[index]} alt="" style={{ width: width / tiles }} draggable={false} />
      })}
    </div>
  )
}

/* ==================================================================== */
/* Trilhas de overlay                                                    */
/* ==================================================================== */

function OverlayTrack({
  index,
  clips,
  mediaById,
  zoom,
  width,
  selectedId,
  snap,
  clearSnap,
  onDrop,
  onDragOver
}: {
  index: number
  clips: ImageClip[]
  mediaById: Map<string, MediaItem>
  zoom: number
  width: number
  selectedId: string | null
  snap: (time: number, exclude?: number[]) => number
  clearSnap: () => void
  onDrop: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
}) {
  const select = useUi((s) => s.select)

  const startDrag = (event: React.PointerEvent, clip: ImageClip, mode: 'move' | 'left' | 'right') => {
    event.stopPropagation()
    select({ type: 'image', id: clip.id })
    // Levar o playhead para dentro da placa deixa a manipulação no preview útil.
    if (clock.time < clip.start || clock.time > clip.start + clip.duration) {
      clock.setTime(clip.start + Math.min(0.2, clip.duration / 2))
    }
    useProject.getState().commit()
    const startX = event.clientX
    const origin = { ...clip }
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) / zoom
      useProject.getState().update((p) => {
        const target = p.overlayTracks[index]?.find((c) => c.id === clip.id)
        if (!target) return
        if (mode === 'move') {
          target.start = Math.max(0, snap(origin.start + delta, [origin.start, origin.start + origin.duration]))
        } else if (mode === 'left') {
          const raw = Math.max(0, Math.min(origin.start + delta, origin.start + origin.duration - MIN_CLIP))
          const snapped = Math.max(0, snap(raw))
          target.start = snapped
          target.duration = origin.start + origin.duration - snapped
        } else {
          const end = Math.max(origin.start + MIN_CLIP, snap(origin.start + origin.duration + delta))
          target.duration = end - origin.start
        }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      clearSnap()
      useProject.getState().update((p) => p.overlayTracks[index]?.sort((a, b) => a.start - b.start))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="track overlay">
      <div className="track-label">Placa {index + 1}</div>
      <div className="track-lane" style={{ width }} onDrop={onDrop} onDragOver={onDragOver}>
        {clips.map((clip) => {
          const media = mediaById.get(clip.mediaId)
          return (
            <div
              key={clip.id}
              className={`clip image${selectedId === clip.id ? ' selected' : ''}${media?.missing ? ' missing' : ''}`}
              style={{ left: clip.start * zoom, width: Math.max(10, clip.duration * zoom) }}
              onPointerDown={(e) => startDrag(e, clip, 'move')}
            >
              {media?.thumbnail && (
                <div className="clip-thumb" style={{ backgroundImage: `url("${mediaUrl(media.thumbnail)}")` }} />
              )}
              <div className="clip-title">{media?.name ?? 'imagem ausente'}</div>
              <div className="trim-handle left" onPointerDown={(e) => startDrag(e, clip, 'left')} />
              <div className="trim-handle right" onPointerDown={(e) => startDrag(e, clip, 'right')} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ==================================================================== */
/* Trilha de música                                                      */
/* ==================================================================== */

function MusicTrack({
  clips,
  mediaById,
  zoom,
  width,
  selectedId,
  snap,
  clearSnap,
  onDrop,
  onDragOver
}: {
  clips: AudioClip[]
  mediaById: Map<string, MediaItem>
  zoom: number
  width: number
  selectedId: string | null
  snap: (time: number, exclude?: number[]) => number
  clearSnap: () => void
  onDrop: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
}) {
  const select = useUi((s) => s.select)

  const startDrag = (event: React.PointerEvent, clip: AudioClip, mode: 'move' | 'left' | 'right') => {
    event.stopPropagation()
    select({ type: 'audio', id: clip.id })
    useProject.getState().commit()
    const media = mediaById.get(clip.mediaId)
    const maxDuration = media?.duration ?? clip.outPoint
    const startX = event.clientX
    const origin = { ...clip }
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) / zoom
      useProject.getState().update((p) => {
        const target = p.musicTrack.find((c) => c.id === clip.id)
        if (!target) return
        if (mode === 'move') {
          target.start = Math.max(0, snap(origin.start + delta))
        } else if (mode === 'left') {
          // Aparar pela esquerda anda com o inPoint e com a posição na timeline.
          const shift = Math.max(-origin.inPoint, Math.min(delta, origin.outPoint - origin.inPoint - MIN_CLIP))
          target.inPoint = origin.inPoint + shift
          target.start = Math.max(0, origin.start + shift)
        } else {
          target.outPoint = Math.min(maxDuration, Math.max(origin.inPoint + MIN_CLIP, origin.outPoint + delta))
        }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      clearSnap()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="track audio">
      <div className="track-label">Música</div>
      <div className="track-lane" style={{ width }} onDrop={onDrop} onDragOver={onDragOver}>
        {clips.map((clip) => {
          const media = mediaById.get(clip.mediaId)
          const clipWidth = Math.max(10, (clip.outPoint - clip.inPoint) * zoom)
          return (
            <AudioClipView
              key={clip.id}
              clip={clip}
              media={media}
              left={clip.start * zoom}
              width={clipWidth}
              selected={selectedId === clip.id}
              onPointerDown={(e, mode) => startDrag(e, clip, mode)}
            />
          )
        })}
      </div>
    </div>
  )
}

function AudioClipView({
  clip,
  media,
  left,
  width,
  selected,
  onPointerDown
}: {
  clip: AudioClip
  media: MediaItem | undefined
  left: number
  width: number
  selected: boolean
  onPointerDown: (event: React.PointerEvent, mode: 'move' | 'left' | 'right') => void
}) {
  const waveform = useWaveform(media?.path, Boolean(media && !media.missing))
  return (
    <div
      className={`clip audio${selected ? ' selected' : ''}${media?.missing ? ' missing' : ''}`}
      style={{ left, width }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
    >
      {waveform && <div className="waveform" style={{ backgroundImage: `url("${waveform}")`, height: '70%' }} />}
      <div className="clip-title">{media?.name ?? 'áudio ausente'}</div>
      <div className="trim-handle left" onPointerDown={(e) => onPointerDown(e, 'left')} />
      <div className="trim-handle right" onPointerDown={(e) => onPointerDown(e, 'right')} />
    </div>
  )
}
