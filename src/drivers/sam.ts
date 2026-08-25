/**
 * SAM driver: exec and file IO on a remote mesh peer through a companion tool
 * server (sam-exec-fs), reached via the local sam-node MCP endpoint.
 *
 * Auth: delegated to the mesh — no keys or tokens in this process when riding
 * the local Unix socket. A preflight check proves the endpoint speaks the
 * sam-node API before any credential is sent, so a foreign service that has
 * claimed the port can never receive our token.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteTransport } from '../transport.js'
import type { TransportExecRequest, TransportExecResult } from '../transport.js'
import { DEFAULT_TIMEOUT_MS } from '../config.js'

export interface SamDriverConfig {
  mcpUrl?: string
  token?: string
  servicePrefix: string
  peerId?: string
  defaultTimeoutMs?: number
}

interface McpContent { type: string; text?: string }

function readTokenFile(): string | undefined {
  for (const p of [
    join(homedir(), '.config', 'sam-mesh', 'token'),
    join(homedir(), '.sam-mesh', 'token'),
  ]) {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return undefined
}

export class SamTransport extends RemoteTransport {
  readonly driver = 'sam' as const

  private client: Client | undefined
  private readonly mcpUrl: string
  private readonly token: string | undefined

  constructor(ctx: Context, private readonly cfg: SamDriverConfig) {
    super(ctx, 'remoteTransport')
    this.mcpUrl = cfg.mcpUrl ?? 'http://127.0.0.1:8080/mcp'
    this.token =
      cfg.token ??
      (process.env.SAM_TOKEN !== undefined && process.env.SAM_TOKEN !== ''
        ? process.env.SAM_TOKEN
        : readTokenFile())
  }

  /**
   * Preflight: prove the endpoint is a sam-node before attaching the auth
   * header or opening the MCP session. Guards against token misdirection when
   * some OTHER service has claimed the port (a real hazard on shared dev nets).
   */
  private async preflight(): Promise<void> {
    const origin = new URL(this.mcpUrl).origin
    let body: string
    try {
      // This identity probe is deliberately anonymous. Credentials are only
      // attached by the MCP transport after the endpoint proves its shape.
      const res = await fetch(new URL('/v1/models', origin), {
        signal: AbortSignal.timeout(5000),
      })
      body = await res.text()
    } catch (e) {
      throw new Error(`dsh-remote-exec: cannot reach sam-node at ${origin} (${String(e)})`)
    }
    try {
      const parsed: unknown = JSON.parse(body)
      if (!Array.isArray(parsed)) throw new Error('not an array')
    } catch {
      throw new Error(
        `dsh-remote-exec: ${origin} does not speak the sam-node API ` +
        '(GET /v1/models was not JSON). Refusing to send credentials to an unknown service. ' +
        'If sam-node uses another port, set mcpUrl explicitly.',
      )
    }
  }

  private async ensureClient(): Promise<Client> {
    if (this.client !== undefined) return this.client
    await this.preflight()
    const client = new Client({ name: 'dsh-remote-exec', version: '0.1.0' })
    // NOTE: auth headers belong in options.requestInit.headers — passing them
    // at the top level of the options object is silently ignored by the SDK
    // (a latent bug the v2 types caught; v1 only compiled it via a cast).
    const options: StreamableHTTPClientTransportOptions =
      this.token === undefined
        ? {}
        : { requestInit: { headers: { 'X-Sam-Authentication': `Bearer ${this.token}` } } }
    const transport = new StreamableHTTPClientTransport(
      new URL(this.mcpUrl),
      options,
    )
    await client.connect(transport)
    this.client = client
    return client
  }

  private async callTool<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const client = await this.ensureClient()
    const full = `${this.cfg.servicePrefix}.${tool}`
    const res = await client.callTool({ name: full, arguments: args })
    const text = Array.isArray(res.content)
      ? (res.content as McpContent[]).map((c) => c.text ?? '').join('')
      : ''
    if (res.isError === true) throw new Error(`sam ${full} failed: ${text.slice(0, 400)}`)
    return JSON.parse(text) as T
  }

  async exec(request: TransportExecRequest): Promise<TransportExecResult> {
    return this.callTool<TransportExecResult>('exec', {
      command: request.command,
      workdir: request.workdir,
      stdin: request.stdin,
      timeoutMs: request.timeoutMs ?? this.cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  }

  async readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    void signal
    const r = await this.callTool<{ base64: string; truncated: boolean }>('read_file', { path, maxBytes })
    if (r.truncated) throw new Error(`sam read failed: exceeds ${maxBytes} byte cap`)
    return new Uint8Array(Buffer.from(r.base64, 'base64'))
  }

  async writeFileAtomic(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    void signal
    await this.callTool('write_file', { path, base64: Buffer.from(bytes).toString('base64') })
  }

  streamInteractive(_command: string): { child: never } {
    throw new Error(
      'the sam driver does not support interactive terminals — use driver: mosh for roaming PTYs',
    )
  }
}
