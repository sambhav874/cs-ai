import { Suspense } from "react";
import LoadingScreen from "@/components/loader";
import { ProjectContractsScreen } from "@/components/projects/ProjectContractsScreen";

export default async function ProjectContractsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const resolvedParams = await params;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ProjectContractsScreen projectId={resolvedParams.projectId} />
    </Suspense>
  );
}
