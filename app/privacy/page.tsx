import type { Metadata } from "next";
import { LegalPage } from "@/src/modules/legal/presentation/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | SimplyTrack",
  description: "How SimplyTrack stores, encrypts and syncs your financial information.",
};

export default function PrivacyPage() {
  return <LegalPage document="privacy" />;
}
