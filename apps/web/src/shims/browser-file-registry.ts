const REGISTRY = new Map<string, File>()

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function makeVirtualFilePath(id: string, name: string): string {
  const safeName = name.replace(/\//g, "_")
  return `browser-file://${id}/${safeName}`
}

export function isVirtualFilePath(path: string): boolean {
  return path.startsWith("browser-file://")
}

export function getVirtualFile(path: string): File | null {
  const withoutPrefix = path.replace("browser-file://", "")
  const slashIdx = withoutPrefix.indexOf("/")
  const id = slashIdx >= 0 ? withoutPrefix.slice(0, slashIdx) : withoutPrefix
  return REGISTRY.get(id) ?? null
}

export function registerPickedFiles(files: File[]): string[] {
  const virtualPaths: string[] = []
  for (const file of files) {
    const id = randomId()
    REGISTRY.set(id, file)
    virtualPaths.push(makeVirtualFilePath(id, file.name))
  }
  return virtualPaths
}

