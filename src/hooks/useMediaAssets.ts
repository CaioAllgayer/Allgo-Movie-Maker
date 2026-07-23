import { useEffect, useState } from 'react'
import { mediaUrl } from '@engine/media'

/**
 * Caches em memória para não pedir a mesma thumbnail/waveform ao main a cada
 * render da timeline (o disco já tem cache, mas o IPC não é de graça).
 */
const thumbCache = new Map<string, Promise<string[]>>()
const waveCache = new Map<string, Promise<string | null>>()

export function loadThumbnails(path: string, count: number, height: number): Promise<string[]> {
  const key = `${path}|${count}|${height}`
  let entry = thumbCache.get(key)
  if (!entry) {
    entry = window.allgo.generateThumbnails(path, count, height).catch(() => [])
    thumbCache.set(key, entry)
  }
  return entry
}

export function useThumbnails(path: string | undefined, count = 16, height = 64): string[] {
  const [list, setList] = useState<string[]>([])
  useEffect(() => {
    if (!path) {
      setList([])
      return
    }
    let alive = true
    loadThumbnails(path, count, height).then((paths) => {
      if (alive) setList(paths.map(mediaUrl))
    })
    return () => {
      alive = false
    }
  }, [path, count, height])
  return list
}

export function useWaveform(path: string | undefined, enabled: boolean, width = 900, height = 90): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path || !enabled) {
      setUrl(null)
      return
    }
    const key = `${path}|${width}|${height}`
    let entry = waveCache.get(key)
    if (!entry) {
      entry = window.allgo.generateWaveform(path, width, height).catch(() => null)
      waveCache.set(key, entry)
    }
    let alive = true
    entry.then((result) => {
      if (alive) setUrl(result ? mediaUrl(result) : null)
    })
    return () => {
      alive = false
    }
  }, [path, enabled, width, height])
  return url
}
