/**
 * The exact confirmation DELETE /api/account/delete expects in its body,
 * next to the student's password: { confirm: DELETE_ACCOUNT_PHRASE, password }.
 * The student never types the phrase; the Settings dialog asks for their
 * password and sends both.
 */
export const DELETE_ACCOUNT_PHRASE = "DELETE MY ACCOUNT";
