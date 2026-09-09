import type { GitSignatureStatus } from "../src/types";
import { escapeHtml } from "./utils";

interface SignaturePresentation {
  badge: string;
  id: string;
  label: string;
}

const SIGNATURE_PRESENTATIONS: Record<string, SignaturePresentation> = {
  B: { badge: "B", id: "bad", label: "Bad" },
  E: { badge: "E", id: "cannotCheck", label: "Cannot check" },
  G: { badge: "G", id: "good", label: "Verified" },
  N: { badge: "N", id: "unsigned", label: "Unsigned" },
  R: { badge: "R", id: "revoked", label: "Revoked" },
  U: { badge: "U", id: "unknown", label: "Unknown" },
  X: { badge: "X", id: "expired", label: "Expired" },
  Y: { badge: "Y", id: "expired", label: "Expired" }
};

const UNKNOWN_SIGNATURE_PRESENTATION: SignaturePresentation = {
  badge: "•",
  id: "unknown",
  label: "Unknown"
};

export function getSignaturePresentation(status: string): SignaturePresentation {
  return SIGNATURE_PRESENTATIONS[status] ?? UNKNOWN_SIGNATURE_PRESENTATION;
}

export function buildSignatureChipHtml(signature: GitSignatureStatus | null | undefined): string {
  if (!signature || signature.status === "N") return "";

  const presentation = getSignaturePresentation(signature.status);
  const detailLines = [
    `Signer: ${signature.signer || "Not provided"}`,
    `Key: ${signature.key || "Not provided"}`,
    `Fingerprint: ${signature.fingerprint || "Not provided"}`,
    `Primary key fingerprint: ${signature.primaryKeyFingerprint || "Not provided"}`,
    `Trust: ${signature.trustLevel || "Not provided"}`
  ];
  const accessibleLabel = escapeHtml(`Signature: ${presentation.label}`);
  const accessibleDetails = escapeHtml(detailLines.join("\n"));
  const className = `signatureChip signature${presentation.id.charAt(0).toUpperCase()}${presentation.id.slice(1)}`;

  return (
    `<span class="${className}" role="note" aria-label="${accessibleLabel}" title="${accessibleDetails}">` +
    `<span class="signatureChipBadge" aria-hidden="true">${escapeHtml(presentation.badge)}</span>` +
    `<span class="signatureChipLabel">${escapeHtml(presentation.label)}</span>` +
    "</span>"
  );
}
