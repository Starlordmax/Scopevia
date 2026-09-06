import { redirect } from "next/navigation";

// Projects is no longer a visible module — see
// docs/38-navigation-simplification.md. The route redirects rather than
// 404ing since it may be bookmarked. The projects table, its addresses,
// status machine, and create_project_from_accepted_proposal() are
// untouched; only this UI entry point (and its children) are gone.
export default function ProjectsRedirectPage() {
  redirect("/proposals");
}
