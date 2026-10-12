import {
  BookOpenTextIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  GraduationCapIcon,
  HouseIcon,
  LayersIcon,
  MessagesSquareIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  /** Route the destination opens. */
  href: string
  /** Short label under the icon in the rail and the bottom bar. */
  label: string
  /** Page title for the top app bar and the browser tab. */
  title: string
  icon: LucideIcon
  /** Shown in the compact bottom bar; the rest live in the More sheet. */
  primary: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", title: "Home", icon: HouseIcon, primary: true },
  { href: "/plan", label: "Plan", title: "Plan", icon: CalendarDaysIcon, primary: true },
  { href: "/learn", label: "Study", title: "Study", icon: GraduationCapIcon, primary: true },
  { href: "/flashcards", label: "Cards", title: "Flashcards", icon: LayersIcon, primary: true },
  { href: "/guides", label: "Guides", title: "Study guides", icon: BookOpenTextIcon, primary: false },
  { href: "/chat", label: "Chat", title: "Chat", icon: MessagesSquareIcon, primary: false },
  { href: "/achievements", label: "Progress", title: "Progress", icon: ChartColumnIcon, primary: false },
]

export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  title: "Settings",
  icon: SettingsIcon,
  primary: false,
}

/** True when `pathname` is the destination or a page below it. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The destination that owns `pathname`, if any. */
export function navItemFor(pathname: string): NavItem | undefined {
  return [...NAV_ITEMS, SETTINGS_ITEM].find((item) => isActivePath(pathname, item.href))
}
