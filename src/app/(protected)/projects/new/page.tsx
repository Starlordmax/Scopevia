import { redirect } from "next/navigation";

// See src/app/(protected)/projects/page.tsx and
// docs/38-navigation-simplification.md — Projects is no longer a visible
// module; this route redirects rather than 404ing since it may be
// bookmarked.
export default function NewProjectRedirectPage() {
  redirect("/proposals");
}
