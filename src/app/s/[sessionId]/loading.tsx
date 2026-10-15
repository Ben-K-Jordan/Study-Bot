import { PreflightSkeleton } from "@/components/session/skeletons";

/** Shown while the session loads: the shape of the session intro, which opens first. */
export default function SessionLoading() {
  return <PreflightSkeleton />;
}
