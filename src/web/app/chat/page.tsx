import { Suspense } from "react";
import { Assistant } from "./assistant";

export default function Home() {
  return (
    <Suspense>
      <Assistant />
    </Suspense>
  );
}
