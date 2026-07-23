import { describe, expect, it } from 'vitest'
import {
  blackFadeAt,
  clipAtTime,
  computeLayout,
  overlayOpacityAt,
  transitionAtTime
} from '@engine/computeLayout'
import { imageClip, media, project, videoClip } from './helpers'

const FRAME = 1 / 30

describe('computeLayout', () => {
  it('projeto vazio tem duração zero', () => {
    const layout = computeLayout(project())
    expect(layout.clips).toHaveLength(0)
    expect(layout.duration).toBe(0)
  })

  it('clipe único: duração = trecho aparado', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [videoClip('v1', 'a', { inPoint: 2, outPoint: 9 })]
      })
    )
    expect(layout.duration).toBeCloseTo(7, 6)
    expect(layout.clips[0].timelineStart).toBe(0)
    expect(layout.clips[0].timelineEnd).toBeCloseTo(7, 6)
  })

  it('corte seco consome exatamente 1 frame — timeline e export batem', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [videoClip('v1', 'a', { outPoint: 10 }), videoClip('v2', 'a', { outPoint: 10 })]
      })
    )
    expect(layout.clips[0].transitionAfter).toBeCloseTo(FRAME, 6)
    expect(layout.clips[0].hasCrossfade).toBe(false)
    expect(layout.clips[1].timelineStart).toBeCloseTo(10 - FRAME, 6)
    expect(layout.duration).toBeCloseTo(20 - FRAME, 6)
  })

  it('crossfade sobrepõe: a duração total diminui pelo tempo da transição', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [
          videoClip('v1', 'a', { outPoint: 10, transitionAfter: { duration: 1 } }),
          videoClip('v2', 'a', { outPoint: 10 })
        ]
      })
    )
    expect(layout.clips[0].transitionAfter).toBeCloseTo(1, 6)
    expect(layout.clips[1].timelineStart).toBeCloseTo(9, 6)
    expect(layout.duration).toBeCloseTo(19, 6)
  })

  it('crossfades encadeados acumulam corretamente', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [
          videoClip('v1', 'a', { outPoint: 10, transitionAfter: { duration: 1 } }),
          videoClip('v2', 'a', { outPoint: 10, transitionAfter: { duration: 2 } }),
          videoClip('v3', 'a', { outPoint: 10 })
        ]
      })
    )
    expect(layout.clips[1].timelineStart).toBeCloseTo(9, 6)
    expect(layout.clips[2].timelineStart).toBeCloseTo(17, 6)
    expect(layout.duration).toBeCloseTo(27, 6)
  })

  it('clampa a transição ao tamanho do clipe vizinho', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [
          videoClip('v1', 'a', { outPoint: 10, transitionAfter: { duration: 3 } }),
          videoClip('v2', 'a', { outPoint: 1 })
        ]
      })
    )
    // O segundo clipe só tem 1 s; a transição não pode passar disso.
    expect(layout.clips[0].transitionAfter).toBeLessThanOrEqual(1)
    expect(layout.clips[1].timelineStart).toBeGreaterThan(layout.clips[0].timelineStart)
    expect(layout.duration).toBeGreaterThan(0)
  })

  it('nunca deixa timelineStart retroceder, mesmo com clipes minúsculos', () => {
    const layout = computeLayout(
      project({
        media: [media('a')],
        videoTrack: [
          videoClip('v1', 'a', { outPoint: 0.2, transitionAfter: { duration: 3 } }),
          videoClip('v2', 'a', { outPoint: 0.2, transitionAfter: { duration: 3 } }),
          videoClip('v3', 'a', { outPoint: 0.2 })
        ]
      })
    )
    for (let i = 1; i < layout.clips.length; i++) {
      expect(layout.clips[i].timelineStart).toBeGreaterThan(layout.clips[i - 1].timelineStart)
    }
  })
})

describe('clipAtTime / transitionAtTime', () => {
  const p = project({
    media: [media('a')],
    videoTrack: [
      videoClip('v1', 'a', { outPoint: 10, transitionAfter: { duration: 2 } }),
      videoClip('v2', 'a', { outPoint: 10 })
    ]
  })
  const layout = computeLayout(p)

  it('durante o crossfade o mestre é o clipe que está saindo', () => {
    // crossfade em [8, 10]
    expect(clipAtTime(layout, 8.5)?.clipId).toBe('v1')
    expect(clipAtTime(layout, 10.5)?.clipId).toBe('v2')
  })

  it('progresso da transição vai de 0 a 1', () => {
    expect(transitionAtTime(layout, 7.9)).toBeNull()
    expect(transitionAtTime(layout, 8)?.progress).toBeCloseTo(0, 6)
    expect(transitionAtTime(layout, 9)?.progress).toBeCloseTo(0.5, 6)
    expect(transitionAtTime(layout, 10.5)).toBeNull()
  })
})

describe('overlayOpacityAt', () => {
  const clip = imageClip('i1', 'img', { start: 2, duration: 4, fadeIn: 1, fadeOut: 1, opacity: 0.8 })

  it('é zero fora do intervalo', () => {
    expect(overlayOpacityAt(clip, 1.9)).toBe(0)
    expect(overlayOpacityAt(clip, 6)).toBe(0)
  })

  it('sobe no fade-in, satura no meio e desce no fade-out', () => {
    expect(overlayOpacityAt(clip, 2)).toBeCloseTo(0, 6)
    expect(overlayOpacityAt(clip, 2.5)).toBeCloseTo(0.4, 6)
    expect(overlayOpacityAt(clip, 4)).toBeCloseTo(0.8, 6)
    expect(overlayOpacityAt(clip, 5.5)).toBeCloseTo(0.4, 6)
  })
})

describe('blackFadeAt', () => {
  const p = project({
    media: [media('a')],
    videoTrack: [videoClip('v1', 'a', { outPoint: 10, fadeFromBlack: 2, fadeToBlack: 2 })]
  })
  const layout = computeLayout(p)

  it('abre do preto e fecha no preto', () => {
    expect(blackFadeAt(p, layout, 0)).toBeCloseTo(0, 6)
    expect(blackFadeAt(p, layout, 1)).toBeCloseTo(0.5, 6)
    expect(blackFadeAt(p, layout, 5)).toBeCloseTo(1, 6)
    expect(blackFadeAt(p, layout, 9)).toBeCloseTo(0.5, 6)
    expect(blackFadeAt(p, layout, 10)).toBeCloseTo(0, 6)
  })
})
