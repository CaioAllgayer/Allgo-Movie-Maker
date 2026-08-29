import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, X } from 'lucide-react'
import type { EncoderName, ExportQuality, ExportResult } from '@shared/types'
import { computeLayout } from '@engine/computeLayout'
import { estimateSize } from '@engine/buildExportCommand'
import { formatTime } from '@engine/clock'
import { formatBytes, suggestedFileName } from '@engine/media'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'

export function ExportModal() {
  const open = useUi((s) => s.showExportModal)
  const setOpen = useUi((s) => s.setShowExportModal)
  const encoders = useUi((s) => s.encoders)
  const exportState = useUi((s) => s.exportState)
  const setExportState = useUi((s) => s.setExportState)
  const toast = useUi((s) => s.toast)

  const project = useProject((s) => s.project)
  const layout = useMemo(() => computeLayout(project), [project])

  const available = useMemo<{ value: EncoderName; label: string }[]>(() => {
    const list: { value: EncoderName; label: string }[] = []
    if (encoders?.hevc_nvenc) list.push({ value: 'hevc_nvenc', label: 'HEVC · NVENC (recomendado)' })
    if (encoders?.h264_nvenc) list.push({ value: 'h264_nvenc', label: 'H.264 · NVENC (mais compatível)' })
    if (encoders?.av1_nvenc) list.push({ value: 'av1_nvenc', label: 'AV1 · NVENC (menor arquivo)' })
    // Sem GPU detectada o HEVC continua disponível pela CPU — mesmo codec, mais lento.
    list.push({ value: 'libx265', label: `HEVC · CPU (libx265)${encoders?.hevc_nvenc ? '' : ' — recomendado'}` })
    list.push({ value: 'libx264', label: 'H.264 · CPU (libx264)' })
    return list
  }, [encoders])

  const [codec, setCodec] = useState<EncoderName>('libx265')
  const [quality, setQuality] = useState<ExportQuality>('alta')
  // 30 fps por padrão: vídeo falado não precisa de 60, e o arquivo fica bem menor.
  const [fps, setFps] = useState<number>(30)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (open) {
      setCodec(available[0]?.value ?? 'libx265')
      setFps(30)
      setResult(null)
      setShowLog(false)
    }
  }, [open, available, project.fps])

  useEffect(() => {
    const offDone = window.allgo.onExportDone((r) => {
      setExportState({ jobId: null, progress: null })
      setResult(r)
      if (r.ok) {
        toast('Export concluído.', 'success', {
          label: 'Abrir pasta',
          run: () => void window.allgo.showInFolder(r.outputPath)
        })
      } else if (r.canceled) {
        toast('Export cancelado.', 'info')
      } else {
        toast(r.error ?? 'Falha no export.', 'error')
      }
    })
    const offProgress = window.allgo.onExportProgress((p) => setExportState({ progress: p }))
    return () => {
      offDone()
      offProgress()
    }
  }, [setExportState, toast])

  if (!open) return null

  const running = exportState.jobId !== null
  const progress = exportState.progress

  const chooseOutput = async () => {
    const path = await window.allgo.saveVideoDialog(suggestedFileName())
    if (path) setOutputPath(path)
    return path
  }

  const start = async () => {
    const path = outputPath ?? (await chooseOutput())
    if (!path) return
    setOutputPath(path)
    setResult(null)
    // Autosave antes de exportar: se algo travar, o projeto está preservado.
    await window.allgo.autosave(project)
    try {
      const jobId = await window.allgo.startExport(project, path, {
        fps,
        codec,
        quality,
        width: project.width,
        height: project.height,
        // O encode continua na GPU via NVENC. Evitamos `-hwaccel auto` na
        // decodificação porque este filter_complex mistura frames de vídeo,
        // escala, xfade e overlays em filtros software; nesse caminho o
        // driver pode travar antes de o primeiro frame chegar ao encoder.
        hwaccel: false
      })
      setExportState({ jobId, outputPath: path, progress: null })
    } catch (err) {
      toast(`Não foi possível iniciar o export: ${(err as Error).message}`, 'error')
    }
  }

  const cancel = () => {
    if (exportState.jobId) void window.allgo.cancelExport(exportState.jobId)
  }

  const close = () => {
    if (running) return
    setOpen(false)
  }

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <span>Exportar vídeo</span>
          <button className="icon-btn" onClick={close} disabled={running}>
            <X size={16} />
          </button>
        </header>

        <div className="content">
          {result && !running && (
            <div className={`summary`} style={{ borderColor: result.ok ? 'var(--accent)' : result.canceled ? 'var(--border)' : 'var(--danger)' }}>
              <div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {result.ok ? <CheckCircle2 size={14} color="var(--accent-hover)" /> : <AlertTriangle size={14} color="var(--danger)" />}
                  {result.ok ? 'Export concluído' : result.canceled ? 'Export cancelado' : 'Falha no export'}
                </span>
                {result.ok && (
                  <button className="btn" onClick={() => void window.allgo.showInFolder(result.outputPath)}>
                    <FolderOpen size={13} /> Abrir pasta
                  </button>
                )}
              </div>
              {!result.ok && !result.canceled && (
                <>
                  <span style={{ color: 'var(--danger)' }}>{result.error}</span>
                  <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowLog((v) => !v)}>
                    {showLog ? 'Ocultar detalhes' : 'Ver detalhes'}
                  </button>
                  {showLog && <pre className="error-log">{result.log.slice(-6000)}</pre>}
                </>
              )}
            </div>
          )}

          <label className="field">
            <span>Arquivo de saída</span>
            <div className="field-row">
              <input type="text" readOnly value={outputPath ?? ''} placeholder="Escolha onde salvar…" />
              <button className="btn" style={{ flex: '0 0 auto' }} disabled={running} onClick={chooseOutput}>
                Escolher…
              </button>
            </div>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Codec</span>
              <select value={codec} disabled={running} onChange={(e) => setCodec(e.target.value as EncoderName)}>
                {available.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Qualidade</span>
              <select value={quality} disabled={running} onChange={(e) => setQuality(e.target.value as ExportQuality)}>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Resolução</span>
              <input type="text" readOnly value={`${project.width}×${project.height}`} />
            </label>
            <label className="field">
              <span>FPS</span>
              <select value={fps} disabled={running} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={Math.round(project.fps) || 30}>Automático ({Math.round(project.fps) || 30})</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
          </div>

          <div className="summary">
            <div>
              <span>Duração</span>
              <b>{formatTime(layout.duration)}</b>
            </div>
            <div>
              <span>Clipes / placas</span>
              <b>
                {project.videoTrack.length} / {project.overlayTracks.reduce((n, t) => n + t.length, 0)}
              </b>
            </div>
            <div>
              <span>Tamanho estimado</span>
              <b>≈ {formatBytes(estimateSize(layout.duration, quality, codec, fps))}</b>
            </div>
          </div>

          {!encoders?.hevc_nvenc && !encoders?.h264_nvenc && (
            <p className="hint" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              Nenhum encoder NVIDIA detectado — o export vai usar a CPU (libx264), o que é bem mais lento.
            </p>
          )}

          {running && (
            <div className="field">
              <span>
                Exportando — {Math.round((progress?.progress ?? 0) * 100)}%
                {progress?.etaSeconds ? ` · ${formatTime(progress.etaSeconds)} restantes` : ''}
                {progress?.speed ? ` · ${progress.speed.toFixed(1)}×` : ''}
              </span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(progress?.progress ?? 0) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <footer>
          {running ? (
            <button className="btn danger" onClick={cancel}>
              Cancelar export
            </button>
          ) : (
            <>
              <button className="btn" onClick={close}>
                Fechar
              </button>
              <button className="btn primary" onClick={start} disabled={!project.videoTrack.length}>
                Exportar
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
