import { Badge } from "@/components/ui/badge"
import type { PublicConfig } from "@/app/api/config/flags"
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-section"

/**
 * Which AI writes feedback, chat answers, decks and guides on this server,
 * said plainly. Setup details show only in development.
 */
export function AiSection({ config, dev }: { config: PublicConfig; dev: boolean }) {
  let badge: React.ReactNode
  let text: string
  let devNote: React.ReactNode = null

  if (config.ai_disabled) {
    badge = <Badge variant="warning">Paused</Badge>
    text = "AI features are paused. Existing decks and guides still work."
    if (dev) devNote = <>AI_DISABLED is set to true on this server.</>
  } else if (config.ai_mock) {
    badge = <Badge variant="warning">Sample responses</Badge>
    text =
      "This server answers with sample AI responses for testing. Feedback, chat answers, decks, and guides contain placeholder text, not text written from your materials."
    if (dev) {
      devNote = (
        <>
          To use OpenAI, set <code>AI_PROVIDER=openai</code> and <code>OPENAI_API_KEY</code> in .env,
          then restart the server.
        </>
      )
    }
  } else {
    badge = <Badge variant="success">On</Badge>
    text =
      "Feedback, chat answers, decks, and guides are written by AI from your materials and labeled AI-written. Check them against your materials."
  }

  return (
    <SettingsSection id="ai" title="AI features">
      <SettingsRows>
        <SettingsRow title="Status">
          <div className="flex flex-col gap-2">
            <div>{badge}</div>
            <p className="max-w-prose type-body-m text-on-surface">{text}</p>
            {devNote ? (
              <p className="max-w-prose type-body-s text-on-surface-variant">
                {devNote} This note shows only in development.
              </p>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  )
}
