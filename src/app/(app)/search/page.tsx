import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchView } from "@/components/pages/SearchView";
import { SkeletonRows } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <Suspense fallback={<SkeletonRows count={4} />}>
      <SearchView />
    </Suspense>
  );
}
