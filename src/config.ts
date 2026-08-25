import type { Config } from './index.js'
import type { SshDriverConfig } from './drivers/ssh.js'

export const DEFAULT_TIMEOUT_MS = 120000

export function requireValue(value: string | undefined, driver: string): string {
  if (value === undefined) throw new Error(`driver ${driver} requires config.host`)
  return value
}

export function sshConfig(config: Config): SshDriverConfig {
  const driver = config.driver ?? 'ssh'
  const host = requireValue(config.host, driver)
  return {
    host,
    ...(config.user !== undefined && config.user !== '' ? { user: config.user } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
    ...(config.sshArgs !== undefined ? { sshArgs: [...config.sshArgs] } : {}),
    ...(config.tailscale !== undefined ? { tailscale: config.tailscale } : {}),
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  }
}
