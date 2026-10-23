import type { Metadata } from "next";
import { LegalPage } from "@/src/modules/legal/presentation/legal-page";

export const metadata: Metadata = {
  title: "Terms and Conditions | SimplyTrack",
  description: "The terms for using SimplyTrack, its estimates and optional services.",
};

export default function TermsPage() {
  return <LegalPage document="terms" />;
}
