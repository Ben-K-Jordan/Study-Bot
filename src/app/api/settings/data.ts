import { prisma } from "@/lib/db";
import { SETTINGS_DEFAULTS, type UserSettings } from "./rules";

/**
 * The student's study settings. A student who never saved any gets the
 * defaults; reading never creates a row.
 */
export async function readSettings(userId: string): Promise<UserSettings> {
  const state = await prisma.userGameState.findUnique({
    where: { userId },
    select: {
      studyStartTime: true,
      studyEndTime: true,
      dailyStudyCap: true,
      dailyXpGoal: true,
      timezone: true,
    },
  });
  if (!state) return { ...SETTINGS_DEFAULTS };
  return {
    studyStart: state.studyStartTime,
    studyEnd: state.studyEndTime,
    dailyCap: state.dailyStudyCap,
    dailyXpGoal: state.dailyXpGoal,
    timezone: state.timezone,
  };
}

/** Saves a complete, already validated set of settings. */
export async function writeSettings(userId: string, values: UserSettings): Promise<UserSettings> {
  const data = {
    studyStartTime: values.studyStart,
    studyEndTime: values.studyEnd,
    dailyStudyCap: values.dailyCap,
    dailyXpGoal: values.dailyXpGoal,
    timezone: values.timezone,
  };
  const state = await prisma.userGameState.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return {
    studyStart: state.studyStartTime,
    studyEnd: state.studyEndTime,
    dailyCap: state.dailyStudyCap,
    dailyXpGoal: state.dailyXpGoal,
    timezone: state.timezone,
  };
}
