import { modeLabel as sharedModeLabel } from "@/lib/modes";

/** Study mode names as VOICE.md writes them; unknown modes read as "Session". */
export function modeLabel(mode: string | null | undefined): string {
  return sharedModeLabel(mode, "Session");
}
