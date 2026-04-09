"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HtmlRichTextField } from "./HtmlRichTextField";
import { Input } from "@/components/ui/input";

export function SubmitPlanDialog({
  open,
  onOpenChange,
  title,
  clientBrand,
  dueText,
  contentTypeLabel,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  accent = "#0EA5E9",
}) {
  const d = draft || { hook: "", concept: "", captionDirection: "", contentBrief: [""] };
  const points = d.contentBrief?.length ? d.contentBrief : [""];

  const setField = (patch) => onDraftChange?.({ ...d, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-h-[min(90vh,720px)] max-w-[min(100vw-2rem,640px)] gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Submit plan</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{title}</span>
            {clientBrand ? <span className="text-muted-foreground">{clientBrand}</span> : null}
            {contentTypeLabel ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-xs">{contentTypeLabel}</span>
            ) : null}
            {dueText ? <span className="text-xs text-muted-foreground">Due {dueText}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <HtmlRichTextField
            key={`hook-${open}-${title}`}
            id="plan-hook"
            label="Hook"
            value={d.hook}
            onChange={(html) => setField({ hook: html })}
            placeholder="Write a strong hook…"
            minHeight={120}
          />
          <HtmlRichTextField
            key={`concept-${open}-${title}`}
            id="plan-concept"
            label="Concept"
            value={d.concept}
            onChange={(html) => setField({ concept: html })}
            placeholder="Concept direction…"
            minHeight={120}
          />
          <HtmlRichTextField
            key={`caption-${open}-${title}`}
            id="plan-caption"
            label="Caption direction"
            value={d.captionDirection}
            onChange={(html) => setField({ captionDirection: html })}
            placeholder="Caption direction…"
            minHeight={100}
          />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Content points</p>
            <div className="space-y-2">
              {points.map((point, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    value={point}
                    placeholder={`Point ${idx + 1}`}
                    onChange={(e) => {
                      const next = [...points];
                      next[idx] = e.target.value;
                      setField({ contentBrief: next });
                    }}
                  />
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setField({ contentBrief: [...points, ""] })}
            >
              + Add point
            </Button>
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/30 px-5 py-4 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            style={{ backgroundColor: accent, color: "#fff" }}
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? "Submitting…" : "Submit plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
