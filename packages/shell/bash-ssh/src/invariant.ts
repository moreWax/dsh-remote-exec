/** Package-owned invariant companion. @module @morewax/dsh-bash-ssh/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@morewax/dsh-bash-ssh'
export const name = 'bash-ssh-invariant'
export const inject = ['invariants']

/** Contracts live at the ctx.shell seam; no independent event sequence. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
