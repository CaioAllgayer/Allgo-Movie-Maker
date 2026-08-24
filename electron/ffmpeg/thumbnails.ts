import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegPath, cacheDir } from './paths'
import { run } from './run'
import { probeFile, kindFromPath } from './probe'

/** Chave de cache = caminho + mtime + tamanho, para invalidar se o arquivo mudar. */
function fileKey(path: string): string {
  let stamp = ''
  try {
    const st = statSync(path)
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    stamp = 'missing'
  }
  return createHash('sha1').update(`${path}|${stamp}`).digest('hex').slice(0, 16)
}

function bucket(path: string): string {
  const dir = join(cacheDir(), fileKey(path))
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Gera `count` thumbnails distribuídos ao longo do vídeo (filmstrip da timeline).
 * Para imagens, devolve um único thumbnail. Resultados ficam em cache no
 * userData e são reaproveitados entre sessões.
 */
export async function generateThumbnails(path: string, count: number, height: number): Promise<string[]> {
  const kind = kindFromPath(path)
  const dir = bucket(path)
  const n = Math.max(1, Math.min(count, 60))

  if (kind === 'image') {
    const out = join(dir, `img-${height}.jpg`)
    if (!existsSync(out)) {
      await run(ffmpegPath(), [
        '-hide_banner', '-nostdin', '-y',
        '-i', path,
        '-vf', `scale=-2:${height}`,
        '-frames:v', '1',
        out
      ])
    }
    return existsSync(out) ? [out] : []
  }

  if (kind === 'audio') return []

  const info = await probeFile(path)
  const duration = info.duration || 1
  const results: string[] = []

  for (let i = 0; i < n; i++) {
    // Pega o meio de cada fatia — evita frames pretos de abertura/fecho.
    const t = duration * ((i + 0.5) / n)
    const out = join(dir, `t-${n}-${height}-${i}.jpg`)
    if (!existsSync(out)) {
      await run(ffmpegPath(), [
        '-hide_banner', '-nostdin', '-y',
        '-ss', t.toFixed(3),
        '-i', path,
        '-vf', `scale=-2:${height}`,
        '-frames:v', '1',
        '-q:v', '4',
        out
      ])
    }
    if (existsSync(out)) results.push(out)
  }
  return results
}

/** Waveform (showwavespic) para os clipes de áudio/vídeo da timeline. */
export async function generateWaveform(path: string, width: number, height: number): Promise<string | null> {
  const dir = bucket(path)
  const out = join(dir, `wave-${width}x${height}.png`)
  if (existsSync(out)) return out

  const { code } = await run(
    ffmpegPath(),
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', path,
      '-vn',
      '-filter_complex',
      `[0:a]aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=#9678ff`,
      '-frames:v', '1',
      out
    ],
    120_000
  )
  if (code !== 0 || !existsSync(out)) return null
  return out
}
