import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { AutosaveInfo, Project, RecentProject } from '@shared/types'

const MAX_RECENT = 10
const MAX_AUTOSAVES = 5

function userFile(name: string): string {
  return join(app.getPath('userData'), name)
}

function autosaveDir(): string {
  const dir = join(app.getPath('userData'), 'autosave')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function readProject(path: string): Project {
  const raw = readFileSync(path, 'utf8')
  const project = JSON.parse(raw) as Project
  if (typeof project !== 'object' || project === null || !Array.isArray(project.media)) {
    throw new Error('Arquivo de projeto inválido.')
  }
  return normalize(project)
}

export function writeProject(path: string, project: Project): void {
  writeFileSync(path, JSON.stringify(project, null, 2), 'utf8')
  addRecent(path, project.name)
}

/** Preenche campos ausentes de projetos salvos por versões anteriores. */
function normalize(project: Project): Project {
  return {
    ...project,
    fps: project.fps || 30,
    width: project.width || 1920,
    height: project.height || 1080,
    adjust: {
      brightness: project.adjust?.brightness ?? 0,
      contrast: project.adjust?.contrast ?? 0,
      saturation: project.adjust?.saturation ?? 0
    },
    media: project.media ?? [],
    videoTrack: project.videoTrack ?? [],
    overlayTracks: project.overlayTracks ?? [],
    musicTrack: project.musicTrack ?? []
  }
}

/* ------------------------------------------------------------------ */
/* Autosave                                                            */
/* ------------------------------------------------------------------ */

export function autosave(project: Project): void {
  const dir = autosaveDir()
  const file = join(dir, `autosave-${Date.now()}.allgo`)
  writeFileSync(file, JSON.stringify(project), 'utf8')

  // Mantém só os N mais recentes.
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.allgo'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const old of files.slice(MAX_AUTOSAVES)) {
    try {
      rmSync(old, { force: true })
    } catch {
      /* ignora */
    }
  }
}

export function latestAutosave(): AutosaveInfo | null {
  const dir = autosaveDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.allgo'))
  if (!files.length) return null
  const full = files
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  try {
    const project = JSON.parse(readFileSync(full, 'utf8')) as Project
    // Autosave de projeto vazio não vale oferecer restauração.
    if (!project.videoTrack?.length && !project.media?.length) return null
    return { path: full, name: project.name || 'Projeto sem nome', savedAt: statSync(full).mtimeMs }
  } catch {
    return null
  }
}

export function readAutosave(path: string): Project {
  return normalize(JSON.parse(readFileSync(path, 'utf8')) as Project)
}

export function clearAutosave(): void {
  const dir = autosaveDir()
  for (const f of readdirSync(dir)) {
    try {
      rmSync(join(dir, f), { force: true })
    } catch {
      /* ignora */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projetos recentes                                                   */
/* ------------------------------------------------------------------ */

export function recentProjects(): RecentProject[] {
  const file = userFile('recent.json')
  if (!existsSync(file)) return []
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as RecentProject[]
    return list.filter((r) => existsSync(r.path))
  } catch {
    return []
  }
}

export function addRecent(path: string, name?: string): void {
  const list = recentProjects().filter((r) => r.path !== path)
  list.unshift({ path, name: name || basename(path, '.allgo'), openedAt: Date.now() })
  try {
    writeFileSync(userFile('recent.json'), JSON.stringify(list.slice(0, MAX_RECENT), null, 2), 'utf8')
  } catch {
    /* lista de recentes é conveniência, não bloqueia nada */
  }
}

export function pathsExist(paths: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of paths) out[p] = existsSync(p)
  return out
}

export function writePng(path: string, dataUrl: string): void {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  writeFileSync(path, Buffer.from(base64, 'base64'))
}
