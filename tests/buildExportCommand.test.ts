import { describe, expect, it } from 'vitest'
import type { ExportOptions } from '@shared/types'
import { buildExportCommand, colorFilterChain, encoderArgs, estimateSize } from '@engine/buildExportCommand'
import { computeLayout } from '@engine/computeLayout'
import { imageClip, media, project, videoClip } from './helpers'

const options = (overrides: Partial<ExportOptions> = {}): ExportOptions => ({
  fps: 30,
  codec: 'hevc_nvenc',
  quality: 'alta',
  width: 1920,
  height: 1080,
  hwaccel: true,
  filterScriptPath: 'C:\\tmp\\filter.txt',
  ...overrides
})

/** Cada linha do script é um elo do grafo — facilita asserções pontuais. */
const lines = (script: string): string[] =>
  script
    .split(/;\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

describe('buildExportCommand — estrutura básica', () => {
  const p = project({
    media: [media('a')],
    videoTrack: [videoClip('v1', 'a', { inPoint: 1, outPoint: 6 })]
  })

  it('recusa projeto sem clipes de vídeo', () => {
    expect(() => buildExportCommand(project(), 'out.mp4', options())).toThrow(/trilha de vídeo/i)
  })

  it('passa o grafo por arquivo, não pela linha de comando', () => {
    const cmd = buildExportCommand(p, 'C:\\out.mp4', options())
    expect(cmd.args).toContain('-/filter_complex')
    expect(cmd.args[cmd.args.indexOf('-/filter_complex') + 1]).toBe('C:\\tmp\\filter.txt')
    expect(cmd.args.join(' ')).not.toContain('trim=start=')
  })

  it('respeita a flag antiga quando a build do FFmpeg é anterior a 2024', () => {
    const cmd = buildExportCommand(p, 'C:\\out.mp4', options({ filterComplexFlag: '-filter_complex_script' }))
    expect(cmd.args).toContain('-filter_complex_script')
    expect(cmd.args).not.toContain('-/filter_complex')
  })

  it('mapeia as saídas nomeadas e termina no arquivo de saída', () => {
    const cmd = buildExportCommand(p, 'C:\\out.mp4', options())
    expect(cmd.args).toEqual(expect.arrayContaining(['-map', '[vout]', '-map', '[aout]']))
    expect(cmd.args[cmd.args.length - 1]).toBe('C:\\out.mp4')
    expect(cmd.args).toContain('-progress')
    expect(cmd.args).toContain('+faststart')
  })

  it('normaliza todo clipe (xfade exige fps/SAR/formato iguais dos dois lados)', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const chain = lines(cmd.filterScript)[0]
    expect(chain).toContain('trim=start=1:end=6')
    expect(chain).toContain('scale=1920:1080:force_original_aspect_ratio=decrease')
    expect(chain).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black')
    expect(chain).toContain('fps=30')
    expect(chain).toContain('setsar=1')
    expect(chain).toContain('format=yuv420p')
  })

  it('a duração relatada é a mesma do computeLayout', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    expect(cmd.duration).toBeCloseTo(computeLayout(p).duration, 6)
  })

  it('adiciona -hwaccel antes de cada input de vídeo quando ligado', () => {
    const two = project({
      media: [media('a')],
      videoTrack: [videoClip('v1', 'a'), videoClip('v2', 'a')]
    })
    const on = buildExportCommand(two, 'out.mp4', options({ hwaccel: true }))
    expect(on.args.filter((a) => a === '-hwaccel')).toHaveLength(2)
    const off = buildExportCommand(two, 'out.mp4', options({ hwaccel: false }))
    expect(off.args).not.toContain('-hwaccel')
  })
})

