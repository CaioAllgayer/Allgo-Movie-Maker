import type { EncoderName, ExportOptions, ImageClip, MediaItem, Project } from '@shared/types'
import { computeLayout, type Layout } from './computeLayout'

/**
 * Monta o comando FFmpeg completo do export. Função PURA — nada de fs, spawn
 * ou Electron aqui — porque é a parte com mais chance de bug e precisa de
 * testes unitários comparando o grafo gerado (tests/buildExportCommand.test.ts).
 *
 * Estratégia: um único `filter_complex`, escrito num arquivo separado e passado
 * com `-filter_complex_script` (o grafo passa fácil dos 8k chars com 6 clipes +
 * 12 overlays, e o Windows tem limite de linha de comando).
 */

export interface ExportCommand {
  /** argumentos do ffmpeg, na ordem */
  args: string[]
  /** conteúdo a gravar em options.filterScriptPath */
  filterScript: string
  /** duração final em segundos — usada para calcular o progresso */
  duration: number
}

const num = (v: number, digits = 6): string => {
  const r = Number(v.toFixed(digits))
  return Object.is(r, -0) ? '0' : String(r)
}

interface OverlayEntry {
  clip: ImageClip
  media: MediaItem
  inputIndex: number
}

export function buildExportCommand(
  project: Project,
  outputPath: string,
  options: ExportOptions
): ExportCommand {
  if (project.videoTrack.length === 0) {
    throw new Error('Não há clipes na trilha de vídeo.')
  }

  const mediaById = new Map(project.media.map((m) => [m.id, m]))
  const layout = computeLayout({ ...project, fps: options.fps })
  const fps = options.fps
  const W = options.width
  const H = options.height

  const args: string[] = ['-hide_banner', '-nostdin', '-y']
  const chunks: string[] = []

  /* ---------------------------------------------------------------- */
  /* Inputs                                                            */
  /* ---------------------------------------------------------------- */

  let inputIndex = 0
  const videoInputs: number[] = []

  for (const clip of project.videoTrack) {
    const media = mediaById.get(clip.mediaId)
    if (!media) throw new Error(`Mídia não encontrada para o clipe ${clip.id}.`)
    if (options.hwaccel) args.push('-hwaccel', 'auto')
    args.push('-i', media.path)
    videoInputs.push(inputIndex++)
  }

  const overlays: OverlayEntry[] = []
  // trilha 0 primeiro = fica por baixo; dentro da trilha, ordem temporal.
  for (const track of project.overlayTracks) {
    const ordered = [...track].sort((a, b) => a.start - b.start)
    for (const clip of ordered) {
      const media = mediaById.get(clip.mediaId)
      if (!media) continue
      args.push('-loop', '1', '-t', num(clip.duration), '-i', media.path)
      overlays.push({ clip, media, inputIndex: inputIndex++ })
    }
  }

  const musicInputs: { index: number; clip: Project['musicTrack'][number] }[] = []
  for (const clip of project.musicTrack) {
    const media = mediaById.get(clip.mediaId)
    if (!media) continue
    args.push('-i', media.path)
    musicInputs.push({ index: inputIndex++, clip })
  }

  /* ---------------------------------------------------------------- */
  /* Vídeo: normalização por clipe                                     */
  /* ---------------------------------------------------------------- */

  // xfade exige fps/resolução/SAR/formato idênticos nos dois lados, então a
  // normalização abaixo é obrigatória em TODO clipe, mesmo já em 1080p.
  project.videoTrack.forEach((clip, i) => {
    const l = layout.clips[i]
    chunks.push(
      `[${videoInputs[i]}:v]trim=start=${num(l.inPoint)}:end=${num(l.outPoint)},` +
        `setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${num(fps)},setsar=1,format=yuv420p[v${i}]`
    )
  })

  /* ---------------------------------------------------------------- */
  /* Vídeo: encadeamento com xfade                                     */
  /* ---------------------------------------------------------------- */

  let videoLabel = '[v0]'
  for (let i = 0; i < layout.clips.length - 1; i++) {
    const l = layout.clips[i]
    const nextLayout = layout.clips[i + 1]
    // `offset` é o instante, na saída acumulada, em que a transição COMEÇA —
    // ou seja, o timelineStart do clipe seguinte.
    const offset = nextLayout.timelineStart
    const out = `[x${i + 1}]`
    chunks.push(
      `${videoLabel}[v${i + 1}]xfade=transition=fade:` +
        `duration=${num(l.transitionAfter)}:offset=${num(offset)}${out}`
    )
    videoLabel = out
  }

  /* ---------------------------------------------------------------- */
  /* Overlays de imagem                                                */
  /* ---------------------------------------------------------------- */

  overlays.forEach((entry, k) => {
    const { clip, inputIndex: idx } = entry
    const parts: string[] = ['format=rgba', `scale=w=iw*${num(clip.scale)}:h=-1`]

    // ⚠️ Os fades usam tempo LOCAL (0-based) do stream, por isso vêm ANTES do
    // setpts que desloca o overlay para o tempo final. Inverter quebra tudo.
    if (clip.fadeIn > 0) parts.push(`fade=t=in:st=0:d=${num(clip.fadeIn)}:alpha=1`)
    if (clip.fadeOut > 0) {
      parts.push(`fade=t=out:st=${num(Math.max(0, clip.duration - clip.fadeOut))}:d=${num(clip.fadeOut)}:alpha=1`)
    }
    if (clip.opacity < 1) parts.push(`colorchannelmixer=aa=${num(clip.opacity)}`)
    parts.push(`setpts=PTS-STARTPTS+${num(clip.start)}/TB`)

    chunks.push(`[${idx}:v]${parts.join(',')}[ov${k}]`)

    // x/y do modelo são o CENTRO normalizado; overlay quer o canto superior
    // esquerdo em px. W/H = quadro principal, w/h = overlay (expressões do
    // próprio filtro, então não dependemos das dimensões da mídia).
    const end = clip.start + clip.duration
    const out = `[ovc${k}]`
    chunks.push(
      `${videoLabel}[ov${k}]overlay=` +
        `x='W*${num(clip.x)}-w/2':y='H*${num(clip.y)}-h/2':` +
        `enable='between(t,${num(clip.start)},${num(end)})':eof_action=pass${out}`
    )
    videoLabel = out
  })

  /* ---------------------------------------------------------------- */
  /* Ajuste global de cor + fades de preto                             */
  /* ---------------------------------------------------------------- */

  const { brightness, contrast, saturation } = project.adjust
  if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
    chunks.push(
      `${videoLabel}eq=brightness=${num(brightness / 200)}:` +
        `contrast=${num(1 + contrast / 100)}:saturation=${num(1 + saturation / 100)}[veq]`
    )
    videoLabel = '[veq]'
  }

  const first = project.videoTrack[0]
  const last = project.videoTrack[project.videoTrack.length - 1]
  const blackFades: string[] = []
  if (first.fadeFromBlack && first.fadeFromBlack > 0) {
    blackFades.push(`fade=t=in:st=0:d=${num(first.fadeFromBlack)}:color=black`)
  }
  if (last.fadeToBlack && last.fadeToBlack > 0) {
    const st = Math.max(0, layout.duration - last.fadeToBlack)
    blackFades.push(`fade=t=out:st=${num(st)}:d=${num(last.fadeToBlack)}:color=black`)
  }
  if (blackFades.length) {
    chunks.push(`${videoLabel}${blackFades.join(',')}[vfade]`)
    videoLabel = '[vfade]'
  }

  chunks.push(`${videoLabel}format=yuv420p[vout]`)

  /* ---------------------------------------------------------------- */
  /* Áudio                                                             */
  /* ---------------------------------------------------------------- */

  const AFMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'

  project.videoTrack.forEach((clip, i) => {
    const media = mediaById.get(clip.mediaId)!
    const l = layout.clips[i]
    if (media.hasAudio && !clip.muted && clip.volume > 0) {
      chunks.push(
        `[${videoInputs[i]}:a]atrim=start=${num(l.inPoint)}:end=${num(l.outPoint)},` +
          `asetpts=PTS-STARTPTS,volume=${num(clip.volume)},${AFMT}[a${i}]`
      )
    } else {
      // Clipe sem faixa de áudio ou mutado: silêncio do mesmo comprimento, para
      // o acrossfade seguinte continuar simétrico com o vídeo.
      chunks.push(
        `anullsrc=r=48000:cl=stereo:d=${num(l.sourceDuration)},asetpts=PTS-STARTPTS,${AFMT}[a${i}]`
      )
    }
  })

  let audioLabel = '[a0]'
  for (let i = 0; i < layout.clips.length - 1; i++) {
    const l = layout.clips[i]
    const out = `[ax${i + 1}]`
    chunks.push(`${audioLabel}[a${i + 1}]acrossfade=d=${num(l.transitionAfter)}:c1=tri:c2=tri${out}`)
    audioLabel = out
  }

  if (musicInputs.length) {
    const musicLabels: string[] = []
    musicInputs.forEach(({ index, clip }, m) => {
      const dur = Math.max(0, clip.outPoint - clip.inPoint)
      const parts = [
        `atrim=start=${num(clip.inPoint)}:end=${num(clip.outPoint)}`,
        'asetpts=PTS-STARTPTS',
        `volume=${num(clip.volume)}`
      ]
      if (clip.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${num(clip.fadeIn)}`)
      if (clip.fadeOut > 0) {
        parts.push(`afade=t=out:st=${num(Math.max(0, dur - clip.fadeOut))}:d=${num(clip.fadeOut)}`)
      }
      if (clip.start > 0) {
        const ms = Math.round(clip.start * 1000)
        parts.push(`adelay=${ms}|${ms}:all=1`)
      }
      parts.push(AFMT)
      const label = `[m${m}]`
      chunks.push(`[${index}:a]${parts.join(',')}${label}`)
      musicLabels.push(label)
    })
    // normalize=0 impede o amix de atenuar o áudio principal.
    chunks.push(
      `${audioLabel}${musicLabels.join('')}amix=inputs=${musicLabels.length + 1}:` +
        `duration=first:dropout_transition=0:normalize=0,${AFMT}[aout]`
    )
  } else {
    chunks.push(`${audioLabel}aresample=48000[aout]`)
  }

  /* ---------------------------------------------------------------- */
  /* Saída                                                             */
  /* ---------------------------------------------------------------- */

  args.push(options.filterComplexFlag ?? '-/filter_complex', options.filterScriptPath)
  args.push('-map', '[vout]', '-map', '[aout]')
  args.push(...encoderArgs(options.codec, options.quality))
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
  args.push('-movflags', '+faststart')
  args.push('-progress', 'pipe:1', '-nostats')
  args.push(outputPath)

  return {
    args,
    filterScript: chunks.join(';\n') + '\n',
    duration: layout.duration
  }
}

const CQ: Record<EncoderName, { alta: number; media: number }> = {
  hevc_nvenc: { alta: 21, media: 25 },
  h264_nvenc: { alta: 19, media: 23 },
  av1_nvenc: { alta: 28, media: 32 },
  libx264: { alta: 18, media: 22 }
}

export function encoderArgs(codec: EncoderName, quality: 'alta' | 'media'): string[] {
  const q = CQ[codec][quality]
  if (codec === 'libx264') {
    return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(q), '-pix_fmt', 'yuv420p']
  }
  const base = [
    '-c:v', codec,
    '-preset', 'p5',
    '-tune', 'hq',
    '-rc', 'vbr',
    '-cq', String(q),
    '-b:v', '0',
    '-maxrate', '40M',
    '-bufsize', '80M',
    '-spatial-aq', '1',
    '-temporal-aq', '1',
    '-pix_fmt', 'yuv420p'
  ]
  if (codec !== 'av1_nvenc') base.push('-b_ref_mode', 'middle')
  if (codec === 'hevc_nvenc') base.push('-tag:v', 'hvc1')
  return base
}

/** Estimativa grosseira do tamanho final, em bytes (para o resumo do modal). */
export function estimateSize(duration: number, quality: 'alta' | 'media'): number {
  const mbps = quality === 'alta' ? 16 : 10
  return Math.round(((mbps * 1_000_000) / 8 + 192_000 / 8) * duration)
}

export function layoutOf(project: Project): Layout {
  return computeLayout(project)
}
