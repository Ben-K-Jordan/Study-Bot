/**
 * The exact confirmation DELETE /api/account/delete expects in its body:
 * { confirm: DELETE_ACCOUNT_PHRASE }. The student never types it; the
 * Settings dialog asks for their email address and then sends this.
 */
export const DELETE_ACCOUNT_PHRASE = "DELETE MY ACCOUNT";
