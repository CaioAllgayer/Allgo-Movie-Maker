import { clipAtTime, type ClipLayout, type Layout } from './computeLayout'

/**
 * Relógio e troca de decks do preview.
 *
 * Extraído de Preview.tsx para ser testável: o bug de "reproduz o clipe
 * anterior de novo" mora aqui — o mestre antigo travava no outPoint (relógio
 * nunca cruzava a junção) ou o mestre novo nascia no inPoint (relógio voltava).
 */

/** Quanto antes de uma junção o próximo clipe é carregado no deck ocioso. */
export const PREROLL = 1.0
/** Drift aceitável num deck que já está tocando (não picotar o áudio). */
export const PLAY_DRIFT = 0.12
/** Drift aceitável num deck parado / em preroll (precisa estar no frame certo). */
export const CUE_DRIFT = 0.03
/** Jitter de relógio permitido para trás (≈ 1 frame). Saltos maiores são recusados. */
export const BACKWARD_SLACK = 0.04
/** Tolerância para considerar o clipe esgotado (outPoint / ended). */
export const EXHAUST_EPS = 0.02

export interface MediaSample {
  currentTime: number
  paused: boolean
  ended: boolean
  ready: boolean
}

export function containingClips(layout: Layout, t: number): ClipLayout[] {
  return layout.clips.filter((c) => t >= c.timelineStart && t < c.timelineEnd)
}

/** Clipes que precisam de um deck neste instante (atual + próximo em preroll). */
export function keepClipIndices(layout: Layout, t: number, preroll = PREROLL): number[] {
  const keep = new Set<number>()
  const containing = containingClips(layout, t)
  for (const c of containing) keep.add(c.index)

  const current = containing[0] ?? clipAtTime(layout, t)
  if (current) {
    keep.add(current.index)
    const next = layout.clips[current.index + 1]
    if (next && t >= next.timelineStart - preroll) keep.add(next.index)
  }
  return [...keep].sort((a, b) => a - b)
}

/** Tempo no arquivo de origem correspondente a `t` na timeline, clamado ao trecho. */
export function sourceTimeFor(clip: ClipLayout, t: number): number {
  const raw = clip.inPoint + (t - clip.timelineStart)
  const lo = clip.inPoint
  const hi = Math.max(lo, clip.outPoint)
  return Math.min(Math.max(raw, lo), hi)
}

function usable(clip: ClipLayout, s: MediaSample | null): boolean {
  if (!s || !s.ready || s.ended || s.paused) return false
  if (s.currentTime >= clip.outPoint - EXHAUST_EPS) return false
  if (s.currentTime < clip.inPoint - 0.05) return false
  return true
}

export function advanceTimelineTime(opts: {
  prevTime: number
  dt: number
  playing: boolean
  duration: number
  layout: Layout
  sample: (clipIndex: number) => MediaSample | null
}): { time: number; reachedEnd: boolean; masterIndex: number | null } {
  const { prevTime, playing, layout, sample } = opts
  const duration = Math.max(0, opts.duration)
  const dt = Math.min(0.08, Math.max(0, opts.dt))

  if (!playing) {
    return { time: prevTime, reachedEnd: false, masterIndex: null }
  }

  const containing = containingClips(layout, prevTime)
  const outgoing = containing[0]
  const incoming = containing[containing.length - 1]

  // Prefere o clipe que está ENTRANDO quando ele já está tocando no trecho certo:
  // o que está saindo costuma esgotar (ended / outPoint) e puxar o relógio para trás.
  let master: ClipLayout | null = null
  if (incoming && usable(incoming, sample(incoming.index))) master = incoming
  else if (outgoing && usable(outgoing, sample(outgoing.index))) master = outgoing

  let t = prevTime
  if (master) {
    const s = sample(master.index)!
    const derived = master.timelineStart + (s.currentTime - master.inPoint)
    // Mestre novo que ainda não seekou (currentTime ≈ inPoint) devolveria o
    // início do clipe — o playhead voltaria e o preview tocaria o anterior de novo.
    if (derived + BACKWARD_SLACK < prevTime) t = prevTime + dt
    else t = derived
  } else {
    t = prevTime + dt
  }

  // Junção: o clipe que sai acabou e o que entra ainda não é mestre. Sem isso
  // o relógio fica preso em timelineEnd - ε e o preview repete o clipe anterior.
  const incomingReady = Boolean(
    incoming && incoming !== outgoing && usable(incoming, sample(incoming.index))
  )
  if (outgoing && !incomingReady) {
    const s = sample(outgoing.index)
    if (s && (s.ended || s.currentTime >= outgoing.outPoint - EXHAUST_EPS)) {
      t = Math.max(t, outgoing.timelineEnd)
    }
  }

  if (!Number.isFinite(t) || t < 0) t = 0
  if (duration > 0 && t >= duration) {
    return { time: duration, reachedEnd: true, masterIndex: master?.index ?? null }
  }
  return { time: t, reachedEnd: false, masterIndex: master?.index ?? null }
}
