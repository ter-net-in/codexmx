import { chmod, copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const usageUrl = "https://chatgpt.com/backend-api/wham/usage"

export type OpenAIAuth = {
  type?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
  enterpriseUrl?: string
}

export type AuthFile = {
  openai?: OpenAIAuth
  [key: string]: unknown
}

export type AccountFile = {
  version?: number
  accounts?: Record<
    string,
    {
      id?: string
      serviceID?: string
      description?: string
      credential?: OpenAIAuth
    }
  >
  active?: Record<string, string>
  [key: string]: unknown
}

export type LimitWindow = {
  used_percent?: number
  reset_after_seconds?: number
  reset_at?: number
}

export type UsageResponse = {
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: LimitWindow
    secondary_window?: LimitWindow
  }
  credits?: {
    has_credits?: boolean
    unlimited?: boolean
    approx_local_messages?: [number, number]
    approx_cloud_messages?: [number, number]
  }
  rate_limit_reset_credits?: {
    available_count?: number
  }
}

export function dataDir() {
  return process.env.OPENCODE_DATA_DIR ?? join(homedir(), ".local/share/opencode")
}

export function paths() {
  const root = dataDir()
  const plugin = join(root, "codexmx")
  const profiles = join(plugin, "profiles")
  return {
    root,
    plugin,
    profiles,
    liveAuth: join(root, "auth.json"),
    liveAccount: join(root, "account.json"),
    current: join(plugin, ".current")
  }
}

export function validProfile(name: string) {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".") && !name.includes("..")
}

export function profileAuthPath(name: string) {
  return join(paths().profiles, `${name}.auth.json`)
}

export function profileAccountPath(name: string) {
  return join(paths().profiles, `${name}.account.json`)
}

export async function ensureStorage() {
  await mkdir(paths().profiles, { recursive: true })
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T
}

export async function readAuth(file = paths().liveAuth) {
  return readJson<AuthFile>(file)
}

export async function readAccount(file = paths().liveAccount) {
  return readJson<AccountFile>(file)
}

export async function currentProfile() {
  try {
    return (await readFile(paths().current, "utf8")).trim() || "unknown"
  } catch {
    return "unknown"
  }
}

export async function setCurrentProfile(name: string) {
  await ensureStorage()
  await writeFile(paths().current, `${name}\n`, { mode: 0o600 })
  await chmod(paths().current, 0o600)
}

export async function listProfiles() {
  await ensureStorage()
  const names = new Set<string>()
  for (const file of await readdir(paths().profiles)) {
    if (file.endsWith(".auth.json")) names.add(file.slice(0, -".auth.json".length))
    else if (file.endsWith(".json") && !file.endsWith(".account.json")) names.add(file.slice(0, -".json".length))
  }
  return [...names].filter(validProfile).sort((a, b) => a.localeCompare(b))
}

export function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
}

async function copyPrivate(src: string, dest: string) {
  const tmp = `${dest}.tmp.${process.pid}`
  await copyFile(src, tmp)
  await chmod(tmp, 0o600)
  await rename(tmp, dest)
  await chmod(dest, 0o600)
}

export async function saveCurrentProfile(name: string) {
  if (!validProfile(name)) throw new Error(`Bad profile name: ${name}`)
  await ensureStorage()
  await stat(paths().liveAuth)
  await copyPrivate(paths().liveAuth, profileAuthPath(name))
  if (existsSync(paths().liveAccount)) await copyPrivate(paths().liveAccount, profileAccountPath(name))
  await setCurrentProfile(name)
}

export async function switchProfile(name: string) {
  if (!validProfile(name)) throw new Error(`Bad profile name: ${name}`)
  const auth = profileAuthPath(name)
  const account = profileAccountPath(name)
  if (!existsSync(auth)) throw new Error(`Missing auth profile: ${name}`)

  if (existsSync(paths().liveAuth)) await copyPrivate(paths().liveAuth, `${paths().liveAuth}.backup.${stamp()}`)
  await copyPrivate(auth, paths().liveAuth)

  if (existsSync(account)) {
    if (existsSync(paths().liveAccount)) await copyPrivate(paths().liveAccount, `${paths().liveAccount}.backup.${stamp()}`)
    await copyPrivate(account, paths().liveAccount)
  }

  await setCurrentProfile(name)
}

export async function selectedAuth() {
  const current = await currentProfile()
  if (current !== "unknown" && existsSync(profileAuthPath(current))) return readAuth(profileAuthPath(current))
  return readAuth(paths().liveAuth)
}

export async function accessToken() {
  const auth = await selectedAuth()
  const token = auth.openai?.access
  if (!token) throw new Error("Missing openai.access")
  return token
}

export async function fetchUsage() {
  const token = await accessToken()
  const signal = AbortSignal.timeout(5_000)
  const response = await fetch(usageUrl, {
    headers: { authorization: `Bearer ${token}` },
    signal
  })

  if (!response.ok) throw new Error(`Usage API ${response.status}`)
  return (await response.json()) as UsageResponse
}

export function remainingPercent(window?: LimitWindow) {
  const used = window?.used_percent
  if (typeof used !== "number" || !Number.isFinite(used)) return undefined
  return Math.max(0, Math.min(100, Math.round(100 - used)))
}

export function resetDate(window?: LimitWindow) {
  const resetAt = window?.reset_at
  const resetAfter = window?.reset_after_seconds
  let date: Date | undefined

  if (typeof resetAt === "number" && Number.isFinite(resetAt)) {
    date = new Date(resetAt < 1_000_000_000_000 ? resetAt * 1000 : resetAt)
  } else if (typeof resetAfter === "number" && Number.isFinite(resetAfter)) {
    date = new Date(Date.now() + resetAfter * 1000)
  }

  if (!date) return "reset ?"
  return `reset ${date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`
}

export async function debugInfo() {
  const profiles = await listProfiles()
  const current = await currentProfile()
  const liveAuthExists = existsSync(paths().liveAuth)
  const liveAccountExists = existsSync(paths().liveAccount)
  const auth = liveAuthExists ? await readAuth().catch(() => undefined) : undefined
  const account = liveAccountExists ? await readAccount().catch(() => undefined) : undefined
  const selected = await selectedAuth().catch(() => undefined)

  return {
    current,
    profiles,
    liveAuthExists,
    liveAccountExists,
    liveOpenAI: {
      access: Boolean(auth?.openai?.access),
      refresh: Boolean(auth?.openai?.refresh),
      accountId: Boolean(auth?.openai?.accountId),
      expires: auth?.openai?.expires ? new Date(auth.openai.expires).toLocaleString() : "unknown"
    },
    selectedOpenAI: {
      access: Boolean(selected?.openai?.access),
      refresh: Boolean(selected?.openai?.refresh),
      accountId: Boolean(selected?.openai?.accountId),
      expires: selected?.openai?.expires ? new Date(selected.openai.expires).toLocaleString() : "unknown"
    },
    account: {
      version: account?.version ?? "unknown",
      count: account?.accounts ? Object.keys(account.accounts).length : 0,
      activeOpenAI: Boolean(account?.active?.openai)
    }
  }
}
