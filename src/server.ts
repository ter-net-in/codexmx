import type { Plugin } from "@opencode-ai/plugin"
import { accessToken, currentProfile } from "./shared.js"

export const id = "codexmx-server"

function codexLike(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? ""
  return normalized === "openai" || normalized === "codex" || normalized.includes("openai") || normalized.includes("codex")
}

export const server: Plugin = async () => {
  return {
    "chat.headers": async (input, output) => {
      if (
        !codexLike(input.provider?.info?.id) &&
        !codexLike(input.provider?.info?.name) &&
        !codexLike(input.model?.providerID) &&
        !codexLike(input.model?.id) &&
        !codexLike(input.model?.api?.id) &&
        !codexLike(input.model?.api?.url)
      ) {
        return
      }

      const token = await accessToken()
      output.headers.Authorization = `Bearer ${token}`
      output.headers.authorization = `Bearer ${token}`
      output.headers["x-codexmx-profile"] = await currentProfile()
    }
  }
}

export default { id, server }
