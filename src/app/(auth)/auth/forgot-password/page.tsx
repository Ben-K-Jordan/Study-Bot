import type { Metadata } from "next";
import Link from "next/link";

import { AuthActions, AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Button } from "@/components/ui/button";
import { areEmailLinksAvailable } from "@/lib/email/delivery";
import { PASSWORD_RESET_UNAVAILABLE } from "@/lib/email/messages";

// Whether reset links can go out depends on the server's runtime settings,
// so the page can't be rendered once at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: areEmailLinksAvailable() ? "Reset password" : PASSWORD_RESET_UNAVAILABLE.title };
}

/**
 * Open to signed-in visitors as well: an emailed reset link is the only way
 * to change a password, signed in or not. A server that can't deliver the
 * link says so up front instead of asking for an address.
 */
export default function ForgotPasswordPage() {
  if (!areEmailLinksAvailable()) {
    return (
      <AuthCard title={PASSWORD_RESET_UNAVAILABLE.title} description={PASSWORD_RESET_UNAVAILABLE.description}>
        <AuthActions>
          <Button asChild>
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
        </AuthActions>
      </AuthCard>
    );
  }
  return <ForgotPasswordForm />;
}
