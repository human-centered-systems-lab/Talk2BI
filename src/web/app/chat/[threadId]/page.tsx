import { Suspense } from "react";
import { Assistant } from "../assistant";

interface PageProps {
  params: Promise<{ threadId: string }>;
}

export default async function Home({ params }: PageProps) {
  const { threadId } = await params;
  
  return (
    <Suspense>
      <Assistant threadId={threadId} />
    </Suspense>
  );
}
