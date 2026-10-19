import { useId } from "react";
import { ErrorCode, useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";
import { TRACE_PHOTO_ACCEPT, TRACE_PHOTO_FORMAT_ERROR, TRACE_PHOTO_MAX_BYTES, TRACE_PHOTO_SIZE_ERROR } from "@/lib/trace-photo";

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  onFileRejected: (message: string) => void;
  className?: string;
}

export function FileUpload({
  onFileSelected,
  onFileRejected,
  className
}: FileUploadProps) {
  const hintId = useId();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted, rejected) => {
      if (rejected.length) {
        const codes = rejected.flatMap(file => file.errors.map(error => error.code));
        onFileRejected(codes.includes(ErrorCode.TooManyFiles) ? "Choose one photo at a time."
          : codes.includes(ErrorCode.FileTooLarge) ? TRACE_PHOTO_SIZE_ERROR : TRACE_PHOTO_FORMAT_ERROR);
      } else if (accepted.length === 1) onFileSelected(accepted[0]);
    },
    accept: TRACE_PHOTO_ACCEPT,
    maxSize: TRACE_PHOTO_MAX_BYTES,
    multiple: false,
  });

  return (
    <div
      {...getRootProps({ role: "button", "aria-label": "Choose a photo", "aria-describedby": hintId })}
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
        isDragActive ? "border-primary bg-primary/5" : "border-muted",
        className
      )}
    >
      <input {...getInputProps()} />
      <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden />
      <p className="text-lg font-medium">
        {isDragActive ? "Drop photo here" : "Choose a photo"}
      </p>
      <p id={hintId} className="text-sm text-muted-foreground mt-2">
        Choose a file, or drop a photo here. PNG, JPG, or WebP up to 10 MB.
        Photos stay on your device.
      </p>
    </div>
  );
}
