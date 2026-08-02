import { Suspense } from "react";
import { ProfileView } from "@/components/profile-view";

// The interactive form tree lives in a client component; this thin wrapper
// keeps Suspense boundaries (needed for useSearchParams) on the server side.
export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileView />
    </Suspense>
  );
}
