import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

/**
 * Protocolo `allgo://` para o renderer ler arquivos locais.
 *
 * Não dá para usar `file://` direto: em dev a página vem de http://localhost,
 * e o Chromium bloqueia file:// a partir de origem http. O protocolo próprio
 * também nos deixa responder Range requests corretamente — sem isso o seek
 * dentro de vídeos grandes no elemento <video> não funciona.
 *
 * URL: allgo://media/?path=<caminho absoluto encodado>
 */

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
}

export function registerAllgoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'allgo',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        // corsEnabled + ACAO:* deixa o canvas limpo, o que é o que permite o
        // "Capturar frame" (Ctrl+Shift+S) exportar PNG sem taint.
        corsEnabled: true
      }
    }
  ])
}

export function registerAllgoProtocol(): void {
  protocol.handle('allgo', (request) => {
    let filePath: string | null = null
    try {
      filePath = new URL(request.url).searchParams.get('path')
    } catch {
      filePath = null
    }
    if (!filePath) return new Response('Bad request', { status: 400 })

    let size: number
    try {
      const st = statSync(filePath)
      if (!st.isFile()) return new Response('Not found', { status: 404 })
      size = st.size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }

    const range = request.headers.get('Range')
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null

    if (match) {
      const hasStart = match[1] !== ''
      const hasEnd = match[2] !== ''
      let start = hasStart ? Number(match[1]) : 0
      let end = hasEnd ? Number(match[2]) : size - 1
      if (!hasStart && hasEnd) {
        // "bytes=-N" = últimos N bytes
        start = Math.max(0, size - Number(match[2]))
        end = size - 1
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` }
        })
      }
      end = Math.min(end, size - 1)
      const stream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        }
      })
    }

    const stream = createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  })
}
