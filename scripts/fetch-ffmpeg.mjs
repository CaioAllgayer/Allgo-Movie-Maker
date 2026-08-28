/**
 * Baixa os binários estáticos do FFmpeg (build BtbN, win64 GPL — inclui NVENC)
 * e coloca ffmpeg.exe / ffprobe.exe em resources/bin/.
 *
 * Uso: npm run setup
 *
 * Se você já tem os binários, é só copiá-los manualmente para resources/bin/
 * que este script não é necessário.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BIN_DIR = join(ROOT, 'resources', 'bin')
const TMP_DIR = join(ROOT, 'resources', '.tmp')

// Build estável pinada: as nightlies/master podem exigir uma API NVENC mais
// nova que o driver NVIDIA instalado no notebook. Esta versão foi validada
// com NVENC e evita que uma instalação limpa caia silenciosamente em CPU.
const URL_ZIP =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2025-08-31-13-00/ffmpeg-n7.1.1-57-g1b48158a23-win64-gpl-7.1.zip'

function log(msg) {
  process.stdout.write(`[ffmpeg] ${msg}\n`)
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name)
      if (hit) return hit
    } else if (entry.toLowerCase() === name) {
      return full
    }
  }
  return null
}

async function main() {
  if (process.platform !== 'win32') {
    log('Este script baixa binários win64. Em outra plataforma, instale o ffmpeg e o ffprobe no PATH.')
    return
  }

  mkdirSync(BIN_DIR, { recursive: true })

  if (existsSync(join(BIN_DIR, 'ffmpeg.exe')) && existsSync(join(BIN_DIR, 'ffprobe.exe'))) {
    log('Binários já presentes em resources/bin. Nada a fazer.')
    return
  }

  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })
  const zipPath = join(TMP_DIR, 'ffmpeg.zip')

  log(`Baixando ${URL_ZIP} (~100 MB, pode demorar)...`)
  const res = await fetch(URL_ZIP, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))

  log('Extraindo...')
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${TMP_DIR}" -Force`],
    { stdio: 'inherit' }
  )

  for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
    const found = findFile(TMP_DIR, exe)
    if (!found) throw new Error(`${exe} não encontrado no pacote baixado.`)
    renameSync(found, join(BIN_DIR, exe))
    log(`${exe} instalado.`)
  }

  rmSync(TMP_DIR, { recursive: true, force: true })
  log('Pronto.')
}

main().catch((err) => {
  console.error('[ffmpeg] Erro:', err.message)
  console.error('[ffmpeg] Baixe manualmente em https://github.com/BtbN/FFmpeg-Builds/releases')
  console.error('[ffmpeg] e coloque ffmpeg.exe e ffprobe.exe em resources/bin/')
  process.exit(1)
})
