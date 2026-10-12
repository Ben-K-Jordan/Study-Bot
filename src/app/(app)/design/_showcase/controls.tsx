"use client"

import * as React from "react"
import {
  BoldIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  ItalicIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UnderlineIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { KbdHint } from "@/components/app/kbd-hint"

import { Block, ShowcaseSection, StateMatrix, previewState } from "./helpers"

const BUTTON_VARIANTS = ["default", "secondary", "outline", "text", "ghost", "destructive", "link"] as const
const BUTTON_LABELS: Record<(typeof BUTTON_VARIANTS)[number], string> = {
  default: "Create plan",
  secondary: "Review deck",
  outline: "Cancel",
  text: "Show answer",
  ghost: "Skip",
  destructive: "Delete plan",
  link: "Upload materials",
}

export function Actions() {
  return (
    <ShowcaseSection
      id="actions"
      title="Actions"
      description="Pill buttons with an M3 state layer. One filled button per group; outlined or text for the rest."
    >
      <Block title="Button" description="Variants by state. Loading reuses the verb with a spinner.">
        <StateMatrix
          rows={BUTTON_VARIANTS}
          states={["default", "hover", "focus", "active", "disabled", "loading"]}
          render={(variant, state) =>
            state === "loading" ? (
              <Button variant={variant} disabled>
                <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
                Saving…
              </Button>
            ) : (
              <Button variant={variant} {...previewState(state)}>
                {BUTTON_LABELS[variant]}
              </Button>
            )
          }
        />
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Sizes and icons">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="xs">Extra small</Button>
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                New plan
              </Button>
              <Button variant="outline">
                <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
                Add to Google Calendar
              </Button>
              <Button variant="text">
                All sessions
                <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="icon" variant="ghost" aria-label="Search">
                <SearchIcon aria-hidden="true" />
              </Button>
              <Button size="icon" variant="secondary" aria-label="New plan">
                <PlusIcon aria-hidden="true" />
              </Button>
              <Button size="icon" aria-label="New plan">
                <PlusIcon aria-hidden="true" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete Linked lists guide">
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
            <div className="max-w-60">
              <Button className="w-full">
                <span className="truncate">Reschedule 3 sessions before Prelim 1 in CS 2110</span>
              </Button>
            </div>
          </div>
        </Block>

        <Block title="Badge" description="Status chips. The words carry the meaning; colour reinforces it.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Due today</Badge>
              <Badge variant="secondary">Learning</Badge>
              <Badge variant="success">Mastered</Badge>
              <Badge variant="warning">1 missed</Badge>
              <Badge variant="destructive">3 unresolved</Badge>
              <Badge variant="outline">AI-written</Badge>
            </div>
            <div className="max-w-48">
              <Badge variant="outline" className="max-w-full">
                <span className="truncate">Introduction to algorithms and data structures</span>
              </Badge>
            </div>
          </div>
        </Block>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Toggle group" description="2 to 7 options, one choice: an M3 segmented button.">
          <div className="flex flex-col gap-4">
            <ToggleGroup type="single" variant="outline" spacing={0} defaultValue="week" aria-label="Range">
              <ToggleGroupItem value="day">Day</ToggleGroupItem>
              <ToggleGroupItem value="week">Week</ToggleGroupItem>
              <ToggleGroupItem value="month">Month</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="multiple" spacing={1} defaultValue={["bold"]} aria-label="Formatting">
              <ToggleGroupItem value="bold" aria-label="Bold">
                <BoldIcon aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="italic" aria-label="Italic">
                <ItalicIcon aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="underline" aria-label="Underline">
                <UnderlineIcon aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-2">
              <Toggle aria-label="Show answers" defaultPressed>
                Show answers
              </Toggle>
              <Toggle variant="outline" disabled aria-label="Shuffle">
                Shuffle
              </Toggle>
            </div>
          </div>
        </Block>
        <Block title="Keys" description="Key hints are aria-hidden and hidden on touch screens.">
          <div className="flex flex-wrap items-center gap-4 type-body-m text-on-surface-variant">
            <span className="flex items-center gap-2">
              <Kbd>1</Kbd>
              <Kbd>2</Kbd>
              <Kbd>3</Kbd>
              <Kbd>4</Kbd> answer
            </span>
            <span className="flex items-center gap-2">
              <Kbd>Enter</Kbd> continue
            </span>
            <span className="flex items-center gap-2">
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              submit
            </span>
            <span className="flex items-center gap-2">
              <KbdHint keys={["Mod", "K"]} /> KbdHint with Mod
            </span>
          </div>
        </Block>
      </div>
    </ShowcaseSection>
  )
}

export function Inputs() {
  const [course, setCourse] = React.useState("cs2110")
  return (
    <ShowcaseSection
      id="inputs"
      title="Inputs"
      description="Outlined fields at 48px with 16px text: 1px outline, on-surface on hover, 2px primary on focus. Labels sit above, helper text below."
    >
      <Block title="Text field" description="Default, hover, focus, disabled and invalid.">
        <StateMatrix
          rows={["input"] as const}
          states={["default", "hover", "focus", "disabled", "invalid"]}
          render={(_, state) => (
            <Input
              aria-label={`Course, ${state}`}
              defaultValue={state === "default" ? "" : "CS 2110"}
              placeholder="CS 2110"
              aria-invalid={state === "invalid" || undefined}
              className="w-44"
              {...previewState(state)}
            />
          )}
        />
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Form fields">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ds-course">Course</FieldLabel>
              <Input id="ds-course" placeholder="CS 2110" />
            </Field>
            <Field data-invalid>
              <FieldLabel htmlFor="ds-exam">Exam name</FieldLabel>
              <Input id="ds-exam" aria-invalid aria-describedby="ds-exam-error" />
              <FieldError id="ds-exam-error">Enter an exam name, like Prelim 1.</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="ds-rule">Correction rule</FieldLabel>
              <FieldDescription id="ds-rule-help">
                The rule or fact that makes the answer right, in your own words. It comes back in repair questions.
              </FieldDescription>
              <Textarea id="ds-rule" aria-describedby="ds-rule-help" />
            </Field>
            <Field data-disabled>
              <FieldLabel htmlFor="ds-email">Email</FieldLabel>
              <Input id="ds-email" disabled defaultValue="name@example.com" />
            </Field>
          </FieldGroup>
        </Block>

        <Block title="Choices">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ds-select">Course</FieldLabel>
              <Select value={course} onValueChange={setCourse}>
                <SelectTrigger id="ds-select" className="w-full">
                  <SelectValue placeholder="Choose a course" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectLabel>Courses</SelectLabel>
                    <SelectItem value="cs2110">CS 2110</SelectItem>
                    <SelectItem value="math1920">MATH 1920</SelectItem>
                    <SelectItem value="info1300">INFO 1300</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Study modes</FieldLegend>
              <FieldDescription>Choose every mode this plan can use.</FieldDescription>
              <FieldGroup className="gap-3">
                <Field orientation="horizontal">
                  <Checkbox id="ds-m1" defaultChecked />
                  <FieldLabel htmlFor="ds-m1" className="font-normal">
                    Retrieval
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="ds-m2" />
                  <FieldLabel htmlFor="ds-m2" className="font-normal">
                    Interleaved practice
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal" data-disabled>
                  <Checkbox id="ds-m3" disabled />
                  <FieldLabel htmlFor="ds-m3" className="font-normal">
                    Exam simulation
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Session length</FieldLegend>
              <RadioGroup defaultValue="30">
                {["20", "30", "45"].map((v) => (
                  <Field key={v} orientation="horizontal">
                    <RadioGroupItem value={v} id={`ds-len-${v}`} />
                    <FieldLabel htmlFor={`ds-len-${v}`} className="font-normal">
                      {v} min
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
            <Field orientation="horizontal">
              <Switch id="ds-sw" defaultChecked />
              <FieldLabel htmlFor="ds-sw" className="font-normal">
                Email reminders
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch id="ds-sw2" />
              <Label htmlFor="ds-sw2" className="font-normal">
                Add sessions to Google Calendar
              </Label>
            </Field>
          </FieldGroup>
        </Block>
      </div>

      <Block title="Input group" description="Buttons and icons inside a field use InputGroup.">
        <div className="flex max-w-xl flex-col gap-4">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput aria-label="Search your materials" placeholder="Recursion" />
          </InputGroup>
          <InputGroup>
            <InputGroupInput aria-label="Ask about CS 2110" placeholder="What is a base case?" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" size="sm">
                Ask
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Block>
    </ShowcaseSection>
  )
}
