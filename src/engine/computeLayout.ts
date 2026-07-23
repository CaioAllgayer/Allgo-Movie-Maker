import type { AudioClip, ImageClip, Project, VideoClip } from '@shared/types'

/**
 * ÚNICA fonte de verdade sobre tempo no app.
 *
 * Crossfades SOBREPÕEM clipes: a duração total não é a soma das durações.
 * Timeline (desenho), preview e export usam exclusivamente o resultado desta
 * função — nunca recalcule posições em outro lugar.
 *
 * Decisão importante: TODA junção tem transição. Um corte seco é modelado como
 * um crossfade de exatamente 1 frame (`1/fps`), que é como o export monta o
 * grafo (`xfade` não aceita duration=0). Assim o tempo da timeline, do preview
 * e do arquivo exportado batem no frame — se o corte seco valesse 0 aqui e
 * 1 frame no export, a duração final derivaria alguns frames.
 */

export const MIN_TRANSITION = 0.2
export const MAX_TRANSITION = 3.0

export interface ClipLayout {
  clipId: string
  index: number
  /** duração da fonte usada (outPoint - inPoint) */
  sourceDuration: number
  inPoint: number
  outPoint: number
  /** tempo na linha do tempo final onde o clipe começa a aparecer */
  timelineStart: number
  /** tempo na linha do tempo final onde o clipe termina */
  timelineEnd: number
  /** transição efetiva (já clampada) com o PRÓXIMO clipe, em segundos */
  transitionAfter: number
  /** true quando o usuário pediu crossfade de verdade (não é corte seco) */
  hasCrossfade: boolean
  /** transição efetiva com o clipe ANTERIOR */
  transitionBefore: number
}

export interface Layout {
  clips: ClipLayout[]
  /** duração total do vídeo final, em segundos */
  duration: number
  fps: number
}

export function clipDuration(clip: VideoClip): number {
  return Math.max(0, clip.outPoint - clip.inPoint)
}

/**
 * Limite superior do crossfade numa junção: não pode consumir mais do que sobra
 * do clipe de saída (descontando a transição que ele já gastou na entrada) nem
 * mais do que o clipe de entrada tem para oferecer.
 */
export function maxTransitionAt(project: Project, junctionIndex: number): number {
  const a = project.videoTrack[junctionIndex]
  const b = project.videoTrack[junctionIndex + 1]
  if (!a || !b) return 0
  const frame = 1 / project.fps
  const prev = junctionIndex > 0 ? effectiveTransition(project, junctionIndex - 1) : 0
  const availA = clipDuration(a) - prev - frame
  const availB = clipDuration(b) - frame
  return Math.max(frame, Math.min(MAX_TRANSITION, availA, availB))
}

function effectiveTransition(project: Project, junctionIndex: number): number {
  const a = project.videoTrack[junctionIndex]
  const b = project.videoTrack[junctionIndex + 1]
  if (!a || !b) return 0
  const frame = 1 / project.fps
  const requested = a.transitionAfter?.duration
  if (requested == null) return frame

  // Recursão controlada: a junção anterior só depende das anteriores a ela.
  const prev = junctionIndex > 0 ? effectiveTransition(project, junctionIndex - 1) : 0
  const availA = clipDuration(a) - prev - frame
  const availB = clipDuration(b) - frame
  const limit = Math.min(MAX_TRANSITION, availA, availB)
  return Math.max(frame, Math.min(requested, limit))
}

export function computeLayout(project: Project): Layout {
  const fps = project.fps > 0 ? project.fps : 30
  const frame = 1 / fps
  const clips: ClipLayout[] = []

  let cursor = 0
  let prevTransition = 0

  for (let i = 0; i < project.videoTrack.length; i++) {
    const clip = project.videoTrack[i]
    const next = project.videoTrack[i + 1]
    const dur = clipDuration(clip)

    let transition = 0
    let hasCrossfade = false
    if (next) {
      const requested = clip.transitionAfter?.duration
      hasCrossfade = requested != null
      const availA = dur - prevTransition - frame
      const availB = clipDuration(next) - frame
      const limit = Math.min(MAX_TRANSITION, availA, availB)
      transition = requested == null ? frame : Math.max(frame, Math.min(requested, limit))
      // Clipes minúsculos podem tornar o limite negativo: nunca deixe a
      // transição comer o clipe inteiro (geraria timelineStart retrocedendo).
      transition = Math.min(transition, Math.max(frame, Math.min(dur, clipDuration(next)) - frame))
      if (!Number.isFinite(transition) || transition <= 0) transition = frame
    }

    clips.push({
      clipId: clip.id,
      index: i,
      sourceDuration: dur,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      timelineStart: cursor,
      timelineEnd: cursor + dur,
      transitionAfter: transition,
      hasCrossfade,
      transitionBefore: prevTransition
    })

    cursor = cursor + dur - transition
    prevTransition = transition
  }

  const duration = clips.length ? clips[clips.length - 1].timelineEnd : 0
  return { clips, duration, fps }
}

