import type { Metadata } from "next";
import { RecentView } from "@/components/pages/RecentView";

export const metadata: Metadata = { title: "Recently Played" };

export default function RecentPage() {
  return <RecentView />;
}
