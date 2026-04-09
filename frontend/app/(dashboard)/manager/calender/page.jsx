"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ManagerCalenderAliasPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/manager/calendar");
  }, [router]);

  return null;
}
