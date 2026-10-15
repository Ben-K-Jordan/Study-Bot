import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

/**
 * Open to signed-in visitors as well: an emailed reset link is the only way
 * to change a password, signed in or not.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
