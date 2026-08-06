"use client";

import React, { useEffect, useState, useCallback } from "react";
import ProjectDashboard from "@/components/dashboard/ProjectDashboard";
import { useBreadcrumbs } from "@/app/context/BreadcrumbContext";
import { useAuth } from "@/hooks/useAuth";
import type { ContractKPI, ProjectKpiPortfolio } from "@/components/dashboard/types";

export default function HomePage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const [portfolio, setPortfolio] = useState<ProjectKpiPortfolio | null>(null);
  const [kpis, setKpis] = useState<ContractKPI[]>([]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  const loadGlobalDashboardData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
      const projectsRes = await authenticatedFetch(`${apiUrl}/projects/`);
      const projectsList = Array.isArray(projectsRes.data) ? projectsRes.data : [];
      
      if (projectsList.length > 0) {
        const projectId = projectsList[0]._id;
        const [portfolioRes, kpisRes] = await Promise.all([
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis/portfolio`),
          authenticatedFetch(`${apiUrl}/projects/${projectId}/kpis`),
        ]);

        if (!portfolioRes.error && portfolioRes.data) {
          setPortfolio(portfolioRes.data);
        }
        if (!kpisRes.error && Array.isArray(kpisRes.data?.kpis)) {
          setKpis(kpisRes.data.kpis);
        }
      }
    } catch (err) {
      console.warn("Could not fetch live portfolio for home page:", err);
    }
  }, [isAuthenticated, authenticatedFetch]);

  useEffect(() => {
    void loadGlobalDashboardData();
  }, [loadGlobalDashboardData]);

  return (
    <div className="min-h-screen bg-background font-InterVar text-foreground pt-20 md:pt-0">
      <main className="flex flex-1 flex-col overflow-y-auto">
        <div className="p-6 md:p-8">
          <ProjectDashboard portfolio={portfolio} kpis={kpis} isEmpty={false} />
        </div>
      </main>
    </div>
  );
}