describe('buildExportCommand — junções', () => {
  const base = project({
    media: [media('a')],
    videoTrack: [
      videoClip('v1', 'a', { outPoint: 10, transitionAfter: { duration: 1 } }),
      videoClip('v2', 'a', { outPoint: 10 })
    ]
  })

  it('usa xfade com offset = timelineStart do clipe seguinte', () => {
    const cmd = buildExportCommand(base, 'out.mp4', options())
    const xfade = lines(cmd.filterScript).find((l) => l.includes('xfade'))
    expect(xfade).toBe('[v0][v1]xfade=transition=fade:duration=1:offset=9[x1]')
  })

  it('corte seco vira xfade de 1 frame (xfade não aceita duration=0)', () => {
    const dry = project({
      media: [media('a')],
      videoTrack: [videoClip('v1', 'a', { outPoint: 10 }), videoClip('v2', 'a', { outPoint: 10 })]
    })
    const cmd = buildExportCommand(dry, 'out.mp4', options())
    const xfade = lines(cmd.filterScript).find((l) => l.includes('xfade'))!
    const duration = Number(/duration=([\d.]+)/.exec(xfade)![1])
    expect(duration).toBeCloseTo(1 / 30, 5)
  })

  it('offset + duration nunca passa do fim do stream acumulado', () => {
    const chained = project({
      media: [media('a')],
      videoTrack: [
        videoClip('v1', 'a', { outPoint: 8, transitionAfter: { duration: 1.5 } }),
        videoClip('v2', 'a', { outPoint: 6, transitionAfter: { duration: 0.5 } }),
        videoClip('v3', 'a', { outPoint: 7 })
      ]
    })
    const layout = computeLayout(chained)
    const cmd = buildExportCommand(chained, 'out.mp4', options())
    const xfades = lines(cmd.filterScript).filter((l) => l.includes('xfade'))
    xfades.forEach((line, i) => {
      const offset = Number(/offset=([\d.]+)/.exec(line)![1])
      const duration = Number(/duration=([\d.]+)/.exec(line)![1])
      expect(offset + duration).toBeLessThanOrEqual(layout.clips[i].timelineEnd + 1e-6)
    })
  })

  it('o áudio espelha cada junção com acrossfade de mesma duração', () => {
    const cmd = buildExportCommand(base, 'out.mp4', options())
    const acrossfade = lines(cmd.filterScript).find((l) => l.includes('acrossfade'))
    expect(acrossfade).toContain('acrossfade=d=1')
  })

  it('clipe sem áudio entra como silêncio do mesmo comprimento', () => {
    const silent = project({
      media: [media('a'), media('b', { hasAudio: false, path: 'C:\\midia\\b.mp4' })],
      videoTrack: [videoClip('v1', 'a', { outPoint: 5 }), videoClip('v2', 'b', { outPoint: 4 })]
    })
    const cmd = buildExportCommand(silent, 'out.mp4', options())
    const nullsrc = lines(cmd.filterScript).find((l) => l.includes('anullsrc'))
    expect(nullsrc).toContain('anullsrc=r=48000:cl=stereo:d=4')
  })

  it('clipe mutado também vira silêncio', () => {
    const muted = project({
      media: [media('a')],
      videoTrack: [videoClip('v1', 'a', { outPoint: 5, muted: true })]
    })
    const cmd = buildExportCommand(muted, 'out.mp4', options())
    expect(cmd.filterScript).toContain('anullsrc')
  })
})

