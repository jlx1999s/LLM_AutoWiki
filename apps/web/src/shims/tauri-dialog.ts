interface OpenOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
}

export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  const hint = options.directory
    ? "请输入目录绝对路径"
    : "请输入文件绝对路径"
  const multiHint = options.multiple ? "（多个路径请用逗号分隔）" : ""
  const raw = window.prompt(`${options.title ?? "Select Path"}\n${hint}${multiHint}`)
  if (!raw) return null

  const paths = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
  if (paths.length === 0) return null
  return options.multiple ? paths : paths[0]
}

