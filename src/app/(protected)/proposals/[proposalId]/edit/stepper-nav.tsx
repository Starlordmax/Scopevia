import Link from "next/link";

export const BUILDER_STEPS = [
  { key: "measurements", label: "Measurements" },
  { key: "scope", label: "Scope of Work" },
  { key: "labor", label: "Labor" },
  { key: "materials", label: "Materials & Costs" },
  { key: "photos", label: "Photos" },
  { key: "pricing", label: "Terms & Pricing" },
  { key: "review", label: "Review" },
] as const;

export type BuilderStep = (typeof BUILDER_STEPS)[number]["key"];

export function StepperNav({ proposalId, currentStep }: { proposalId: string; currentStep: BuilderStep }) {
  const currentIndex = BUILDER_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav className="proposal-stepper" aria-label="Proposal builder steps">
      {BUILDER_STEPS.map((step, index) => (
        <Link
          key={step.key}
          href={`/proposals/${proposalId}/edit?step=${step.key}`}
          className="proposal-stepper-item"
          data-active={step.key === currentStep}
          data-done={index < currentIndex}
          aria-current={step.key === currentStep ? "step" : undefined}
        >
          <span className="proposal-stepper-number">{index + 1}</span>
          <span className="proposal-stepper-label">{step.label}</span>
        </Link>
      ))}
    </nav>
  );
}