describe('buildExportCommand — overlays', () => {
  const p = project({
    media: [media('a'), media('png', { kind: 'image', path: 'C:\\midia\\placa.png', width: 800, height: 400 })],
    videoTrack: [videoClip('v1', 'a', { outPoint: 20 })],
    overlayTracks: [
      [imageClip('i1', 'png', { start: 3, duration: 4, fadeIn: 0.5, fadeOut: 0.5, scale: 0.5, opacity: 0.9 })]
    ]
  })

  it('cada imagem entra como input em loop com a duração do clipe', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const joined = cmd.args.join(' ')
    expect(joined).toContain('-loop 1 -t 4 -i C:\\midia\\placa.png')
  })

  it('fades vêm em tempo local, ANTES do setpts que desloca o overlay', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const chain = lines(cmd.filterScript).find((l) => l.includes('[ov0]'))!
    const fadeIn = chain.indexOf('fade=t=in:st=0:d=0.5:alpha=1')
    const fadeOut = chain.indexOf('fade=t=out:st=3.5:d=0.5:alpha=1')
    const setpts = chain.indexOf('setpts=PTS-STARTPTS+3/TB')
    expect(fadeIn).toBeGreaterThan(-1)
    expect(fadeOut).toBeGreaterThan(fadeIn)
    expect(setpts).toBeGreaterThan(fadeOut)
  })

  it('opacidade geral vira colorchannelmixer e a escala é relativa ao natural', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const chain = lines(cmd.filterScript).find((l) => l.includes('[ov0]'))!
    expect(chain).toContain('scale=w=iw*0.5:h=-1')
    expect(chain).toContain('colorchannelmixer=aa=0.9')
  })

  it('converte o centro normalizado para o canto superior esquerdo do overlay', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const overlay = lines(cmd.filterScript).find((l) => l.includes('overlay=x='))!
    expect(overlay).toContain(`overlay=x='W*0.5-w/2':y='H*0.5-h/2'`)
    expect(overlay).toContain(`enable='between(t,3,7)'`)
    expect(overlay).toContain('eof_action=pass')
  })

  it('empilha na ordem das trilhas: a trilha 0 é aplicada primeiro (fica por baixo)', () => {
    const stacked = project({
      media: [
        media('a'),
        media('p1', { kind: 'image', path: 'C:\\midia\\p1.png' }),
        media('p2', { kind: 'image', path: 'C:\\midia\\p2.png' })
      ],
      videoTrack: [videoClip('v1', 'a', { outPoint: 20 })],
      overlayTracks: [[imageClip('i1', 'p1')], [imageClip('i2', 'p2')]]
    })
    const cmd = buildExportCommand(stacked, 'out.mp4', options())
    const script = cmd.filterScript
    expect(script.indexOf('[ov0]')).toBeLessThan(script.indexOf('[ov1]'))
    // O segundo overlay recebe a saída do primeiro como entrada principal.
    expect(script).toContain('[ovc0][ov1]overlay=')
  })
})

describe('buildExportCommand — cor, fades de preto e música', () => {
  it('não emite eq quando os ajustes estão neutros', () => {
    const p = project({ media: [media('a')], videoTrack: [videoClip('v1', 'a')] })
    expect(buildExportCommand(p, 'out.mp4', options()).filterScript).not.toContain('eq=')
  })

  it('replica o filtro CSS: brilho multiplicativo em RGB + contraste/saturação', () => {
    const p = project({
      media: [media('a')],
      videoTrack: [videoClip('v1', 'a')],
      adjust: { brightness: 20, contrast: 10, saturation: -50 }
    })
    const chain = lines(buildExportCommand(p, 'out.mp4', options()).filterScript).find((l) =>
      l.includes('colorchannelmixer')
    )!
    expect(chain).toContain('format=gbrp')
    expect(chain).toContain('colorchannelmixer=rr=1.1:gg=1.1:bb=1.1')
    expect(chain).toContain('eq=contrast=1.1:saturation=0.5')
    expect(chain).not.toContain('eq=brightness')
    expect(colorFilterChain({ brightness: 20, contrast: 10, saturation: -50 })).toBe(
      'format=gbrp,colorchannelmixer=rr=1.1:gg=1.1:bb=1.1,eq=contrast=1.1:saturation=0.5,format=yuv420p'
    )
  })

  it('aplica cor depois dos overlays (vale para o quadro composto)', () => {
    const p = project({
      media: [media('a'), media('png', { kind: 'image', path: 'C:\\p.png' })],
      videoTrack: [videoClip('v1', 'a', { outPoint: 10 })],
      overlayTracks: [[imageClip('i1', 'png')]],
      adjust: { brightness: 10, contrast: 0, saturation: 0 }
    })
    const script = buildExportCommand(p, 'out.mp4', options()).filterScript
    expect(script.indexOf('overlay=x=')).toBeLessThan(script.indexOf('colorchannelmixer'))
  })

  it('fade de preto é aplicado no stream final, depois dos overlays', () => {
    const p = project({
      media: [media('a'), media('png', { kind: 'image', path: 'C:\\p.png' })],
      videoTrack: [videoClip('v1', 'a', { outPoint: 10, fadeFromBlack: 1, fadeToBlack: 2 })],
      overlayTracks: [[imageClip('i1', 'png')]]
    })
    const script = buildExportCommand(p, 'out.mp4', options()).filterScript
    const fade = lines(script).find((l) => l.includes('fade=t=in:st=0:d=1:color=black'))!
    expect(fade).toContain('fade=t=out:st=8:d=2:color=black')
    // ("color=black" sozinho também casaria com o pad da normalização.)
    expect(script.indexOf('overlay=x=')).toBeLessThan(script.indexOf('fade=t=in:st=0:d=1:color=black'))
  })

  it('música entra com adelay, fades e amix sem atenuação', () => {
    const p = project({
      media: [media('a'), media('mp3', { kind: 'audio', path: 'C:\\m.mp3', duration: 60 })],
      videoTrack: [videoClip('v1', 'a', { outPoint: 20 })],
      musicTrack: [
        { id: 'm1', mediaId: 'mp3', start: 2, inPoint: 5, outPoint: 25, volume: 0.5, fadeIn: 1, fadeOut: 2 }
      ]
    })
    const script = buildExportCommand(p, 'out.mp4', options()).filterScript
    const music = lines(script).find((l) => l.includes('[m0]'))!
    expect(music).toContain('atrim=start=5:end=25')
    expect(music).toContain('volume=0.5')
    expect(music).toContain('afade=t=in:st=0:d=1')
    expect(music).toContain('afade=t=out:st=18:d=2')
    expect(music).toContain('adelay=2000|2000:all=1')
    expect(script).toContain('amix=inputs=2:duration=first:dropout_transition=0:normalize=0')
  })
})

