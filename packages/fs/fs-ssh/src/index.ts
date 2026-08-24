/**
 * SSH filesystem provider: implements the FileSystem seam over a
 * ctx.remoteTransport, so the agent's file tools operate on a remote
 * execution world while dsh runs locally.
 *
 * Target identity: the remote absolute path. Freshness: `size:mtime` from
 * remote stat. Writes are atomic (temp + rename) and guarded per the write
 * intent contract.
 * @module @deepseek-ai/dsh-fs-ssh
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  FileSystem,
  FsError,
  FsTargetKey,
  FsVersion,
} from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsVersion as FsVersionT,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { shellQuote } from '@morewax/dsh-remote-transport'

export interface Config {
  /** Base directory for relative path resolution on the remote world. */
  root: string
}

const q = shellQuote

export class SshFileSystem extends FileSystem {
  declare readonly ctx: Context

  constructor(ctx: Context, private readonly cfg: Config) {
    super(ctx)
    void this.cfg
  }

  private async run(command: string): Promise<{ code: number | null; out: string; err: string }> {
    const r = await this.ctx.remoteTransport.exec({ command })
    return { code: r.exitCode, out: r.stdout, err: r.stderr }
  }

  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const base = opts?.cwd ?? this.cfg.root
    const r = await this.run(`p=${q(path)}; b=${q(base)}; case $p in /*) echo "$p";; *) echo "$b/$p";; esac`)
    if (r.code !== 0) throw new FsError(`resolve failed: ${r.err}`, 'FS_IO_ERROR')
    const abs = r.out.trim()
    return { targetKey: FsTargetKey(abs), displayPath: abs }
  }

  processPath(target: FsTarget): string { return target.displayPath }
  fileUrl(target: FsTarget): string { return `ssh-file://${target.displayPath}` }
  contains(parent: FsTarget, child: FsTarget): boolean {
    return child.displayPath === parent.displayPath ||
      child.displayPath.startsWith(parent.displayPath.replace(/\/$/, '') + '/')
  }

  private async statRaw(abs: string): Promise<{ size: string; mtime: string; type: string } | undefined> {
    const fmt = '%s %Y %f'
    const r = await this.run(`stat -L -c ${q(fmt)} -- ${q(abs)} 2>/dev/null || echo MISSING`)
    const line = r.out.trim()
    if (line === 'MISSING' || line === '') return undefined
    const [size = '', mtime = '', hex = ''] = line.split(' ')
    const mode = parseInt(hex, 16)
    const type = (mode & 0o170000) === 0o040000 ? 'directory'
      : (mode & 0o170000) === 0o100000 ? 'file' : 'other'
    return { size, mtime, type }
  }

  async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const s = await this.statRaw(target.displayPath)
    if (!s) return undefined
    return {
      version: FsVersion(`${s.size}:${s.mtime}`),
      type: s.type as FsInfo['type'],
      size: Number(s.size),
    }
  }

  async lstat(path: string, opts?: { cwd?: string }): Promise<FsPathInfo | undefined> {
    const t = await this.resolve(path, opts)
    // -c without -L: do not follow the final component.
    const r = await this.run(`stat -c ${q('%s %Y %f')} -- ${q(t.displayPath)} 2>/dev/null || echo MISSING`)
    const line = r.out.trim()
    if (line === 'MISSING' || line === '') return undefined
    const [size = '', mtime = '', hex = ''] = line.split(' ')
    const mode = parseInt(hex, 16)
    const kind = (mode & 0o170000) === 0o040000 ? 'directory'
      : (mode & 0o170000) === 0o100000 ? 'file'
        : (mode & 0o170000) === 0o120000 ? 'symlink' : 'other'
    return { version: FsVersion(`${size}:${mtime}`), type: kind, size: Number(size) }
  }

  async readText(target: FsTarget): Promise<string> {
    const bytes = await this.readBytesImpl(target.displayPath, Number.MAX_SAFE_INTEGER)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.replaceAll('\r\n', '\n')
  }

  async streamText(target: FsTarget): Promise<AsyncIterable<string>> {
    async function* one(text: string): AsyncIterable<string> {
      await Promise.resolve()
      yield text
    }
    return one(await this.readText(target))
  }

  async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.readBytesImpl(target.displayPath, maxBytes)
  }

  private async readBytesImpl(abs: string, maxBytes: number): Promise<Uint8Array> {
    const bytes = await this.ctx.remoteTransport.readFile(abs, maxBytes + 1)
    if (bytes.length > maxBytes) throw new FsError(`exceeds ${maxBytes} byte read cap`, 'FS_IO_ERROR')
    return bytes
  }

  async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const dir = target.displayPath
    const r = await this.run(
      `cd ${q(dir)} && for e in * .[!.]* ..?*; do ` +
      '[ -e "$e" ] || continue; ' +
      'printf \'%s\\t%s\\n\' "$e" "$(stat -L -c %F -- "$e")"; done',
    )
    if (r.code !== 0) throw new FsError(`listDir failed: ${r.err.slice(0, 200)}`, 'FS_NOT_DIRECTORY')
    const entries: FsDirEntry[] = []
    for (const line of r.out.split('\n')) {
      if (!line.trim()) continue
      const [name = '', kind = ''] = line.split('\t')
      const type = kind.includes('directory') ? 'directory' : kind.includes('regular') ? 'file' : 'other'
      entries.push({
        name,
        type: type,
        target: { targetKey: FsTargetKey(`${dir}/${name}`), displayPath: `${dir}/${name}` },
      })
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    _signal?: AbortSignal,
    _sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    const abs = target.displayPath
    const current = await this.statRaw(abs)
    let before: string | null = null
    if (current && current.type === 'file') {
      before = new TextDecoder().decode(await this.readBytesImpl(abs, Number.MAX_SAFE_INTEGER))
        .replaceAll('\r\n', '\n')
    }
    // intent guards
    if (expected?.kind === 'createIfAbsent' && current) throw new FsError('exists', 'FS_NOT_OBSERVED')
    if (expected?.kind === 'replaceIfVersion') {
      if (!current) throw new FsError('target vanished', 'FS_STALE_VERSION')
      const now = FsVersion(`${current.size}:${current.mtime}`)
      if (now !== expected.version) throw new FsError('version mismatch', 'FS_STALE_VERSION')
    }
    const normalized = content.replaceAll('\r\n', '\n')
    await this.ctx.remoteTransport.writeFileAtomic(abs, new TextEncoder().encode(normalized))
    const afterStat = await this.statRaw(abs)
    return {
      operation: current ? 'update' : 'create',
      version: FsVersion(afterStat ? `${afterStat.size}:${afterStat.mtime}` : 'unknown'),
      before,
      after: normalized,
    }
  }

  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersionT },
  ): Promise<FsEditOutcome> {
    const before = await this.readText(target)
    if (expected) {
      const info = await this.stat(target)
      if (!info || info.version !== expected.version) throw new FsError('stale', 'FS_STALE_VERSION')
    }
    const count = before.split(edit.oldString).length - 1
    if (count === 0) throw new FsError('oldString not found', 'FS_EDIT_NOT_FOUND')
    if (count > 1 && !edit.replaceAll) throw new FsError(`${count} matches`, 'FS_AMBIGUOUS_EDIT')
    const after = edit.replaceAll
      ? before.split(edit.oldString).join(edit.newString)
      : before.replace(edit.oldString, edit.newString)
    const outcome = await this.writeText(target, after)
    return { version: outcome.version, before, after }
  }
}

export const name = 'fs-ssh'
export const inject = ['remoteTransport'] as const

export function apply(ctx: Context, config: Config): void {
  ctx.fs = new SshFileSystem(ctx, config)
}
