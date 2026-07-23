/**
 * Relógio do preview, deliberadamente FORA do React.
 *
 * O playhead, as opacidades dos overlays e o crossfade mudam a 60 fps. Se isso
 * passasse pelo estado do React, cada frame re-renderizaria a timeline inteira.
 * Quem precisa do tempo se inscreve aqui e escreve direto no DOM (style), e só
 * o timecode faz um update de estado (limitado a ~10 Hz).
 */

type Listener = (time: number, playing: boolean) => void

class PreviewClock {
  time = 0
  playing = false
  duration = 0

  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.time, this.playing)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setTime(time: number, emit = true): void {
    const clamped = Math.max(0, this.duration > 0 ? Math.min(time, this.duration) : Math.max(0, time))
    this.time = clamped
    if (emit) this.emit()
  }

  setPlaying(playing: boolean): void {
    if (this.playing === playing) return
    this.playing = playing
    this.emit()
  }

  setDuration(duration: number): void {
    this.duration = duration
    if (this.time > duration) this.setTime(duration)
  }

  emit(): void {
    for (const listener of this.listeners) listener(this.time, this.playing)
  }
}

export const clock = new PreviewClock()

/** `MM:SS.d` — formato usado no timecode e nos tooltips. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const d = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}

/** `M:SS` — formato curto para durações em listas. */
export function formatShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
