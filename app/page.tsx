import FinanceApp from "@/src/modules/finance/presentation/finance-app";
import { Suspense } from "react";

export default function Home() {
  return <Suspense fallback={<main className="unlock-page" id="main-content"><p>Opening SimplyTrack...</p></main>}><FinanceApp /></Suspense>;
}
