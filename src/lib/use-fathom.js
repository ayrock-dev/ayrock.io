"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import * as Fathom from "fathom-client";

export function UseFathom() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  React.useEffect(() => {
    Fathom.load(process.env.NEXT_PUBLIC_FATHOM_SITE_ID, {
      includedDomains: ["ayrock.io"],
    });
  }, []);

  React.useEffect(() => {
    Fathom.trackPageview();
  }, [pathname, searchParams]);

  return null;
}
