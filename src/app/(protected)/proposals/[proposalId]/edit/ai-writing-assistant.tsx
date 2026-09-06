"use client";

import { useState } from "react";
import { generateProposalTextAction } from "../../../../../actions/ai-proposal-text";
import type { AiProposalTextDraft } from "../../../../../lib/validation/ai-proposal-text";

type Feature = "all" | "terms" | "exclusions" | "client_notes";
type CurrentValues = { terms: string; exclusions: string; clientNotes: string };
type ApplyMode = "replace" | "append";
type ApplyPromptState = ApplyMode | "pending" | null;

const FEATURE_LABEL: Record<Feature, string> = {
  all: "Generate all",
  terms: "Generate terms",
  exclusions: "Generate exclusions",
  client_notes: "Generate client notes",
};

/**
 * Assistive drafting only — never saves anything by itself. A generated
 * draft is shown for review, and only reaches the real Terms & Pricing
 * form (and therefore gets persisted) if the user explicitly clicks
 * "Apply to proposal," followed by that form's own "Save and continue."
 * See docs/10-ai-boundaries.md: AI is assistance, never authority.
 */
export function AiWritingAssistant({
  tenantId,
  proposalId,
  proposalVersionId,
  defaultTone,
  currentValues,
  onApply,
}: {
  tenantId: string;
  proposalId: string;
  proposalVersionId: string;
  defaultTone: string;
  currentValues: CurrentValues;
  onApply: (draft: Partial<CurrentValues>) => void;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const [tone, setTone] = useState(defaultTone);
  const [length, setLength] = useState<"short" | "standard" | "detailed">("standard");
  const [includeWarranty, setIncludeWarranty] = useState(true);
  const [includePaymentTerms, setIncludePaymentTerms] = useState(true);
  const [includeExclusions, setIncludeExclusions] = useState(true);
  const [includeClientResponsibilities, setIncludeClientResponsibilities] = useState(true);

  const [pendingFeature, setPendingFeature] = useState<Feature | null>(null);
  const [draft, setDraft] = useState<AiProposalTextDraft | null>(null);
  const [lastFeature, setLastFeature] = useState<Feature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyPromptState>(null);

  const isLoading = pendingFeature !== null;

  function draftFieldsFor(feature: Feature, d: AiProposalTextDraft): Partial<CurrentValues> {
    if (feature === "terms") return { terms: d.terms };
    if (feature === "exclusions") return { exclusions: d.exclusions };
    if (feature === "client_notes") return { clientNotes: d.clientNotes };
    return { terms: d.terms, exclusions: d.exclusions, clientNotes: d.clientNotes };
  }

  async function handleGenerate(feature: Feature) {
    setPendingFeature(feature);
    setError(null);
    setDraft(null);
    setApplyMode(null);

    const result = await generateProposalTextAction({
      tenantId,
      proposalId,
      proposalVersionId,
      feature,
      tone,
      length,
      includeWarranty,
      includePaymentTerms,
      includeExclusions,
      includeClientResponsibilities,
    });

    setPendingFeature(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDraft(result.draft);
    setLastFeature(feature);
    setUsedFallback(result.usedFallback);
  }

  function fieldsWithExistingText(feature: Feature): (keyof CurrentValues)[] {
    const candidates: (keyof CurrentValues)[] =
      feature === "terms" ? ["terms"] : feature === "exclusions" ? ["exclusions"] : feature === "client_notes" ? ["clientNotes"] : ["terms", "exclusions", "clientNotes"];
    return candidates.filter((key) => currentValues[key].trim().length > 0);
  }

  function applyDraft(mode: ApplyMode) {
    if (!draft || !lastFeature) return;
    const generated = draftFieldsFor(lastFeature, draft);
    if (mode === "append") {
      const appended: Partial<CurrentValues> = {};
      for (const key of Object.keys(generated) as (keyof CurrentValues)[]) {
        const existing = currentValues[key].trim();
        const addition = generated[key] ?? "";
        appended[key] = existing ? `${existing}\n\n${addition}` : addition;
      }
      onApply(appended);
    } else {
      onApply(generated);
    }
    setApplyMode(null);
    setDraft(null);
    setLastFeature(null);
  }

  function handleApplyClick() {
    if (!lastFeature) return;
    const conflicts = fieldsWithExistingText(lastFeature);
    if (conflicts.length === 0) {
      applyDraft("replace");
      return;
    }
    // Existing text present -- ask before overwriting anything (see the
    // brief's "No overwrite without confirmation").
    setApplyMode("pending");
  }

  return (
    <div className="section-card stack">
      <h3>AI writing assistant</h3>
      <p className="hint">Generate a first draft for terms, exclusions, and client notes based on this proposal and your business profile.</p>
      <p className="hint">
        <strong>AI drafts are suggestions.</strong> Review before sending to a client. AI-generated text is a drafting aid
        and should be reviewed before use — it is not legal advice and creates no legal guarantee.
      </p>

      {error ? <p className="error-banner">{error}</p> : null}
      {draft && usedFallback ? (
        <p className="hint">AI writing is not configured yet — this is a basic template you can still edit and apply.</p>
      ) : null}

      <div className="tenant-form" style={{ width: "100%" }}>
        {(["all", "terms", "exclusions", "client_notes"] as Feature[]).map((feature) => (
          <button
            key={feature}
            type="button"
            className={feature === "all" ? "button-primary" : "button-secondary"}
            onClick={() => handleGenerate(feature)}
            disabled={isLoading}
            aria-busy={pendingFeature === feature}
          >
            {pendingFeature === feature ? "Generating…" : FEATURE_LABEL[feature]}
          </button>
        ))}
        <button type="button" className="button-secondary" onClick={() => setShowOptions((v) => !v)}>
          {showOptions ? "Hide options" : "Advanced options"}
        </button>
      </div>

      {showOptions ? (
        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="aiTone">Tone</label>
            <select id="aiTone" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="direct">Direct</option>
              <option value="detailed">Detailed</option>
              <option value="simple">Simple</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="aiLength">Length</label>
            <select id="aiLength" value={length} onChange={(e) => setLength(e.target.value as typeof length)}>
              <option value="short">Short</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>
        </div>
      ) : null}
      {showOptions ? (
        <div className="stack" style={{ gap: 4 }}>
          <label className="tenant-form" style={{ alignItems: "center" }}>
            <input type="checkbox" checked={includeWarranty} onChange={(e) => setIncludeWarranty(e.target.checked)} style={{ width: "auto" }} />
            Include warranty
          </label>
          <label className="tenant-form" style={{ alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includePaymentTerms}
              onChange={(e) => setIncludePaymentTerms(e.target.checked)}
              style={{ width: "auto" }}
            />
            Include payment terms
          </label>
          <label className="tenant-form" style={{ alignItems: "center" }}>
            <input type="checkbox" checked={includeExclusions} onChange={(e) => setIncludeExclusions(e.target.checked)} style={{ width: "auto" }} />
            Include exclusions
          </label>
          <label className="tenant-form" style={{ alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeClientResponsibilities}
              onChange={(e) => setIncludeClientResponsibilities(e.target.checked)}
              style={{ width: "auto" }}
            />
            Include client responsibilities
          </label>
        </div>
      ) : null}

      {draft ? (
        <div className="stack">
          <h4>Generated draft</h4>
          {draft.warnings.length > 0 ? (
            <ul className="hint">
              {draft.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {draft.terms ? (
            <div className="field">
              <label>Terms</label>
              <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: "none", whiteSpace: "pre-wrap" }}>
                {draft.terms}
              </div>
            </div>
          ) : null}
          {draft.exclusions ? (
            <div className="field">
              <label>Exclusions</label>
              <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: "none", whiteSpace: "pre-wrap" }}>
                {draft.exclusions}
              </div>
            </div>
          ) : null}
          {draft.clientNotes ? (
            <div className="field">
              <label>Notes for client</label>
              <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: "none", whiteSpace: "pre-wrap" }}>
                {draft.clientNotes}
              </div>
            </div>
          ) : null}

          {applyMode === "pending" ? (
            <div className="stack" style={{ gap: 6 }}>
              <p className="hint">This will replace your current text. You can also append the draft below what&apos;s already there.</p>
              <div className="tenant-form">
                <button type="button" className="button-primary" onClick={() => applyDraft("replace")}>
                  Replace existing text
                </button>
                <button type="button" className="button-secondary" onClick={() => applyDraft("append")}>
                  Append below existing text
                </button>
                <button type="button" className="button-secondary" onClick={() => setApplyMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="tenant-form">
              <button type="button" className="button-primary" onClick={handleApplyClick}>
                Apply to proposal
              </button>
              <button type="button" className="button-secondary" onClick={() => lastFeature && handleGenerate(lastFeature)} disabled={isLoading}>
                Regenerate
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setDraft(null);
                  setLastFeature(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
