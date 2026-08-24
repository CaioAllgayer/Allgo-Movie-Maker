import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { AudioClip, ImageClip, VideoClip } from '@shared/types'
import { computeLayout, MAX_TRANSITION, MIN_TRANSITION, maxTransitionAt } from '@engine/computeLayout'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'

export function PropertiesPanel() {
  const project = useProject((s) => s.project)
  const selection = useUi((s) => s.selection)

  const body = useMemo(() => {
    switch (selection.type) {
      case 'video':
        return <VideoClipProps id={selection.id} />
      case 'image':
        return <ImageClipProps id={selection.id} />
      case 'audio':
        return <AudioClipProps id={selection.id} />
      case 'junction':
        return <JunctionProps index={selection.index} />
      default:
        return <GlobalAdjust />
    }
  }, [selection, project])

  return (
    <aside className="panel right-panel">
      <div className="panel-header">
        <span>{titleFor(selection.type)}</span>
      </div>
      <div className="panel-body">{body}</div>
    </aside>
  )
}

function titleFor(type: string): string {
  switch (type) {
    case 'video':
      return 'Clipe de vídeo'
    case 'image':
      return 'Placa'
    case 'audio':
      return 'Música'
    case 'junction':
      return 'Transição'
    default:
      return 'Ajustes'
  }
}

