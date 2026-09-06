import { redirect } from "next/navigation";

// Pipeline (the Opportunity kanban board) is no longer a visible module —
// see docs/38-navigation-simplification.md. The route is kept as a safe
// redirect rather than a 404 because it may still be bookmarked or linked
// from outside the app. The opportunities table, its status machine, and
// its RLS/RPC layer are untouched; only this UI entry point is gone.
export default function PipelineRedirectPage() {
  redirect("/proposals");
}
