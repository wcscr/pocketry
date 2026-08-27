import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";

interface FileUploadProps {
  onFileSelected: (file: File) => void;
  accept?: Record<string, string[]>;
  className?: string;
}

export function FileUpload({
  onFileSelected,
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg']
  },
  className
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileSelected(acceptedFiles[0]);
    }
  }, [onFileSelected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple: false
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
        isDragActive ? "border-primary bg-primary/5" : "border-muted",
        className
      )}
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={() => setIsDragging(false)}
    >
      <input {...getInputProps()} />
      <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
      <p className="text-lg font-medium">
        {isDragging ? "Drop image here" : "Drag & drop an image here"}
      </p>
      <p className="text-sm text-muted-foreground mt-2">
        or click to select a file
      </p>
    </div>
  );
}
