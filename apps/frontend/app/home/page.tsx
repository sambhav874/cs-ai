"use client";

import React, { useEffect } from "react";
import ProjectDashboard from "@/components/dashboard/ProjectDashboard";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";

export default function HomePage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  
  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="min-h-screen bg-background font-InterVar text-foreground pt-20 md:pt-0">
      <main className="flex flex-1 flex-col overflow-y-auto">
        <div className="p-6 md:p-8">
          <ProjectDashboard portfolio={null} kpis={[]} isEmpty={false} />
        </div>
      </main>
    </div>
  );
}
