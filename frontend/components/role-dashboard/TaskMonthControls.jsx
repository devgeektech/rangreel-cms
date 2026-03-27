"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMonthLabelEN, shiftMonthYYYYMM } from "@/lib/roleDashboardTasks";

export function TaskMonthControls({ month, onMonthChange, accent }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onMonthChange(shiftMonthYYYYMM(month, -1))}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Badge variant="outline" className="min-w-[9rem] justify-center" style={accent ? { borderColor: accent, color: accent } : undefined}>
        {formatMonthLabelEN(month)}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => onMonthChange(shiftMonthYYYYMM(month, 1))}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
