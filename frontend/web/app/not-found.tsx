import { ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageShell } from "@/components/PageHeading";

export const metadata = { title: "Page not found · SpeakUp" };

export default function NotFound() {
  return (
    <PageShell>
      <h1 className="sr-only">Page not found</h1>
      <MascotState pose="oops" message="This trail ends here." detail="We couldn’t find that page.">
        <ButtonLink href="/">All presentations</ButtonLink>
      </MascotState>
    </PageShell>
  );
}
