import { describe, expect, it } from 'vitest'
import { clipAtTime, computeLayout } from '@engine/computeLayout'
import {
  advanceTimelineTime,
  keepClipIndices,
  sourceTimeFor,
  type MediaSample
} from '@engine/playback'
import { media, project, videoClip } from './helpers'

function layoutTwoClips(crossfade: number | null) {
  return computeLayout(
    project({
      media: [media('a'), media('b', { path: 'C:\\midia\\b.mp4' })],
      videoTrack: [
        videoClip('v1', 'a', {
          outPoint: 10,
          ...(crossfade != null ? { transitionAfter: { duration: crossfade } } : {})
        }),
        videoClip('v2', 'b', { inPoint: 2, outPoint: 12 })
      ]
    })
  )
}

function sampleAt(
  map: Record<number, Partial<MediaSample>>
): (i: number) => MediaSample | null {
  return (i) => {
    const s = map[i]
    if (!s) return null
    return {
      currentTime: s.currentTime ?? 0,
      paused: s.paused ?? false,
      ended: s.ended ?? false,
      ready: s.ready ?? true
    }
  }
}

describe('keepClipIndices', () => {
  const layout = layoutTwoClips(1)

  it('no meio do primeiro clipe só mantém ele, até o preroll', () => {
    expect(keepClipIndices(layout, 3)).toEqual([0])
  })

  it('1 s antes da junção já pede o próximo clipe', () => {
    expect(keepClipIndices(layout, 8.2)).toEqual([0, 1])
  })

  it('depois do crossfade só o segundo (e o terceiro, se houver preroll)', () => {
    expect(keepClipIndices(layout, 11)).toEqual([1])
  })
})

describe('sourceTimeFor', () => {
  const layout = layoutTwoClips(null)
  const a = layout.clips[0]
  const b = layout.clips[1]

  it('mapeia o tempo da timeline para o trecho do arquivo', () => {
    expect(sourceTimeFor(a, 0)).toBeCloseTo(0, 6)
    expect(sourceTimeFor(a, 4)).toBeCloseTo(4, 6)
  })

  it('não passa do outPoint nem fica aquém do inPoint', () => {
    expect(sourceTimeFor(a, -1)).toBeCloseTo(a.inPoint, 6)
    expect(sourceTimeFor(a, 99)).toBeCloseTo(a.outPoint, 6)
    expect(sourceTimeFor(b, b.timelineStart)).toBeCloseTo(2, 6)
  })
})

describe('advanceTimelineTime', () => {
  it('segue o relógio do vídeo mestre em reprodução normal', () => {
    const layout = layoutTwoClips(null)
    const { time, masterIndex } = advanceTimelineTime({
      prevTime: 4,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: sampleAt({ 0: { currentTime: 4.016, paused: false, ready: true } })
    })
    expect(masterIndex).toBe(0)
    expect(time).toBeCloseTo(4.016, 5)
  })

  it('NÃO volta o playhead quando o próximo clipe ainda está no inPoint', () => {
    // Bug original: no meio do crossfade o mestre vira o clipe 1, cujo <video>
    // ainda não seekou (currentTime = inPoint) → derived = timelineStart → o
    // playhead volta e o preview toca o clipe anterior de novo.
    const layout = layoutTwoClips(1)
    const prevTime = 9.5
    const { time } = advanceTimelineTime({
      prevTime,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: sampleAt({
        0: { currentTime: 9.5, paused: false, ready: true },
        1: { currentTime: 2, paused: false, ready: true }
      })
    })
    expect(time).toBeGreaterThanOrEqual(prevTime)
  })

  it('atravessa a junção quando o clipe que sai esgotou (ended / outPoint)', () => {
    const layout = layoutTwoClips(null)
    const almostEnd = layout.clips[0].timelineEnd - 0.001
    const { time } = advanceTimelineTime({
      prevTime: almostEnd,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: sampleAt({
        0: { currentTime: 10, paused: true, ended: true, ready: true },
        1: { currentTime: 2, paused: true, ready: true }
      })
    })
    expect(time).toBeGreaterThanOrEqual(layout.clips[0].timelineEnd)
    expect(clipAtTime(layout, time)?.index).toBe(1)
  })

  it('não trava quando o vídeo está clamado no outPoint', () => {
    const layout = layoutTwoClips(null)
    const stuck = layout.clips[0].timelineEnd - 0.001
    const { time } = advanceTimelineTime({
      prevTime: stuck,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: sampleAt({
        0: { currentTime: 10, paused: false, ready: true },
        1: { currentTime: 2.03, paused: true, ready: true }
      })
    })
    expect(time).toBeGreaterThanOrEqual(layout.clips[0].timelineEnd)
  })

  it('durante o crossfade usa o clipe que entra se ele já estiver tocando', () => {
    const layout = layoutTwoClips(1)
    // crossfade em [9, 10]; clipe 1 toca a partir de inPoint 2
    const { masterIndex, time } = advanceTimelineTime({
      prevTime: 9.4,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: sampleAt({
        0: { currentTime: 9.4, paused: false, ready: true },
        1: { currentTime: 2.4, paused: false, ready: true }
      })
    })
    expect(masterIndex).toBe(1)
    expect(time).toBeCloseTo(9.4, 5)
  })

  it('avança com dt quando nenhum deck está pronto (não congela)', () => {
    const layout = layoutTwoClips(null)
    const { time } = advanceTimelineTime({
      prevTime: 3,
      dt: 1 / 60,
      playing: true,
      duration: layout.duration,
      layout,
      sample: () => null
    })
    expect(time).toBeCloseTo(3 + 1 / 60, 6)
  })

  it('para no fim do projeto', () => {
    const layout = layoutTwoClips(null)
    const { time, reachedEnd } = advanceTimelineTime({
      prevTime: layout.duration - 0.01,
      dt: 0.05,
      playing: true,
      duration: layout.duration,
      layout,
      sample: () => null
    })
    expect(reachedEnd).toBe(true)
    expect(time).toBe(layout.duration)
  })

  it('pausado não anda', () => {
    const layout = layoutTwoClips(null)
    const { time } = advanceTimelineTime({
      prevTime: 5,
      dt: 1 / 60,
      playing: false,
      duration: layout.duration,
      layout,
      sample: sampleAt({ 0: { currentTime: 8, paused: false, ready: true } })
    })
    expect(time).toBe(5)
  })
})
