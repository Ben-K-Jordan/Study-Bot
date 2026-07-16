import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

// Secure cookies must follow the actual serving protocol, not the build
// mode: a production build served over plain http (e.g. `npm start` on
// localhost) would set Secure cookies the browser silently drops, making
// sign-in impossible. Browsers only honor the __Secure- prefix over https.
const useSecureCookies =
  process.env.NEXTAUTH_URL?.startsWith("https://") ??
  process.env.NODE_ENV === "production";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,  // 7 days
    updateAge: 24 * 60 * 60,   // refresh token every 24h
  },
  cookies: {
    sessionToken: {
      name: useSecureCookies ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  pages: {
    signIn: "/auth/signin",
    newUser: "/auth/signup",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });

        // Always run bcrypt.compare to prevent timing-based user enumeration.
        // If the user doesn't exist we compare against a dummy hash.
        const DUMMY_HASH = "$2a$12$000000000000000000000uGAIn1VGbk3rmB7qkVMHMNGLCgnfm2y";
        const valid = await bcrypt.compare(
          credentials.password,
          user?.passwordHash ?? DUMMY_HASH,
        );
        if (!user || !valid) return null;

        // Single-user app: verifying your own email to yourself protects
        // nothing, and this gate once locked the owner out of a local
        // production build. Opt in only when real SMTP can deliver links.
        if (process.env.REQUIRE_EMAIL_VERIFICATION === "true" && !user.emailVerified) {
          return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
};
