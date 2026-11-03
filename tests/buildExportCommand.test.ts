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
    expect(chain).toContain('trim=start=0:end=5')
    expect(chain).toContain('scale=1920:1080:force_original_aspect_ratio=decrease')
    expect(chain).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black')
    expect(chain).toContain('fps=30')
    expect(chain).toContain('setsar=1')
    expect(chain).toContain('format=yuv420p')
  })

  it('aceita saída 4K e mantém o enquadramento das placas', () => {
    const fourK = buildExportCommand(
      project({
        media: [media('a'), media('png', { kind: 'image', path: 'C:\\midia\\placa.png' })],
        videoTrack: [videoClip('v1', 'a')],
        overlayTracks: [[imageClip('i1', 'png', { scale: 0.5 })]]
      }),
      'out.mp4',
      options({ width: 3840, height: 2160 })
    )
    expect(fourK.filterScript).toContain('scale=3840:2160:force_original_aspect_ratio=decrease')
    expect(fourK.filterScript).toContain('pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=black')
    expect(fourK.filterScript).toContain('scale=w=iw*1:h=-1')
  })

  it('exporta em 720p horizontal e Reels sem mudar a proporção das placas', () => {
    for (const [projectWidth, projectHeight, outputWidth, outputHeight] of [
      [1920, 1080, 1280, 720],
      [1080, 1920, 720, 1280]
    ]) {
      const hd = buildExportCommand(
        project({
          width: projectWidth,
          height: projectHeight,
          media: [media('a'), media('png', { kind: 'image' })],
          videoTrack: [videoClip('v1', 'a')],
          overlayTracks: [[imageClip('i1', 'png', { scale: 0.6 })]]
        }),
        'out.mp4',
        options({ width: outputWidth, height: outputHeight })
      )
      expect(hd.filterScript).toContain(`scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease`)
      expect(hd.filterScript).toContain('scale=w=iw*0.4:h=-1')
    }
  })

  it('exporta projeto Reels com a placa no tamanho visto na prévia', () => {
    const reels = project({
      width: 1080,
      height: 1920,
      media: [media('a'), media('png', { kind: 'image', width: 960, height: 452 })],
      videoTrack: [videoClip('v1', 'a')],
      overlayTracks: [[imageClip('i1', 'png', { x: 0.5, y: 0.16, scale: 0.57 })]]
    })
    const command = buildExportCommand(reels, 'out.mp4', options({ width: 1080, height: 1920 }))
    expect(command.filterScript).toContain('scale=1080:1920:force_original_aspect_ratio=decrease')
    expect(command.filterScript).toContain('scale=w=iw*0.57:h=-1')
    expect(command.filterScript).toContain("x='W*0.5-w/2':y='H*0.16-h/2'")
  })

  it('impede exportar em outra proporção sem conferir o enquadramento no editor', () => {
    expect(() => buildExportCommand(p, 'out.mp4', options({ width: 1080, height: 1920 })))
      .toThrow(/formato no editor/i)
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

  it('busca e limita cada input ao trecho usado pelo clipe', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const inputArgs = cmd.args.slice(0, cmd.args.indexOf('-/filter_complex'))
    expect(inputArgs).toEqual(expect.arrayContaining(['-ss', '1', '-t', '5', '-i', 'C:\\midia\\a.mp4']))
    expect(cmd.filterScript).toContain('[0:v]trim=start=0:end=5')
    expect(cmd.filterScript).toContain('[0:a]atrim=start=0:end=5')
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

  it('cada imagem entra uma vez e é repetida em memória pela duração do clipe', () => {
    const cmd = buildExportCommand(p, 'out.mp4', options())
    const joined = cmd.args.join(' ')
    expect(joined).toContain('-framerate 30 -i C:\\midia\\placa.png')
    expect(joined).not.toContain('-loop 1')
    const chain = lines(cmd.filterScript).find((l) => l.includes('[ov0]'))!
    expect(chain).toContain('loop=loop=-1:size=1:start=0')
    expect(chain).toContain('fps=30')
    expect(chain).toContain('trim=duration=4')
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
  it('não emite filtro de cor quando os ajustes estão neutros', () => {
    const p = project({ media: [media('a')], videoTrack: [videoClip('v1', 'a')] })
    const script = buildExportCommand(p, 'out.mp4', options()).filterScript
    expect(script).not.toContain('format=gbrp')
    expect(colorFilterChain({ brightness: 0, contrast: 0, saturation: 0 })).toBeNull()
  })

  it('replica o filtro CSS em RGB: brilho e contraste por canal + matriz do saturate()', () => {
    const p = project({
      media: [media('a')],
      videoTrack: [videoClip('v1', 'a')],
      adjust: { brightness: 20, contrast: 10, saturation: -50 }
    })
    const chain = lines(buildExportCommand(p, 'out.mp4', options()).filterScript).find((l) =>
      l.includes('format=gbrp')
    )!
    // eq mexe só na luma e usa outra conta de saturação — não pode voltar.
    expect(chain).not.toContain('eq=')
    const e = 'clip((clip(val/255*1.1\\,0\\,1)-0.5)*1.1+0.5\\,0\\,1)*255'
    expect(colorFilterChain({ brightness: 20, contrast: 10, saturation: -50 })).toBe(
      'format=gbrp,' +
        `lutrgb=r='${e}':g='${e}':b='${e}',` +
        'colorchannelmixer=rr=0.6065:rg=0.3575:rb=0.036:gr=0.1065:gg=0.8575:gb=0.036:br=0.1065:bg=0.3575:bb=0.536,' +
        'format=yuv420p'
    )
  })

  it('só saturação dispensa o lutrgb; só brilho dispensa a matriz', () => {
    expect(colorFilterChain({ brightness: 0, contrast: 0, saturation: 50 })).not.toContain('lutrgb')
    expect(colorFilterChain({ brightness: 30, contrast: 0, saturation: 0 })).not.toContain('colorchannelmixer')
  })

  it('aplica cor depois dos overlays (vale para o quadro composto)', () => {
    const p = project({
      media: [media('a'), media('png', { kind: 'image', path: 'C:\\p.png' })],
      videoTrack: [videoClip('v1', 'a', { outPoint: 10 })],
      overlayTracks: [[imageClip('i1', 'png')]],
      adjust: { brightness: 10, contrast: 0, saturation: 0 }
    })
    const script = buildExportCommand(p, 'out.mp4', options()).filterScript
    expect(script.indexOf('lutrgb')).toBeGreaterThan(-1)
    expect(script.indexOf('overlay=x=')).toBeLessThan(script.indexOf('lutrgb'))
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
    expect(music).toContain('atrim=start=0:end=20')
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

  it('4K aumenta a estimativa de tamanho proporcionalmente aos pixels', () => {
    const fullHd = estimateSize(60, 'alta', 'hevc_nvenc', 30, 1920, 1080)
    const fourK = estimateSize(60, 'alta', 'hevc_nvenc', 30, 3840, 2160)
    expect(fourK).toBeGreaterThan(fullHd * 3.5)
    expect(fourK).toBeLessThan(fullHd * 4.5)
  })
})
