/** @jsxImportSource @opentui/solid */
import type { TuiDialogSelectOption, TuiPlugin, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import {
  currentProfile,
  debugInfo,
  fetchUsage,
  listProfiles,
  remainingPercent,
  resetDate,
  saveCurrentProfile,
  switchProfile,
  type UsageResponse
} from "./shared.js"

export const id = "codexmx"

type UsageState =
  | { status: "loading"; updatedAt?: number }
  | { status: "ready"; data: UsageResponse; updatedAt: number }
  | { status: "error"; message: string; updatedAt?: number }

const refreshMs = 60_000
const barWidth = 18

function age(updatedAt?: number) {
  if (!updatedAt) return "never"
  const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function filledBar(value: number | undefined) {
  return value === undefined ? 0 : Math.round((value / 100) * barWidth)
}

function usageColor(theme: TuiThemeCurrent, value: number | undefined) {
  if (value === undefined) return theme.textMuted
  if (value >= 50) return theme.success
  if (value >= 30) return theme.warning
  return theme.error
}

function formatDebug(value: Awaited<ReturnType<typeof debugInfo>>) {
  return [
    `current: ${value.current}`,
    `profiles: ${value.profiles.length ? value.profiles.join(", ") : "none"}`,
    `live auth: ${value.liveAuthExists ? "yes" : "no"}`,
    `live account: ${value.liveAccountExists ? "yes" : "no"}`,
    `live openai.access: ${value.liveOpenAI.access ? "yes" : "no"}`,
    `live openai.refresh: ${value.liveOpenAI.refresh ? "yes" : "no"}`,
    `live openai.accountId: ${value.liveOpenAI.accountId ? "yes" : "no"}`,
    `live openai.expires: ${value.liveOpenAI.expires}`,
    `selected openai.access: ${value.selectedOpenAI.access ? "yes" : "no"}`,
    `selected openai.refresh: ${value.selectedOpenAI.refresh ? "yes" : "no"}`,
    `selected openai.accountId: ${value.selectedOpenAI.accountId ? "yes" : "no"}`,
    `selected openai.expires: ${value.selectedOpenAI.expires}`,
    `account entries: ${value.account.count}`,
    `account active.openai: ${value.account.activeOpenAI ? "yes" : "no"}`
  ].join("\n")
}

export const tui: TuiPlugin = async (api) => {
  const theme = () => api.theme.current
  const [current, setCurrent] = createSignal(await currentProfile())
  const [usage, setUsage] = createSignal<UsageState>({ status: "loading" })

  async function refreshCurrent() {
    setCurrent(await currentProfile())
  }

  async function refreshUsage() {
    try {
      setUsage({ status: "ready", data: await fetchUsage(), updatedAt: Date.now() })
    } catch (error) {
      setUsage({ status: "error", message: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  async function refreshAll() {
    await refreshCurrent()
    await refreshUsage()
  }

  void refreshAll()
  const timer = setInterval(() => void refreshAll(), refreshMs)
  api.lifecycle.onDispose(() => clearInterval(timer))

  const label = createMemo(() => `codexmx:${current()}`)

  function saveDialog() {
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Save Codex auth profile"
        placeholder="profile-name"
        onConfirm={(value) => {
          const name = value.trim()
          void saveCurrentProfile(name)
            .then(async () => {
              await refreshAll()
              api.ui.toast({ variant: "success", message: `Saved Codex profile: ${name}` })
              api.ui.dialog.clear()
            })
            .catch((error) => {
              api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
            })
        }}
        onCancel={() => api.ui.dialog.clear()}
      />
    ))
  }

  async function switchDialog() {
    const profiles = await listProfiles()
    if (!profiles.length) {
      api.ui.toast({ variant: "warning", message: "No Codex profiles found" })
      return
    }

    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="Switch Codex profile"
        placeholder="Select profile"
        current={current()}
        options={profiles.map(
          (profile): TuiDialogSelectOption<string> => ({
            title: profile,
            value: profile,
            description: profile === current() ? "current" : undefined
          })
        )}
        onSelect={(option) => {
          void switchProfile(option.value)
            .then(async () => {
              await refreshAll()
              api.ui.toast({ variant: "success", message: `Using Codex profile: ${option.value}` })
              api.ui.dialog.clear()
            })
            .catch((error) => {
              api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
            })
        }}
      />
    ))
  }

  async function showDebug() {
    try {
      const info = await debugInfo()
      api.ui.dialog.replace(() => (
        <api.ui.DialogAlert title="codexmx debug" message={formatDebug(info)} onConfirm={() => api.ui.dialog.clear()} />
      ))
    } catch (error) {
      api.ui.toast({ variant: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  const Badge = () => <text fg={theme().textMuted}>{label()}</text>

  const windows = createMemo(() => {
    const state = usage()
    if (state.status === "loading") return { status: "loading" as const }
    if (state.status === "error") return { status: "error" as const, message: state.message, updatedAt: state.updatedAt }

    const rate = state.data.rate_limit
    return {
      status: "ready" as const,
      primary: { label: "5h", remaining: remainingPercent(rate?.primary_window), reset: resetDate(rate?.primary_window) },
      secondary: { label: "weekly", remaining: remainingPercent(rate?.secondary_window), reset: resetDate(rate?.secondary_window) }
    }
  })

  const Window = (props: { label: string; remaining?: number; reset: string }) => (
    <box flexDirection="column">
      <box flexDirection="row" height={1}>
        <text fg={theme().textMuted}>{props.label.padEnd(7)}</text>
        <text fg={usageColor(theme(), props.remaining)}>{"━".repeat(filledBar(props.remaining))}</text>
        <text fg={theme().textMuted}>{"━".repeat(barWidth - filledBar(props.remaining))}</text>
        <text fg={usageColor(theme(), props.remaining)}>{` ${props.remaining === undefined ? "?" : props.remaining}%`}</text>
      </box>
      <text fg={theme().textMuted}>{`       ${props.reset}`}</text>
    </box>
  )

  const UsageWidget = () => {
    const state = windows()
    return (
      <box flexDirection="column">
        <text>{""}</text>
        <text fg={theme().text}>Codex Usage</text>
        {state.status === "loading" ? (
          <text fg={theme().textMuted}>loading...</text>
        ) : state.status === "error" ? (
          <box flexDirection="column">
            <text fg={theme().error}>{state.message}</text>
            <text fg={theme().textMuted}>{`updated ${age(state.updatedAt)}`}</text>
          </box>
        ) : (
          <box flexDirection="column">
            <Window label={state.primary.label} remaining={state.primary.remaining} reset={state.primary.reset} />
            <Window label={state.secondary.label} remaining={state.secondary.remaining} reset={state.secondary.reset} />
          </box>
        )}
      </box>
    )
  }

  const unregisterCommands = api.keymap.registerLayer({
    commands: [
      {
        name: "codexmx:save",
        title: "Save current Codex auth profile",
        category: "Codex Multiplexer",
        namespace: "palette",
        slashName: "codexmx-save",
        run() {
          saveDialog()
        }
      },
      {
        name: "codexmx:switch",
        title: "Switch Codex auth profile",
        category: "Codex Multiplexer",
        namespace: "palette",
        slashName: "codexmx-switch",
        slashAliases: ["codexmx"],
        run() {
          void switchDialog()
        }
      },
      {
        name: "codexmx:show",
        title: "Show Codex multiplexer debug info",
        category: "Codex Multiplexer",
        namespace: "palette",
        slashName: "codexmx-show",
        run() {
          void showDebug()
        }
      }
    ]
  })
  if (typeof unregisterCommands === "function") api.lifecycle.onDispose(unregisterCommands)

  api.slots.register({
    order: 50,
    slots: {
      home_prompt_right() {
        return <Badge />
      },
      session_prompt_right() {
        return <Badge />
      }
    }
  })

  api.slots.register({
    order: 1000,
    slots: {
      sidebar_content() {
        return <UsageWidget />
      }
    }
  })
}

export default { id, tui }
