import { z } from "zod";
import { CARD_BACK_MAX, CARD_FRONT_MAX } from "@/services/flashcards";
import { formatNumber } from "@/lib/format";

/** The two sides of a card. Errors are written as instructions for the field. */
export const cardFront = z
  .string()
  .trim()
  .min(1, "Write the question or cue for the front.")
  .max(CARD_FRONT_MAX, `Keep the front under ${formatNumber(CARD_FRONT_MAX)} characters.`);

export const cardBack = z
  .string()
  .trim()
  .min(1, "Write the answer for the back.")
  .max(CARD_BACK_MAX, `Keep the back under ${formatNumber(CARD_BACK_MAX)} characters.`);

export const cardCreateSchema = z.object({ front: cardFront, back: cardBack });

export const cardUpdateSchema = z
  .object({ front: cardFront.optional(), back: cardBack.optional() })
  .refine((v) => v.front !== undefined || v.back !== undefined, {
    message: "Change the front or the back.",
  });
