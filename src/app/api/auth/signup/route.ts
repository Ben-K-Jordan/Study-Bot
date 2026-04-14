import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(50),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name } = signupSchema.parse(body);

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: normalizedEmail,
            name,
            passwordHash,
          },
        });

        await tx.notificationPreference.create({
          data: { userId: u.id },
        });

        await tx.userGameState.create({
          data: {
            userId: u.id,
            displayName: name,
            onboardingComplete: false,
          },
        });

        return u;
      });

      return NextResponse.json(
        { id: user.id, email: user.email, name: user.name },
        { status: 201 }
      );
    } catch (err: unknown) {
      // Unique constraint violation (P2002) — email already taken
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0].message },
        { status: 400 }
      );
    }
    console.error("Signup error:", err);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
