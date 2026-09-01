import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { ImageClip } from '@shared/types'
import {
  blackFadeAt,
  clipAtTime,
  computeLayout,
  overlayOpacityAt,
  transitionAtTime,
  type Layout
} from '@engine/computeLayout'
import {
  CUE_DRIFT,
  PLAY_DRIFT,
  PREROLL,
  advanceTimelineTime,
  keepClipIndices,
  sourceTimeFor,
  type MediaSample
} from '@engine/playback'
import { clock, formatTime } from '@engine/clock'
import { cssFilterFor, deckMediaUrl, mediaUrl } from '@engine/media'
import { captureRegistry } from '@engine/capture'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'
import { SourcePreview } from '@components/SourcePreview'

const MUSIC_DRIFT = 0.08
const PREVIEW_RATES = [1, 1.5, 2, 2.5, 3] as const

function formatPlaybackRate(rate: number): string {
  return `${String(rate).replace('.', ',')}×`
}

interface DeckSlot {
  clipIndex: number | null
  clipId: string | null
  src: string | null
  gain: GainNode | null
}

export function Preview() {
  const project = useProject((s) => s.project)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const previewMedia = useUi((s) => s.previewMedia)

  const layout = useMemo(() => computeLayout(project), [project])
  const layoutRef = useRef<Layout>(layout)
  layoutRef.current = layout

  const projectRef = useRef(project)
  projectRef.current = project

  const stageRef = useRef<HTMLDivElement>(null)
  const compositeRef = useRef<HTMLDivElement>(null)
  const blackoutRef = useRef<HTMLDivElement>(null)
  const deckRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const musicRef = useRef<HTMLAudioElement>(null)
  const overlayRefs = useRef(new Map<string, HTMLImageElement>())

  const decks = useRef<DeckSlot[]>([
    { clipIndex: null, clipId: null, src: null, gain: null },
    { clipIndex: null, clipId: null, src: null, gain: null }
  ])
  const audioCtx = useRef<AudioContext | null>(null)

  const [stage, setStage] = useState({ width: 640, height: 360 })
  const [timecode, setTimecode] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const playbackRateRef = useRef(1)

  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])
  const allOverlays = useMemo(
    () => project.overlayTracks.flatMap((track, ti) => track.map((clip) => ({ clip, trackIndex: ti }))),
    [project.overlayTracks]
  )
  const allOverlaysRef = useRef(allOverlays)
  allOverlaysRef.current = allOverlays

  // Só para recalcular a caixa de seleção quando a imagem termina de carregar
  // (antes disso não dá para saber o tamanho natural).
  const [imgVersion, setImgVersion] = useState(0)

  /* ------------------------------------------------------------------ */
  /* Tamanho do palco (mantém 16:9 dentro do espaço disponível)          */
  /* ------------------------------------------------------------------ */

  useLayoutEffect(() => {
    const parent = stageRef.current?.parentElement
    if (!parent) return
    const measure = () => {
      const rect = parent.getBoundingClientRect()
      const availableW = rect.width - 32
      const availableH = rect.height - 56
      const ratio = project.width / project.height
      let width = availableW
      let height = width / ratio
      if (height > availableH) {
        height = availableH
        width = height * ratio
      }
      setStage({ width: Math.max(160, Math.floor(width)), height: Math.max(90, Math.floor(height)) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [project.width, project.height])

  /* ------------------------------------------------------------------ */
  /* Timecode e estado de play (baixa frequência, esses podem ir no React)*/
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let last = 0
    return clock.subscribe((time, isPlaying) => {
      setPlaying(isPlaying)
      const now = performance.now()
      if (now - last > 90 || !isPlaying) {
        last = now
        setTimecode(time)
      }
    })
  }, [])

  useEffect(() => {
    clock.setDuration(layout.duration)
  }, [layout.duration])

  /* ------------------------------------------------------------------ */
  /* Decks                                                               */
  /* ------------------------------------------------------------------ */

  const gainFor = useCallback((deckIndex: number): GainNode | null => {
    const el = deckRefs[deckIndex].current
    if (!el) return null
    const slot = decks.current[deckIndex]
    if (slot.gain) return slot.gain
    try {
      audioCtx.current ??= new AudioContext()
      const source = audioCtx.current.createMediaElementSource(el)
      const gain = audioCtx.current.createGain()
      source.connect(gain).connect(audioCtx.current.destination)
      slot.gain = gain
      return gain
    } catch {
      // Sem WebAudio o volume fica limitado a 100% — degradação aceitável.
      return null
    }
  }, [])

  const applyVolume = useCallback(
    (deckIndex: number, volume: number, muted: boolean) => {
      const el = deckRefs[deckIndex].current
      if (!el) return
      const value = muted ? 0 : volume
      const gain = value > 1 ? gainFor(deckIndex) : decks.current[deckIndex].gain
      if (gain) {
        // O elemento fica em 1 e o ganho faz o trabalho — assim dá para passar de 100%.
        el.volume = 1
        el.muted = false
        gain.gain.value = value
      } else {
        el.volume = Math.max(0, Math.min(1, value))
        el.muted = muted || value === 0
      }
    },
    [gainFor]
  )

  const assignDeck = useCallback(
    (deckIndex: number, clipIndex: number) => {
      const el = deckRefs[deckIndex].current
      if (!el) return
      const proj = projectRef.current
      const clip = proj.videoTrack[clipIndex]
      const media = clip ? mediaById.get(clip.mediaId) : undefined
      if (!clip || !media) return
      const src = deckMediaUrl(media.path, deckIndex)
      const slot = decks.current[deckIndex]
      const srcChanged = slot.src !== src
      slot.clipIndex = clipIndex
      slot.clipId = clip.id
      el.playbackRate = playbackRateRef.current
      if (srcChanged) {
        slot.src = src
        el.loop = false
        el.src = src
      }
      applyVolume(deckIndex, clip.volume, clip.muted)
      const cl = layoutRef.current.clips[clipIndex]
      if (cl) {
        const target = sourceTimeFor(cl, clock.time)
        const cue = () => {
          if (Number.isFinite(target) && el.readyState >= 1) el.currentTime = target
        }
        if (srcChanged) el.addEventListener('loadeddata', cue, { once: true })
        else cue()
      }
    },
    [mediaById, applyVolume]
  )

  const deckOf = useCallback((clipIndex: number): number => {
    if (decks.current[0].clipIndex === clipIndex) return 0
    if (decks.current[1].clipIndex === clipIndex) return 1
    return -1
  }, [])

  /* ------------------------------------------------------------------ */
  /* Loop principal                                                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let raf = 0

    const sampleOf = (clipIndex: number): MediaSample | null => {
      const d = deckOf(clipIndex)
      const el = d >= 0 ? deckRefs[d].current : null
      if (!el) return null
      return {
        currentTime: el.currentTime,
        paused: el.paused,
        ended: el.ended,
        ready: el.readyState >= 2
      }
    }

    const syncDecks = (t: number, isPlaying: boolean) => {
      const l = layoutRef.current
      const proj = projectRef.current
      const keep = new Set(keepClipIndices(l, t, PREROLL))

      for (let d = 0; d < 2; d++) {
        const slot = decks.current[d]
        if (slot.clipIndex === null) continue
        const cl = l.clips[slot.clipIndex]
        const stale = !cl || cl.clipId !== slot.clipId || !keep.has(slot.clipIndex)
        if (stale) {
          deckRefs[d].current?.pause()
          slot.clipIndex = null
          slot.clipId = null
        }
      }
      for (const index of keep) {
        if (deckOf(index) >= 0) continue
        const free = decks.current.findIndex((s) => s.clipIndex === null)
        if (free >= 0) assignDeck(free, index)
      }

      for (let d = 0; d < 2; d++) {
        const slot = decks.current[d]
        const el = deckRefs[d].current
        if (!el || slot.clipIndex === null) continue
        const cl = l.clips[slot.clipIndex]
        const clip = proj.videoTrack[slot.clipIndex]
        if (!cl || !clip) continue

        el.playbackRate = playbackRateRef.current
        applyVolume(d, clip.volume, clip.muted)

        const target = sourceTimeFor(cl, t)
        const inRange = t >= cl.timelineStart && t < cl.timelineEnd
        const drift = isPlaying && inRange && !el.paused ? PLAY_DRIFT : CUE_DRIFT
        if (isPlaying && inRange) {
          if (el.paused) {
            if (el.readyState >= 1 && Number.isFinite(target) && Math.abs(el.currentTime - target) > CUE_DRIFT) {
              el.currentTime = target
            }
            void el.play().catch(() => undefined)
          } else if (el.readyState >= 1 && Math.abs(el.currentTime - target) > drift) {
            el.currentTime = target
          }
        } else {
          if (!el.paused) el.pause()
          if (el.readyState >= 1 && Number.isFinite(target) && Math.abs(el.currentTime - target) > CUE_DRIFT) {
            el.currentTime = target
          }
        }
      }

      // Música de fundo: um clipe por vez (uso real é uma trilha só).
      const music = musicRef.current
      if (music) {
        music.playbackRate = playbackRateRef.current
        const active = proj.musicTrack.find((c) => {
          const dur = c.outPoint - c.inPoint
          return t >= c.start && t < c.start + dur
        })
        if (active) {
          const media = mediaById.get(active.mediaId)
          const src = media ? mediaUrl(media.path) : null
          if (src && music.dataset.src !== src) {
            music.dataset.src = src
            music.src = src
          }
          const target = active.inPoint + (t - active.start)
          music.volume = Math.max(0, Math.min(1, active.volume))
          if (isPlaying) {
            if (music.paused) {
              music.currentTime = target
              void music.play().catch(() => undefined)
            } else if (Math.abs(music.currentTime - target) > MUSIC_DRIFT) {
              music.currentTime = target
            }
          } else {
            if (!music.paused) music.pause()
            if (music.readyState >= 1 && Math.abs(music.currentTime - target) > 0.05) {
              music.currentTime = target
            }
          }
        } else if (!music.paused) {
          music.pause()
        }
      }
    }

    const renderFrame = (t: number) => {
      const l = layoutRef.current
      const proj = projectRef.current

      const transition = transitionAtTime(l, t)
      const current = clipAtTime(l, t)
      for (let d = 0; d < 2; d++) {
        const el = deckRefs[d].current
        const slot = decks.current[d]
        if (!el) continue
        let opacity = 0
        let z = 1
        if (transition) {
          if (slot.clipIndex === transition.from.index) opacity = 1
          else if (slot.clipIndex === transition.to.index) {
            opacity = transition.progress
            z = 2
          }
        } else if (current && slot.clipIndex === current.index) {
          opacity = 1
        }
        el.style.opacity = String(opacity)
        el.style.zIndex = String(z)
      }

      for (const { clip } of allOverlaysRef.current) {
        const img = overlayRefs.current.get(clip.id)
        if (!img) continue
        const alpha = overlayOpacityAt(clip, t)
        img.style.opacity = String(alpha)
        if (alpha <= 0) continue
        positionOverlay(img, clip, stageRef.current?.clientWidth ?? 0, proj.width, proj.height)
      }

      const blackout = blackoutRef.current
      if (blackout) blackout.style.opacity = String(1 - blackFadeAt(proj, l, t))
    }

    let lastTs = performance.now()

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const l = layoutRef.current
      const dt = Math.min(0.08, Math.max(0, (now - lastTs) / 1000))
      lastTs = now

      if (clock.playing) {
        const result = advanceTimelineTime({
          prevTime: clock.time,
          dt: dt * playbackRateRef.current,
          playing: true,
          duration: l.duration,
          layout: l,
          sample: sampleOf
        })
        clock.setTime(result.time)
        if (result.reachedEnd) clock.setPlaying(false)
      }

      const t = clock.time
      syncDecks(t, clock.playing)
      renderFrame(t)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [assignDeck, deckOf, applyVolume, mediaById])

  /* ------------------------------------------------------------------ */
  /* Captura de frame                                                    */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    captureRegistry.capture = () => {
      const proj = projectRef.current
      const l = layoutRef.current
      const t = clock.time
      const canvas = document.createElement('canvas')
      canvas.width = proj.width
      canvas.height = proj.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.filter = cssFilterFor(proj.adjust)

      const transition = transitionAtTime(l, t)
      const current = clipAtTime(l, t)
      const drawDeck = (clipIndex: number, alpha: number) => {
        const d = deckOf(clipIndex)
        const el = d >= 0 ? deckRefs[d].current : null
        if (!el || !el.videoWidth) return
        ctx.globalAlpha = alpha
        const { x, y, w, h } = containRect(el.videoWidth, el.videoHeight, canvas.width, canvas.height)
        ctx.drawImage(el, x, y, w, h)
      }
      if (transition) {
        drawDeck(transition.from.index, 1)
        drawDeck(transition.to.index, transition.progress)
      } else if (current) {
        drawDeck(current.index, 1)
      }

      for (const { clip } of allOverlaysRef.current) {
        const alpha = overlayOpacityAt(clip, t)
        const img = overlayRefs.current.get(clip.id)
        if (alpha <= 0 || !img || !img.naturalWidth) continue
        ctx.globalAlpha = alpha
        const w = clip.scale * img.naturalWidth
        const h = w * (img.naturalHeight / img.naturalWidth)
        ctx.drawImage(img, clip.x * canvas.width - w / 2, clip.y * canvas.height - h / 2, w, h)
      }

      ctx.filter = 'none'
      const black = 1 - blackFadeAt(proj, l, t)
      if (black > 0) {
        ctx.globalAlpha = black
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.globalAlpha = 1

      try {
        return canvas.toDataURL('image/png')
      } catch {
        return null
      }
    }
    return () => {
      captureRegistry.capture = null
    }
  }, [deckOf])

  /* ------------------------------------------------------------------ */
  /* Manipulação do overlay selecionado                                  */
  /* ------------------------------------------------------------------ */

  const selectedImage = useMemo<ImageClip | null>(() => {
    if (selection.type !== 'image') return null
    for (const track of project.overlayTracks) {
      const found = track.find((c) => c.id === selection.id)
      if (found) return found
    }
    return null
  }, [selection, project.overlayTracks])

  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const dragRef = useRef<null | {
    mode: 'move' | 'resize'
    corner?: 'nw' | 'ne' | 'sw' | 'se'
    startX: number
    startY: number
    origin: ImageClip
    natural: { w: number; h: number }
    fixed?: { x: number; y: number }
  }>(null)

  const scaleToStage = stage.width / project.width

  const updateSelected = useCallback(
    (patch: Partial<ImageClip>) => {
      if (!selectedImage) return
      useProject.getState().update((p) => {
        for (const track of p.overlayTracks) {
          const clip = track.find((c) => c.id === selectedImage.id)
          if (clip) Object.assign(clip, patch)
        }
      })
    },
    [selectedImage]
  )

  const onOverlayPointerDown = (
    event: React.PointerEvent,
    mode: 'move' | 'resize',
    corner?: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    if (!selectedImage) return
    event.preventDefault()
    event.stopPropagation()
    const img = overlayRefs.current.get(selectedImage.id)
    const natural = { w: img?.naturalWidth || 960, h: img?.naturalHeight || 540 }
    const w = selectedImage.scale * natural.w
    const h = w * (natural.h / natural.w)
    const cx = selectedImage.x * project.width
    const cy = selectedImage.y * project.height

    let fixed: { x: number; y: number } | undefined
    if (mode === 'resize' && corner) {
      // Âncora = canto oposto ao arrastado.
      fixed = {
        x: corner.includes('w') ? cx + w / 2 : cx - w / 2,
        y: corner.startsWith('n') ? cy + h / 2 : cy - h / 2
      }
    }

    useProject.getState().commit()
    dragRef.current = {
      mode,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...selectedImage },
      natural,
      fixed
    }
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !selectedImage) return
    const dx = (event.clientX - drag.startX) / scaleToStage
    const dy = (event.clientY - drag.startY) / scaleToStage

    if (drag.mode === 'move') {
      let x = drag.origin.x + dx / project.width
      let y = drag.origin.y + dy / project.height
      const snapV = Math.abs(x - 0.5) < 0.008
      const snapH = Math.abs(y - 0.5) < 0.008
      if (snapV) x = 0.5
      if (snapH) y = 0.5
      setGuides({ v: snapV, h: snapH })
      updateSelected({ x: clamp01x(x), y: clamp01x(y) })
      return
    }

    const fixed = drag.fixed
    if (!fixed || !drag.corner) return
    const stageRect = stageRef.current?.getBoundingClientRect()
    if (!stageRect) return
    const pointerX = (event.clientX - stageRect.left) / scaleToStage
    const pointerY = (event.clientY - stageRect.top) / scaleToStage

    const aspect = drag.natural.h / drag.natural.w
    let width = Math.abs(pointerX - fixed.x)
    // Proporcional: a largura manda, a altura acompanha.
    const minWidth = 24
    width = Math.max(minWidth, width)
    const height = width * aspect
    const signX = drag.corner.includes('w') ? -1 : 1
    const signY = drag.corner.startsWith('n') ? -1 : 1
    const centerX = fixed.x + (signX * width) / 2
    const centerY = fixed.y + (signY * height) / 2

    setGuides({ v: false, h: false })
    updateSelected({
      scale: width / drag.natural.w,
      x: centerX / project.width,
      y: centerY / project.height
    })
  }

  const endDrag = () => {
    dragRef.current = null
    setGuides({ v: false, h: false })
  }

  /* ------------------------------------------------------------------ */
  /* Scroll sobre o preview redimensiona a placa selecionada             */
  /* ------------------------------------------------------------------ */

  const selectedImageRef = useRef<ImageClip | null>(null)
  selectedImageRef.current = selectedImage
  const lastWheelAt = useRef(0)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      const sel = selectedImageRef.current
      if (!sel) return
      event.preventDefault()
      const now = performance.now()
      // Uma rajada contínua de scroll vira UM passo de undo.
      if (now - lastWheelAt.current > 600) useProject.getState().commit()
      lastWheelAt.current = now
      const step = event.shiftKey ? 0.01 : 0.03
      const factor = event.deltaY < 0 ? 1 + step : 1 / (1 + step)
      const scale = Math.max(0.05, Math.min(3, sel.scale * factor))
      useProject.getState().update((p) => {
        for (const track of p.overlayTracks) {
          const clip = track.find((c) => c.id === sel.id)
          if (clip) clip.scale = scale
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ------------------------------------------------------------------ */
  /* Transporte                                                          */
  /* ------------------------------------------------------------------ */

  const togglePlay = () => {
    if (layout.duration <= 0) return
    if (!clock.playing && clock.time >= layout.duration - 0.01) clock.setTime(0)
    void audioCtx.current?.resume()
    clock.setPlaying(!clock.playing)
  }

  const step = (frames: number) => {
    clock.setPlaying(false)
    clock.setTime(clock.time + frames / project.fps)
  }

  const cyclePlaybackRate = () => {
    const currentIndex = PREVIEW_RATES.findIndex((rate) => rate === playbackRateRef.current)
    const nextRate = PREVIEW_RATES[(currentIndex + 1) % PREVIEW_RATES.length] ?? 1
    playbackRateRef.current = nextRate
    setPlaybackRate(nextRate)
    for (const deckRef of deckRefs) {
      if (deckRef.current) deckRef.current.playbackRate = nextRate
    }
    if (musicRef.current) musicRef.current.playbackRate = nextRate
  }

  const selectionBox = useMemo(
    () =>
      selectedImage
        ? overlayBox(
            selectedImage,
            overlayRefs.current.get(selectedImage.id),
            scaleToStage,
            project.width,
            project.height
          )
        : null,
    [selectedImage, scaleToStage, project.width, project.height, imgVersion]
  )

  return (
    <div className="preview-wrap">
      <div
        ref={stageRef}
        className="preview-stage"
        style={{ width: stage.width, height: stage.height }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => {
          if (selection.type === 'image') select({ type: 'none' })
        }}
      >
        <div className="preview-composite" ref={compositeRef} style={{ filter: cssFilterFor(project.adjust) }}>
          {[0, 1].map((i) => (
            <video
              key={i}
              ref={deckRefs[i]}
              preload="auto"
              playsInline
              loop={false}
              crossOrigin="anonymous"
              style={{ opacity: 0 }}
            />
          ))}
          {allOverlays.map(({ clip, trackIndex }) => {
            const media = mediaById.get(clip.mediaId)
            if (!media) return null
            return (
              <img
                key={clip.id}
                className="overlay"
                alt=""
                crossOrigin="anonymous"
                draggable={false}
                src={mediaUrl(media.path)}
                style={{ opacity: 0, zIndex: 10 + trackIndex }}
                onLoad={() => setImgVersion((v) => v + 1)}
                ref={(el) => {
                  if (el) overlayRefs.current.set(clip.id, el)
                  else overlayRefs.current.delete(clip.id)
                }}
              />
            )
          })}
          <div className="preview-blackout" ref={blackoutRef} style={{ zIndex: 40 }} />
        </div>

        {project.videoTrack.length === 0 && (
          <div className="preview-empty">
            <Play size={28} strokeWidth={1.4} />
            <span>Arraste vídeos para a timeline para começar</span>
          </div>
        )}

        {selectionBox && (
          <>
            {guides.v && <div className="preview-guide v" style={{ left: stage.width / 2 }} />}
            {guides.h && <div className="preview-guide h" style={{ top: stage.height / 2 }} />}
            <div
              className={`preview-selection${dragRef.current ? ' dragging' : ''}`}
              style={selectionBox}
              onPointerDown={(e) => onOverlayPointerDown(e, 'move')}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <div
                  key={corner}
                  className={`preview-handle ${corner}`}
                  onPointerDown={(e) => onOverlayPointerDown(e, 'resize', corner)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <audio ref={musicRef} preload="auto" crossOrigin="anonymous" />

      <div className="transport">
        <button className="icon-btn" title="Ir ao início (Home)" onClick={() => { clock.setPlaying(false); clock.setTime(0) }}>
          <ChevronFirst size={17} />
        </button>
        <button className="icon-btn" title="Frame anterior (←)" onClick={() => step(-1)}>
          <SkipBack size={16} />
        </button>
        <button className="icon-btn active" title="Reproduzir / pausar (Espaço)" onClick={togglePlay}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="icon-btn" title="Próximo frame (→)" onClick={() => step(1)}>
          <SkipForward size={16} />
        </button>
        <button className="icon-btn" title="Ir ao fim (End)" onClick={() => { clock.setPlaying(false); clock.setTime(layout.duration) }}>
          <ChevronLast size={17} />
        </button>
        <button
          className={`speed-btn${playbackRate > 1 ? ' active' : ''}`}
          title="Velocidade da prévia — clique para alternar"
          aria-label={`Velocidade da prévia: ${formatPlaybackRate(playbackRate)}. Clique para alternar`}
          onClick={cyclePlaybackRate}
        >
          {formatPlaybackRate(playbackRate)}
        </button>
        <span className="timecode">
          <b>{formatTime(timecode)}</b> / {formatTime(layout.duration)}
        </span>
      </div>

      {/* Prévia de arquivo do bin: cobre a composição (que segue montada por baixo). */}
      {previewMedia && (
        <SourcePreview item={previewMedia} onClose={() => useUi.getState().setPreviewMedia(null)} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------- */
/* Helpers                                                               */
/* -------------------------------------------------------------------- */

const clamp01x = (v: number): number => Math.max(-0.5, Math.min(1.5, v))

function positionOverlay(
  img: HTMLImageElement,
  clip: ImageClip,
  stageWidth: number,
  frameWidth: number,
  frameHeight: number
): void {
  if (!img.naturalWidth || !stageWidth) return
  const k = stageWidth / frameWidth
  const width = clip.scale * img.naturalWidth
  const height = width * (img.naturalHeight / img.naturalWidth)
  const left = (clip.x * frameWidth - width / 2) * k
  const top = (clip.y * frameHeight - height / 2) * k
  img.style.width = `${width * k}px`
  img.style.height = `${height * k}px`
  img.style.transform = `translate(${left}px, ${top}px)`
}

function overlayBox(
  clip: ImageClip,
  img: HTMLImageElement | undefined,
  k: number,
  frameWidth: number,
  frameHeight: number
): React.CSSProperties | null {
  const naturalW = img?.naturalWidth || 960
  const naturalH = img?.naturalHeight || 540
  const width = clip.scale * naturalW
  const height = width * (naturalH / naturalW)
  return {
    left: (clip.x * frameWidth - width / 2) * k,
    top: (clip.y * frameHeight - height / 2) * k,
    width: width * k,
    height: height * k
  }
}

/** Retângulo de `object-fit: contain` — usado na captura de frame. */
function containRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}