describe('encoderArgs', () => {
  it('HEVC NVENC sai com tag hvc1 para tocar em qualquer player', () => {
    const args = encoderArgs('hevc_nvenc', 'alta')
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'hevc_nvenc', '-cq', '21', '-tag:v', 'hvc1']))
  })

  it('qualidade média usa CQ maior', () => {
    expect(encoderArgs('hevc_nvenc', 'media')).toEqual(expect.arrayContaining(['-cq', '25']))
  })

  it('AV1 não recebe b_ref_mode (não suportado)', () => {
    expect(encoderArgs('av1_nvenc', 'alta')).not.toContain('-b_ref_mode')
  })

  it('fallback de CPU usa crf', () => {
    expect(encoderArgs('libx264', 'alta')).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '18']))
  })

  it('HEVC de CPU usa crf e tag hvc1', () => {
    const args = encoderArgs('libx265', 'alta')
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx265', '-crf', '21', '-tag:v', 'hvc1']))
    expect(args).not.toContain('-cq')
  })
})

describe('estimateSize', () => {
  it('cresce com a duração e cai na qualidade média', () => {
    expect(estimateSize(60, 'alta')).toBeGreaterThan(estimateSize(60, 'media'))
    expect(estimateSize(120, 'alta')).toBeGreaterThan(estimateSize(60, 'alta'))
  })

  it('reflete a compressão do codec: H.264 > HEVC > AV1', () => {
    expect(estimateSize(60, 'alta', 'libx264')).toBeGreaterThan(estimateSize(60, 'alta', 'hevc_nvenc'))
    expect(estimateSize(60, 'alta', 'hevc_nvenc')).toBeGreaterThan(estimateSize(60, 'alta', 'av1_nvenc'))
    // HEVC por GPU ou CPU é o mesmo codec: mesma estimativa.
    expect(estimateSize(60, 'alta', 'libx265')).toBe(estimateSize(60, 'alta', 'hevc_nvenc'))
  })

  it('60 fps aumenta a estimativa, mas não dobra', () => {
    const base = estimateSize(60, 'alta', 'hevc_nvenc', 30)
    const high = estimateSize(60, 'alta', 'hevc_nvenc', 60)
    expect(high).toBeGreaterThan(base)
    expect(high).toBeLessThan(base * 2)
  })
})
