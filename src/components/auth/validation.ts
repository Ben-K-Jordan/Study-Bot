/**
 * Field rules and messages for the auth forms. The API routes validate with
 * the same limits and messages, so a rule reads the same whether the browser
 * or the server catches it.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const NAME_MAX_LENGTH = 50;

export const FIELD_MESSAGES = {
  emailMissing: "Enter your email address.",
  emailInvalid: "Enter an email address like name@example.com.",
  passwordMissing: "Enter your password.",
  newPasswordMissing: "Enter a password.",
  passwordShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  confirmMissing: "Enter the password again.",
  passwordMismatch: "Enter the same password in both fields.",
  nameMissing: "Enter your name.",
  nameLong: `Use ${NAME_MAX_LENGTH} characters or fewer.`,
} as const;

/** Helper text shown under a new-password field before anything is typed. */
export const PASSWORD_RULE = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;

// Deliberately loose: one @, something on each side, a dot in the domain.
// The server's check is stricter and its message maps back to the field.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return FIELD_MESSAGES.emailMissing;
  if (!EMAIL_SHAPE.test(email)) return FIELD_MESSAGES.emailInvalid;
  return null;
}

/** Sign-in only checks that a password was typed; its length is the account's business. */
export function validateCurrentPassword(value: string): string | null {
  return value ? null : FIELD_MESSAGES.passwordMissing;
}

export function validateNewPassword(value: string): string | null {
  if (!value) return FIELD_MESSAGES.newPasswordMissing;
  if (value.length < PASSWORD_MIN_LENGTH) return FIELD_MESSAGES.passwordShort;
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return FIELD_MESSAGES.confirmMissing;
  if (password !== confirmation) return FIELD_MESSAGES.passwordMismatch;
  return null;
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return FIELD_MESSAGES.nameMissing;
  if (name.length > NAME_MAX_LENGTH) return FIELD_MESSAGES.nameLong;
  return null;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Drop fields whose check passed, so an empty object means the form is valid. */
export function collectErrors<K extends string>(checks: Record<K, string | null>): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const key of Object.keys(checks) as K[]) {
    const message = checks[key];
    if (message) errors[key] = message;
  }
  return errors;
}

export function hasErrors(errors: FieldErrors<string>): boolean {
  return Object.keys(errors).length > 0;
}
