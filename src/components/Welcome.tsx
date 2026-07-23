import { useEffect, useState } from 'react'
import { Clapperboard, FileVideo, FolderOpen } from 'lucide-react'
import type { RecentProject } from '@shared/types'

export function Welcome({
  onImport,
  onOpen,
  onOpenPath
}: {
  onImport: () => void
  onOpen: () => void
  onOpenPath: (path: string) => void
}) {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [over, setOver] = useState(false)

  useEffect(() => {
    window.allgo.recentProjects().then(setRecent).catch(() => setRecent([]))
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-card">
        <span className="welcome-mark">
          <Clapperboard size={28} />
        </span>
        <h1>Allgo Movie Maker</h1>
        <p>Corte, junte com desvanecimento, coloque placas e exporte em 1080p.</p>

        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={onImport}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setOver(true)
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <FileVideo size={26} strokeWidth={1.3} />
          <div style={{ marginTop: 10 }}>
            <b>Arraste seus vídeos aqui</b>
            <br />
            ou clique para escolher arquivos
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={onOpen}>
            <FolderOpen size={14} /> Abrir projeto existente
          </button>
        </div>

        {recent.length > 0 && (
          <div className="recent-list">
            <h5>Projetos recentes</h5>
            {recent.slice(0, 5).map((item) => (
              <button key={item.path} className="recent-item" onClick={() => onOpenPath(item.path)}>
                <FolderOpen size={14} color="var(--text-dim)" />
                <span>{item.name}</span>
                <span className="path" style={{ marginLeft: 'auto' }}>
                  {item.path}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
