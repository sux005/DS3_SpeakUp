import { ResultsSkeleton } from "@/components/LoadingSkeleton";
import { PageShell } from "@/components/PageHeading";

export default function Loading() {
  return <PageShell><ResultsSkeleton /></PageShell>;
}
