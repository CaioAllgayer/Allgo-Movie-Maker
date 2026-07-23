import { Clapperboard, FolderOpen, Redo2, Save, Undo2, Upload } from 'lucide-react'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'

export function TopBar({
  onOpen,
  onSave,
  onExport
}: {
  onOpen: () => void
  onSave: () => void
  onExport: () => void
}) {
  const name = useProject((s) => s.project.name)
  const dirty = useProject((s) => s.dirty)
  const hasClips = useProject((s) => s.project.videoTrack.length > 0)
  const past = useProject((s) => s.past.length)
  const future = useProject((s) => s.future.length)
  const undo = useProject((s) => s.undo)
  const redo = useProject((s) => s.redo)
  const exporting = useUi((s) => s.exportState.jobId !== null)

  return (
    <header className="topbar">
      <div className="logo">
        <span className="mark">
          <Clapperboard size={15} />
        </span>
        Allgo Movie Maker
      </div>
      <span className="project-name">{name}</span>
      {dirty && <span className="dot-dirty" title="Alterações não salvas" />}

      <div className="spacer" />

      <button className="icon-btn" title="Desfazer (Ctrl+Z)" disabled={!past || exporting} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" title="Refazer (Ctrl+Y)" disabled={!future || exporting} onClick={redo}>
        <Redo2 size={16} />
      </button>

      <button className="btn" onClick={onOpen} disabled={exporting}>
        <FolderOpen size={14} /> Abrir
      </button>
      <button className="btn" onClick={onSave} disabled={exporting}>
        <Save size={14} /> Salvar
      </button>
      <button className="btn primary" onClick={onExport} disabled={!hasClips || exporting}>
        <Upload size={14} /> Exportar
      </button>
    </header>
  )
}
