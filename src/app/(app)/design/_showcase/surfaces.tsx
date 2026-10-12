"use client"

import * as React from "react"
import {
  CalendarDaysIcon,
  ChevronsUpDownIcon,
  CircleCheckIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/app/confirm-dialog"

import { Block, ShowcaseSection } from "./helpers"

const SESSIONS = [
  { day: "Mon, Oct 12", time: "2:00 – 2:30 PM", mode: "Retrieval", topic: "Recursion" },
  { day: "Wed, Oct 14", time: "9:00 – 9:30 AM", mode: "Interleaved practice", topic: "Stacks, queues, and lists" },
  { day: "Thu, Oct 15", time: "4:30 – 5:00 PM", mode: "Error repair", topic: "Big-O" },
]

export function Navigation() {
  return (
    <ShowcaseSection id="navigation" title="Navigation" description="M3 tabs: primary tabs with a 3px indicator, secondary tabs with a full-width line.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Tabs">
          <div className="flex flex-col gap-6">
            <Tabs defaultValue="concepts">
              <TabsList aria-label="Guide sections">
                <TabsTrigger value="concepts">Key concepts</TabsTrigger>
                <TabsTrigger value="faq">FAQ</TabsTrigger>
                <TabsTrigger value="cheat">Cheat sheet</TabsTrigger>
                <TabsTrigger value="off" disabled>
                  Archived
                </TabsTrigger>
              </TabsList>
              <TabsContent value="concepts" className="pt-3 type-body-m text-on-surface-variant">
                Recursion, base cases and the call stack.
              </TabsContent>
              <TabsContent value="faq" className="pt-3 type-body-m text-on-surface-variant">
                Questions students ask about this topic.
              </TabsContent>
              <TabsContent value="cheat" className="pt-3 type-body-m text-on-surface-variant">
                One page to review before the exam.
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="week">
              <TabsList variant="line" aria-label="Plan range">
                <TabsTrigger value="week">This week</TabsTrigger>
                <TabsTrigger value="all">All sessions</TabsTrigger>
              </TabsList>
              <TabsContent value="week" className="pt-3 type-body-m text-on-surface-variant">
                3 sessions this week.
              </TabsContent>
              <TabsContent value="all" className="pt-3 type-body-m text-on-surface-variant">
                14 sessions until Prelim 1.
              </TabsContent>
            </Tabs>
          </div>
        </Block>
        <Block title="Breadcrumb">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#navigation">Guides</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#navigation">CS 2110</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Linked lists</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Block>
      </div>
    </ShowcaseSection>
  )
}

export function DataDisplay() {
  const [open, setOpen] = React.useState(false)
  return (
    <ShowcaseSection id="data" title="Data display" description="Cards are white on the page in light and darker panels in dark, with a hairline. No nested cards.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>Retrieval on Recursion, 2:00 – 2:30 PM</CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="More actions for this session">
                <MoreVerticalIcon aria-hidden="true" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="type-body-m text-on-surface-variant">
            10 questions from Lecture 5 and Lecture 6. 2 are repair questions for errors you logged last week.
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="text">Reschedule</Button>
            <Button>Start session</Button>
          </CardFooter>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Small card</CardTitle>
            <CardDescription>16px padding for dense lists.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>B</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>CS</AvatarFallback>
              </Avatar>
              <Avatar size="sm">
                <AvatarFallback>M</AvatarFallback>
              </Avatar>
            </div>
            <Separator />
            <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="type-title-s">Points to check</span>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={open ? "Hide points to check" : "Show points to check"}>
                    <ChevronsUpDownIcon aria-hidden="true" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="type-body-m text-on-surface-variant">
                The base case stops the recursion; each call works on a smaller input.
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>

      <Block title="Table">
        <Table>
          <TableCaption>Sessions this week for Prelim 1.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Topics</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SESSIONS.map((s) => (
              <TableRow key={s.day}>
                <TableCell>{s.day}</TableCell>
                <TableCell className="tabular-nums">{s.time}</TableCell>
                <TableCell>{s.mode}</TableCell>
                <TableCell className="max-w-48 truncate">{s.topic}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Accordion">
          <Accordion type="single" collapsible defaultValue="a">
            <AccordionItem value="a">
              <AccordionTrigger>What counts as an unresolved error?</AccordionTrigger>
              <AccordionContent>
                A logged wrong answer. It is resolved after you answer it correctly on 2 different days.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Why do follow-ups come sooner after a low score?</AccordionTrigger>
              <AccordionContent>Lower accuracy brings follow-ups sooner.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </Block>
        <Block title="Scroll area">
          <ScrollArea className="h-40 rounded-lg ring-1 ring-border">
            <ul className="flex flex-col divide-y divide-border">
              {["Lecture 1.pdf", "Lecture 2.pdf", "Lecture 3.pdf", "Lecture 4.pdf", "Lecture 5.pdf", "Lecture 6.pdf", "Notes week 3.md"].map((f) => (
                <li key={f} className="flex items-center gap-3 px-4 py-2.5 type-body-m">
                  <FileTextIcon className="size-4 text-on-surface-variant" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </Block>
      </div>
    </ShowcaseSection>
  )
}

export function Feedback() {
  return (
    <ShowcaseSection id="feedback" title="Feedback" description="Tonal banners for callouts, a snackbar for finished actions whose result isn't visible, skeletons while loading.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>AI features are paused.</AlertTitle>
          <AlertDescription>Existing decks and guides still work.</AlertDescription>
        </Alert>
        <Alert variant="info" role="status">
          <CalendarDaysIcon aria-hidden="true" />
          <AlertTitle>Sessions in this plan fall between these times each day.</AlertTitle>
        </Alert>
        <Alert variant="success" role="status">
          <CircleCheckIcon aria-hidden="true" />
          <AlertTitle>Added to Google Calendar</AlertTitle>
          <AlertDescription>14 sessions between today and Prelim 1.</AlertDescription>
        </Alert>
        <Alert variant="warning" role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>8 of 10 sessions added.</AlertTitle>
          <AlertDescription>2 sessions conflict with events in your calendar.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Answer not saved.</AlertTitle>
          <AlertDescription>Your text is still here. Check your connection and retry.</AlertDescription>
        </Alert>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Snackbar" description="Object plus past verb, no period, at most one action.">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => toast("Deck deleted")}>
              Show snackbar
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast("Plan created", {
                  action: { label: "View plan", onClick: () => undefined },
                })
              }
            >
              With an action
            </Button>
          </div>
        </Block>
        <Block title="Progress, spinner and skeleton">
          <div className="flex flex-col gap-4">
            <Progress value={64} aria-label="Upload progress" />
            <div className="flex items-center gap-3 type-body-m text-on-surface-variant">
              <Spinner /> Generating deck… This can take up to a minute.
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          </div>
        </Block>
      </div>

      <Block title="Empty (shadcn)">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No decks for CS 2110 yet</EmptyTitle>
            <EmptyDescription>Generate one from your CS 2110 materials.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>Generate deck</Button>
          </EmptyContent>
        </Empty>
      </Block>
    </ShowcaseSection>
  )
}

export function Overlays() {
  const [command, setCommand] = React.useState("none")
  return (
    <ShowcaseSection id="overlays" title="Overlays" description="Each trigger opens the real component. Dialogs and sheets use 28px corners on a 32% scrim.">
      <Block title="Triggers">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename deck</DialogTitle>
                <DialogDescription>The new name shows on the Cards page and in your plan.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="ds-deck-name">Deck name</FieldLabel>
                <Input id="ds-deck-name" defaultValue="Recursion basics" />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="text">Cancel</Button>
                </DialogClose>
                <Button>Save name</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            trigger={<Button variant="outline">Open confirm dialog</Button>}
            title="Delete the Prelim 1 plan?"
            description="Its 12 scheduled sessions come off your schedule. Your answers and progress stay, and so do events already in Google Calendar."
            confirmLabel="Delete plan"
            pendingLabel="Deleting plan…"
            onConfirm={() => new Promise((resolve) => setTimeout(resolve, 800))}
          />

          <ConfirmDialog
            trigger={<Button variant="outline">Typed confirmation</Button>}
            title="Delete your account?"
            description="This permanently deletes your plans, sessions, answers, materials, decks, guides, and chat history. Export your data first if you want a copy."
            confirmLabel="Delete account"
            confirmText="name@example.com"
            confirmTextLabel="Type your email address to confirm"
            onConfirm={() => new Promise((_, reject) => setTimeout(() => reject(new Error("demo")), 600))}
          />

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open side sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Session details</SheetTitle>
                <SheetDescription>Retrieval on Recursion, Wed, Oct 14.</SheetDescription>
              </SheetHeader>
              <div className="px-6 type-body-m text-on-surface-variant">10 questions, about 30 min.</div>
              <SheetFooter>
                <Button>Start session</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Confident error</PopoverTitle>
                <PopoverDescription>
                  You marked this Sure. This question comes back on another day.
                </PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Edit deck">
                <PencilIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit deck</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open deck menu">
                <MoreVerticalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Recursion basics</DropdownMenuLabel>
                <DropdownMenuItem>
                  <PencilIcon aria-hidden="true" />
                  Rename deck
                  <DropdownMenuShortcut>R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <LayersIcon aria-hidden="true" />
                  Review deck
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive">
                  <Trash2Icon aria-hidden="true" />
                  Delete deck
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Block>

      <Block title="Command" description="Inline, controlled so it doesn't scroll the page on mount.">
        <Command value={command} onValueChange={setCommand} className="max-w-md ring-1 ring-border">
          <CommandInput placeholder="Recursion" aria-label="Search pages and actions" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Pages">
              <CommandItem value="plan">
                <CalendarDaysIcon aria-hidden="true" />
                Plan
              </CommandItem>
              <CommandItem value="cards">
                <LayersIcon aria-hidden="true" />
                Flashcards
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem value="new plan">New plan</CommandItem>
              <CommandItem value="upload">Upload materials</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Block>
    </ShowcaseSection>
  )
}
