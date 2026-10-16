"use client"

import Link from "next/link"
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react"
import { signOut } from "next-auth/react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function initialOf(name: string | null | undefined, email: string | null | undefined) {
  const source = (name || email || "").trim()
  return source ? source[0].toUpperCase() : null
}

/** The signed-in student as the account menu shows them. */
export interface Account {
  name: string | null
  email: string | null
}

/**
 * The signed-in student's avatar in the top app bar. Opens a menu with
 * their name and email, Settings, and Sign out. The (app) layout reads
 * `account` from the session on the server, so the avatar is in the first
 * HTML and no session request runs in the browser.
 */
export function AccountMenu({ account }: { account: Account }) {
  const { name, email } = account
  const initial = initialOf(name, email)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open account menu">
              <Avatar>
                <AvatarFallback>
                  {initial ?? <UserIcon className="size-[18px]" aria-hidden="true" />}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{name || email ? `Account: ${name ?? email}` : "Account"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        {name || email ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-3">
              {name ? <span className="type-title-s text-on-surface">{name}</span> : null}
              {email ? <span className="truncate type-body-s text-on-surface-variant">{email}</span> : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        ) : null}
        {name || email ? <DropdownMenuSeparator /> : null}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <SettingsIcon aria-hidden="true" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: "/auth/signin" })}>
            <LogOutIcon aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
