import { Suspense } from "react";
import { CheckView } from "@/components/check-view";

// Interactive logic lives in the client component; thin server wrapper
// keeps Suspense/routing metadata out of the client bundle.
export default function CheckPage() {
  return (
    <Suspense fallback={null}>
      <CheckView />
    </Suspense>
  );
}
