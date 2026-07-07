import { redirect } from "next/navigation";

// See src/app/(protected)/projects/page.tsx and
// docs/38-navigation-simplification.md — Projects is no longer a visible
// module; this route (and /edit) redirects rather than 404ing since a
// specific project link may be bookmarked. The underlying row, its
// addresses, and its status history are untouched.
export default function ProjectDetailRedirectPage() {
  redirect("/proposals");
}