/* ==================================================================== */
/* Controles reutilizáveis                                               */
/* ==================================================================== */

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  inputScale = 1,
  decimals = 0,
  suffix,
  onChange,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Fator valor→caixinha (ex.: 100 mostra 0–2 como 0–200%). */
  inputScale?: number
  decimals?: number
  suffix?: string
  onChange: (value: number) => void
  onCommit?: () => void
}) {
  // Enquanto o usuário digita, a caixinha mostra o texto cru; ao sair, volta
  // a espelhar o valor formatado.
  const [text, setText] = useState<string | null>(null)
  const display = (value * inputScale).toFixed(decimals)

  const apply = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'))
    if (!Number.isFinite(parsed)) return
    onChange(Math.max(min, Math.min(max, parsed / inputScale)))
  }

  return (
    <div className="slider-row">
      <div className="head">
        <span>{label}</span>
        <span className="value-box">
          <input
            type="number"
            className="value-input"
            min={min * inputScale}
            max={max * inputScale}
            step={step * inputScale}
            value={text ?? display}
            onFocus={(e) => {
              onCommit?.()
              e.currentTarget.select()
            }}
            onChange={(e) => {
              setText(e.target.value)
              apply(e.target.value)
            }}
            onBlur={() => setText(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          {suffix && <span className="unit">{suffix}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        // commit no pointerdown: um arraste inteiro vira UM passo de undo.
        onPointerDown={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/* ==================================================================== */
/* Ajustes globais                                                       */
/* ==================================================================== */

function GlobalAdjust() {
  const adjust = useProject((s) => s.project.adjust)
  const setAdjust = useProject((s) => s.setAdjust)
  const commit = useProject((s) => s.commit)
  const neutral = adjust.brightness === 0 && adjust.contrast === 0 && adjust.saturation === 0

  return (
    <>
      <div className="prop-group">
        <h4>Cor do vídeo inteiro</h4>
        <Slider
          label="Brilho"
          value={adjust.brightness}
          min={-100}
          max={100}
          onCommit={commit}
          onChange={(brightness) => setAdjust({ brightness })}
        />
        <Slider
          label="Contraste"
          value={adjust.contrast}
          min={-100}
          max={100}
          onCommit={commit}
          onChange={(contrast) => setAdjust({ contrast })}
        />
        <Slider
          label="Saturação"
          value={adjust.saturation}
          min={-100}
          max={100}
          onCommit={commit}
          onChange={(saturation) => setAdjust({ saturation })}
        />
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={neutral}
          onClick={() => {
            commit()
            setAdjust({ brightness: 0, contrast: 0, saturation: 0 })
          }}
        >
          <RotateCcw size={13} /> Restaurar
        </button>
      </div>
      <div className="prop-group">
        <p className="hint">
          O ajuste vale para o vídeo inteiro, não por clipe. Preview e arquivo final usam o mesmo
          mapeamento (brilho multiplicativo, contraste e saturação).
        </p>
      </div>
      <div className="prop-group">
        <h4>Seleção</h4>
        <p className="hint">Clique num clipe da timeline para editar as propriedades dele.</p>
      </div>
    </>
  )
}


/* ==================================================================== */
/* Clipe de vídeo                                                        */
/* ==================================================================== */

function VideoClipProps({ id }: { id: string }) {
  const project = useProject((s) => s.project)
  const commit = useProject((s) => s.commit)
  const update = useProject((s) => s.update)

  const index = project.videoTrack.findIndex((c) => c.id === id)
  const clip = project.videoTrack[index]
  if (!clip) return <div className="prop-group"><p className="hint">Clipe removido.</p></div>

  const media = project.media.find((m) => m.id === clip.mediaId)
  const isFirst = index === 0
  const isLast = index === project.videoTrack.length - 1
  const duration = clip.outPoint - clip.inPoint

  const patch = (fn: (c: VideoClip) => void) =>
    update((p) => {
      const target = p.videoTrack.find((c) => c.id === id)
      if (target) fn(target)
    })

  return (
    <>
      <div className="prop-group">
        <h4>{media?.name ?? 'Clipe'}</h4>
        <div className="prop-row">
          <label>Duração</label>
          <span className="value">{duration.toFixed(2)} s</span>
        </div>
        <div className="prop-row">
          <label>Trecho</label>
          <span className="value">
            {clip.inPoint.toFixed(2)} – {clip.outPoint.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="prop-group">
        <h4>Áudio</h4>
        <Slider
          label="Volume"
          value={clip.volume}
          min={0}
          max={2}
          step={0.01}
          inputScale={100}
          suffix="%"
          onCommit={commit}
          onChange={(volume) => patch((c) => { c.volume = volume })}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={clip.muted}
            onChange={(e) => {
              commit()
              patch((c) => { c.muted = e.target.checked })
            }}
          />
          Silenciar clipe
        </label>
        {!media?.hasAudio && <p className="hint" style={{ marginTop: 8 }}>Este arquivo não tem faixa de áudio.</p>}
      </div>

      {(isFirst || isLast) && (
        <div className="prop-group">
          <h4>Fade de preto</h4>
          {isFirst && (
            <>
              <label className="checkbox" style={{ marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(clip.fadeFromBlack)}
                  onChange={(e) => {
                    commit()
                    patch((c) => {
                      if (e.target.checked) c.fadeFromBlack = 1
                      else delete c.fadeFromBlack
                    })
                  }}
                />
                Abrir do preto
              </label>
              {Boolean(clip.fadeFromBlack) && (
                <Slider
                  label="Duração"
                  value={clip.fadeFromBlack ?? 1}
                  min={0.2}
                  max={3}
                  step={0.1}
                  decimals={1}
                  suffix="s"
                  onCommit={commit}
                  onChange={(v) => patch((c) => { c.fadeFromBlack = v })}
                />
              )}
            </>
          )}
          {isLast && (
            <>
              <label className="checkbox" style={{ marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(clip.fadeToBlack)}
                  onChange={(e) => {
                    commit()
                    patch((c) => {
                      if (e.target.checked) c.fadeToBlack = 1
                      else delete c.fadeToBlack
                    })
                  }}
                />
                Fechar no preto
              </label>
              {Boolean(clip.fadeToBlack) && (
                <Slider
                  label="Duração"
                  value={clip.fadeToBlack ?? 1}
                  min={0.2}
                  max={3}
                  step={0.1}
                  decimals={1}
                  suffix="s"
                  onCommit={commit}
                  onChange={(v) => patch((c) => { c.fadeToBlack = v })}
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

/* ==================================================================== */
/* Placa (imagem overlay)                                                */
/* ==================================================================== */

type FadeMode = 'nenhuma' | 'in' | 'out' | 'ambos'

function ImageClipProps({ id }: { id: string }) {
  const project = useProject((s) => s.project)
  const commit = useProject((s) => s.commit)
  const update = useProject((s) => s.update)

  let found: ImageClip | undefined
  for (const track of project.overlayTracks) {
    const clip = track.find((c) => c.id === id)
    if (clip) found = clip
  }
  if (!found) return <div className="prop-group"><p className="hint">Placa removida.</p></div>
  const clip = found
  const media = project.media.find((m) => m.id === clip.mediaId)

  const patch = (fn: (c: ImageClip) => void) =>
    update((p) => {
      for (const track of p.overlayTracks) {
        const target = track.find((c) => c.id === id)
        if (target) fn(target)
      }
    })

  const fadeDuration = Math.max(clip.fadeIn, clip.fadeOut) || 0.5
  const mode: FadeMode =
    clip.fadeIn > 0 && clip.fadeOut > 0 ? 'ambos' : clip.fadeIn > 0 ? 'in' : clip.fadeOut > 0 ? 'out' : 'nenhuma'

  const setMode = (next: FadeMode) => {
    commit()
    patch((c) => {
      c.fadeIn = next === 'in' || next === 'ambos' ? fadeDuration : 0
      c.fadeOut = next === 'out' || next === 'ambos' ? fadeDuration : 0
    })
  }

  return (
    <>
      <div className="prop-group">
        <h4>{media?.name ?? 'Placa'}</h4>
        <div className="prop-row">
          <label>Início</label>
          <span className="value">{clip.start.toFixed(2)} s</span>
        </div>
        <div className="prop-row">
          <label>Duração</label>
          <span className="value">{clip.duration.toFixed(2)} s</span>
        </div>
      </div>

      <div className="prop-group">
        <h4>Animação</h4>
        <div className="seg" style={{ marginBottom: 12 }}>
          {(
            [
              ['nenhuma', 'Nenhuma'],
              ['in', 'Fade-in'],
              ['out', 'Fade-out'],
              ['ambos', 'Ambos']
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={mode === value ? 'on' : ''} onClick={() => setMode(value)}>
              {label}
            </button>
          ))}
        </div>
        {mode !== 'nenhuma' && (
          <Slider
            label="Duração do fade"
            value={fadeDuration}
            min={0.1}
            max={2}
            step={0.1}
            decimals={1}
            suffix="s"
            onCommit={commit}
            onChange={(v) =>
              patch((c) => {
                if (c.fadeIn > 0) c.fadeIn = v
                if (c.fadeOut > 0) c.fadeOut = v
              })
            }
          />
        )}
      </div>

      <div className="prop-group">
        <h4>Aparência</h4>
        <Slider
          label="Opacidade"
          value={clip.opacity}
          min={0}
          max={1}
          step={0.01}
          inputScale={100}
          suffix="%"
          onCommit={commit}
          onChange={(opacity) => patch((c) => { c.opacity = opacity })}
        />
        <Slider
          label="Tamanho"
          value={clip.scale}
          min={0.05}
          max={3}
          step={0.01}
          inputScale={100}
          suffix="%"
          onCommit={commit}
          onChange={(scale) => patch((c) => { c.scale = scale })}
        />
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => {
            commit()
            patch((c) => {
              c.x = 0.5
              c.y = 0.5
            })
          }}
        >
          Centralizar
        </button>
      </div>

      <div className="prop-group">
        <p className="hint">Arraste a placa no preview para mover e use as alças dos cantos para redimensionar.</p>
      </div>
    </>
  )
}

/* ==================================================================== */
/* Música                                                                */
/* ==================================================================== */

function AudioClipProps({ id }: { id: string }) {
  const project = useProject((s) => s.project)
  const commit = useProject((s) => s.commit)
  const update = useProject((s) => s.update)

  const clip = project.musicTrack.find((c) => c.id === id)
  if (!clip) return <div className="prop-group"><p className="hint">Clipe removido.</p></div>
  const media = project.media.find((m) => m.id === clip.mediaId)

  const patch = (fn: (c: AudioClip) => void) =>
    update((p) => {
      const target = p.musicTrack.find((c) => c.id === id)
      if (target) fn(target)
    })

  return (
    <>
      <div className="prop-group">
        <h4>{media?.name ?? 'Música'}</h4>
        <div className="prop-row">
          <label>Duração</label>
          <span className="value">{(clip.outPoint - clip.inPoint).toFixed(2)} s</span>
        </div>
      </div>
      <div className="prop-group">
        <h4>Volume e fades</h4>
        <Slider
          label="Volume"
          value={clip.volume}
          min={0}
          max={2}
          step={0.01}
          inputScale={100}
          suffix="%"
          onCommit={commit}
          onChange={(volume) => patch((c) => { c.volume = volume })}
        />
        <Slider
          label="Fade-in"
          value={clip.fadeIn}
          min={0}
          max={5}
          step={0.1}
          decimals={1}
          suffix="s"
          onCommit={commit}
          onChange={(fadeIn) => patch((c) => { c.fadeIn = fadeIn })}
        />
        <Slider
          label="Fade-out"
          value={clip.fadeOut}
          min={0}
          max={5}
          step={0.1}
          decimals={1}
          suffix="s"
          onCommit={commit}
          onChange={(fadeOut) => patch((c) => { c.fadeOut = fadeOut })}
        />
      </div>
    </>
  )
}

/* ==================================================================== */
/* Junção / crossfade                                                    */
/* ==================================================================== */

function JunctionProps({ index }: { index: number }) {
  const project = useProject((s) => s.project)
  const setTransition = useProject((s) => s.setTransition)

  const clip = project.videoTrack[index]
  const next = project.videoTrack[index + 1]
  if (!clip || !next) return <div className="prop-group"><p className="hint">Junção não existe mais.</p></div>

  const layout = computeLayout(project)
  const current = clip.transitionAfter?.duration ?? 1
  const max = Math.min(MAX_TRANSITION, Math.max(MIN_TRANSITION, maxTransitionAt(project, index)))
  const enabled = Boolean(clip.transitionAfter)

  return (
    <>
      <div className="prop-group">
        <h4>Desvanecimento</h4>
        <label className="checkbox" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setTransition(index, e.target.checked ? 1 : null)}
          />
          Crossfade entre os clipes
        </label>
        {enabled && (
          <Slider
            label="Duração"
            value={Math.min(current, max)}
            min={MIN_TRANSITION}
            max={max}
            step={0.1}
            decimals={1}
            suffix="s"
            onCommit={() => useProject.getState().commit()}
            onChange={(v) =>
              useProject.getState().update((p) => {
                const target = p.videoTrack[index]
                if (target?.transitionAfter) target.transitionAfter.duration = v
              })
            }
          />
        )}
      </div>
      <div className="prop-group">
        <p className="hint">
          O crossfade <b>sobrepõe</b> os clipes: a duração total do vídeo diminui pelo tempo da transição.
          Total atual: <b>{layout.duration.toFixed(2)} s</b>.
        </p>
      </div>
    </>
  )
}
