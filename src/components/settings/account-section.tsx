"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { KeyRoundIcon, LogOutIcon } from "lucide-react"
import { signOut } from "next-auth/react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account"
import { DeleteAccountDialog } from "./delete-account-dialog"
import { sendJson } from "./request"
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-section"

/** Where the sign-in page lands after a deletion; it shows "Account deleted". */
const ACCOUNT_DELETED_URL = "/auth/signin?account=deleted"

const NOT_SIGNED_OUT = "Not signed out. Check your connection and retry."

/**
 * Sign out, reset the password by email, and delete the account.
 * `emailConfigured` is false when reset emails only reach the server log;
 * developers get a note saying so.
 */
export function AccountSection({ emailConfigured, dev }: { emailConfigured: boolean; dev: boolean }) {
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const signOutRef = useRef<HTMLButtonElement>(null)

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    try {
      await signOut({ callbackUrl: "/auth/signin" })
    } catch {
      // next-auth rejects when the sign-out request fails (offline, an error
      // page instead of JSON). The session is still live, so say so.
      setSigningOut(false)
      setSignOutError(NOT_SIGNED_OUT)
      // The button was disabled while it worked, which dropped focus; return it.
      requestAnimationFrame(() => signOutRef.current?.focus())
    }
  }

  async function deleteAccount(password: string) {
    await sendJson("DELETE", "/api/account/delete", { confirm: DELETE_ACCOUNT_PHRASE, password })
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
          <Button
            ref={signOutRef}
            type="button"
            variant="outline"
            className="self-start"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-describedby={signOutError ? "settings-sign-out-error" : undefined}
          >
            {signingOut ? (
              <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
            ) : (
              <LogOutIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
          {signOutError ? <FieldError id="settings-sign-out-error">{signOutError}</FieldError> : null}
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
          {dev && !emailConfigured ? (
            <p className="max-w-prose type-body-s text-on-surface-variant">
              <code>EMAIL_PROVIDER</code> isn&apos;t <code>smtp</code> on this server, so the reset
              link is printed in the server&apos;s terminal instead of emailed. This note shows only
              in development.
            </p>
          ) : null}
        </SettingsRow>

        <SettingsRow
          title="Delete account"
          description="Permanently deletes your account and everything in it. Export your data first if you want a copy."
        >
          <DeleteAccountDialog onDelete={deleteAccount} />
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  )
}