/** Duração total considerando também overlays e música que passem do vídeo. */
export function totalDuration(project: Project): number {
  const layout = computeLayout(project)
  let end = layout.duration
  for (const track of project.overlayTracks) {
    for (const clip of track) end = Math.max(end, clip.start + clip.duration)
  }
  for (const clip of project.musicTrack) {
    end = Math.max(end, clip.start + (clip.outPoint - clip.inPoint))
  }
  return end
}

/**
 * Clipe "mestre" num instante: o PRIMEIRO clipe cujo intervalo contém `t`.
 * Durante um crossfade dois clipes contêm `t`; o mestre é o que está saindo,
 * o que mantém o relógio do preview contínuo (ver previewClock.ts).
 */
export function clipAtTime(layout: Layout, t: number): ClipLayout | null {
  for (const c of layout.clips) {
    if (t >= c.timelineStart && t < c.timelineEnd) return c
  }
  const last = layout.clips[layout.clips.length - 1]
  if (last && t >= last.timelineEnd) return last
  return null
}

/** Estado de transição em `t`: qual par está em crossfade e o progresso 0..1. */
export interface TransitionState {
  from: ClipLayout
  to: ClipLayout
  progress: number
}

export function transitionAtTime(layout: Layout, t: number): TransitionState | null {
  for (let i = 0; i < layout.clips.length - 1; i++) {
    const from = layout.clips[i]
    const to = layout.clips[i + 1]
    const start = to.timelineStart
    const end = from.timelineEnd
    if (end <= start) continue
    if (t >= start && t < end) {
      return { from, to, progress: (t - start) / (end - start) }
    }
  }
  return null
}

/** Converte tempo da timeline final → tempo dentro do arquivo de origem. */
export function timelineToSource(clip: ClipLayout, t: number): number {
  return clip.inPoint + (t - clip.timelineStart)
}

/** Opacidade de um overlay em `t`, já com fade-in/out e opacidade geral. */
export function overlayOpacityAt(clip: ImageClip, t: number): number {
  const end = clip.start + clip.duration
  if (t < clip.start || t >= end) return 0
  let a = clip.opacity
  if (clip.fadeIn > 0) {
    const k = (t - clip.start) / clip.fadeIn
    if (k < 1) a *= Math.max(0, k)
  }
  if (clip.fadeOut > 0) {
    const k = (end - t) / clip.fadeOut
    if (k < 1) a *= Math.max(0, k)
  }
  return a
}

/** Ganho de um clipe de música em `t` (fades incluídos), 0 se inativo. */
export function audioGainAt(clip: AudioClip, t: number): number {
  const dur = clip.outPoint - clip.inPoint
  const end = clip.start + dur
  if (t < clip.start || t >= end) return 0
  let g = clip.volume
  if (clip.fadeIn > 0) g *= Math.min(1, (t - clip.start) / clip.fadeIn)
  if (clip.fadeOut > 0) g *= Math.min(1, (end - t) / clip.fadeOut)
  return Math.max(0, g)
}

/** Multiplicador de fade-de-preto no início/fim do vídeo, 0..1. */
export function blackFadeAt(project: Project, layout: Layout, t: number): number {
  let m = 1
  const first = project.videoTrack[0]
  const last = project.videoTrack[project.videoTrack.length - 1]
  if (first?.fadeFromBlack && t < first.fadeFromBlack) {
    m *= Math.max(0, t / first.fadeFromBlack)
  }
  if (last?.fadeToBlack) {
    const start = layout.duration - last.fadeToBlack
    if (t > start) m *= Math.max(0, (layout.duration - t) / last.fadeToBlack)
  }
  return m
}
