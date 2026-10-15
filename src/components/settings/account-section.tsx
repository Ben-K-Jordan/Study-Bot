"use client"

import { useState } from "react"
import Link from "next/link"
import { KeyRoundIcon, LogOutIcon, Trash2Icon } from "lucide-react"
import { signOut } from "next-auth/react"

import { DELETE_ACCOUNT_PHRASE } from "@/app/api/account/delete/phrase"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { sendJson } from "./request"
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-section"

/** Where the sign-in page lands after a deletion; it shows "Account deleted". */
const ACCOUNT_DELETED_URL = "/auth/signin?account=deleted"

/** Sign out, reset the password by email, and delete the account. */
export function AccountSection({ email }: { email: string | null }) {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await signOut({ callbackUrl: "/auth/signin" })
  }

  async function deleteAccount() {
    await sendJson("DELETE", "/api/account/delete", { confirm: DELETE_ACCOUNT_PHRASE })
    // The session token outlives the account, so end it before anything else loads.
    // The account is gone at this point, so a sign-out failure must not read as "not deleted".
    try {
      await signOut({ callbackUrl: ACCOUNT_DELETED_URL })
    } catch {
      // A full load, so nothing from the deleted account stays in memory.
      window.location.replace(new URL(ACCOUNT_DELETED_URL, window.location.origin).href)
    }
  }

  return (
    <SettingsSection id="account" title="Account">
      <SettingsRows>
        <SettingsRow title="Sign out" description="Signs you out of Study Bot in this browser.">
          <Button type="button" variant="outline" className="self-start" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? (
              <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
            ) : (
              <LogOutIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </SettingsRow>

        <SettingsRow
          title="Password"
          description="Study Bot emails you a link to choose a new password. The link expires in 1 hour."
        >
          <Button asChild variant="outline" className="self-start">
            <Link href="/auth/forgot-password">
              <KeyRoundIcon data-icon="inline-start" aria-hidden="true" />
              Reset password
            </Link>
          </Button>
        </SettingsRow>

        <SettingsRow
          title="Delete account"
          description="Permanently deletes your account and everything in it. Export your data first if you want a copy."
        >
          {email ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive" className="self-start">
                  <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                  Delete account
                </Button>
              }
              title="Delete your account?"
              description={
                <>
                  This permanently deletes your plans, sessions, answers, materials, decks, guides,
                  and chat history, and disconnects Google Calendar. Events already in Google
                  Calendar stay there. Export your data first if you want a copy.
                </>
              }
              confirmText={email}
              confirmTextLabel="Type your email address to confirm"
              confirmLabel="Delete account"
              pendingLabel="Deleting account…"
              failedMessage="Account not deleted. Check your connection and retry."
              onConfirm={deleteAccount}
            />
          ) : (
            <p className="type-body-m text-on-surface-variant">
              Reload the page to delete your account. Your email address didn&apos;t load.
            </p>
          )}
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  )
}
