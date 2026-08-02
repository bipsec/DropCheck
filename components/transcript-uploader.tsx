"use client";

import * as React from "react";
import { UploadCloud, FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadTranscript } from "@/lib/api";
import type { UploadResult } from "@/lib/api-types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (result: UploadResult) => void;
};

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * PDF uploader with drag-and-drop + click-to-pick. Runs the full backend
 * pipeline (parse → extract → apply → match) and hands the result back to
 * the caller. Errors surface as toasts; the parent then reloads the profile.
 */
export function TranscriptUploader({ open, onOpenChange, onUploaded }: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setDragging(false);
      setUploading(false);
    }
  }, [open]);

  const pickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = files[0];
    if (!/\.pdf$/i.test(next.name) && next.type !== "application/pdf") {
      toast.error("PDF only", { description: `Got ${next.type || next.name}.` });
      return;
    }
    if (next.size > MAX_BYTES) {
      toast.error("File too large", {
        description: `${Math.round(next.size / 1024 / 1024)}MB — max 15MB.`,
      });
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadTranscript(file);
      // Three outcome tiers based on what actually landed:
      //   empty parse   → warn, no extraction ran
      //   nothing parsed → warn, extraction ran but returned no courses
      //   default        → success toast with counts
      if (result.parse_method === "empty") {
        toast.warning("PDF looked empty", {
          description:
            result.warning ??
            "Couldn't extract any text. Fill in your profile manually below.",
        });
      } else if (result.courses_parsed === 0) {
        toast.warning("Ingested, but no courses parsed", {
          description:
            result.warning ??
            "The extraction agent didn't find a course table. You can add courses manually.",
        });
      } else {
        toast.success("Transcript ingested", {
          description: `${result.courses_parsed} courses parsed, ${result.courses_matched} matched to catalog.`,
        });
        // Surface non-fatal warnings the backend flagged (e.g. finance
        // hints skipped, matcher partial failures).
        if (result.warning) {
          toast.info("Heads up", { description: result.warning });
        }
      }
      onUploaded(result);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Upload failed", { description: message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload transcript</DialogTitle>
          <DialogDescription>
            The extraction agent fills in whatever it can — anything it&apos;s
            unsure about stays null so you can fix it inline.
          </DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors",
            dragging && "border-lamp bg-lamp/10",
            uploading && "pointer-events-none opacity-60"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => pickFiles(e.target.files)}
            disabled={uploading}
          />
          {file ? (
            <>
              <FileText className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                disabled={uploading}
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
              >
                <X className="mr-1" />
                Choose a different file
              </Button>
            </>
          ) : (
            <>
              <UploadCloud className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                Drop a transcript PDF here, or click to pick
              </p>
              <p className="text-xs text-muted-foreground">
                Max 15MB. Scanned PDFs are OCR&apos;d automatically when tesseract
                is available.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            variant="lamp"
            onClick={submit}
            disabled={!file || uploading}
            className="min-w-28"
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" />
                Ingesting…
              </>
            ) : (
              "Ingest transcript"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
