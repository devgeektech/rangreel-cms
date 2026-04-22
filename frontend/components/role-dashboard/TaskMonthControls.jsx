"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMonthLabelEN, shiftMonthYYYYMM } from "@/lib/roleDashboardTasks";

export function TaskMonthControls({
  month,
  onMonthChange,
  accent,
  dateScope,
  onDateScopeChange,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onDateScopeChange ? (
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <Button
            type="button"
            size="sm"
            variant={dateScope === "today" ? "default" : "ghost"}
            className="h-8"
            onClick={() => onDateScopeChange("today")}
          >
            Today
          </Button>
          <Button
            type="button"
            size="sm"
            variant={dateScope === "currentMonth" ? "default" : "ghost"}
            className="h-8"
            onClick={() => onDateScopeChange("currentMonth")}
          >
            Current Month
          </Button>
        </div>
      ) : null}
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
