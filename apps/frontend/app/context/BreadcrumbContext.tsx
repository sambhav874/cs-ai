"use client";

import React, { createContext, useContext, useState } from "react";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextType {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (breadcrumbs: Breadcrumb[]) => void;
  headerActions: React.ReactNode | null;
  setHeaderActions: (actions: React.ReactNode | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType>({
  breadcrumbs: [],
  setBreadcrumbs: () => {},
  headerActions: null,
  setHeaderActions: () => {},
});

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [headerActions, setHeaderActions] = useState<React.ReactNode | null>(null);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs, headerActions, setHeaderActions }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  return useContext(BreadcrumbContext);
}
