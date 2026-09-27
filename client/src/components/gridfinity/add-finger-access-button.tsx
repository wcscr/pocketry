import { AddObjectButton } from "./add-object-button";
import { useAddFingerAccess } from "./use-add-finger-access";

/** Creates an independent finger access and opens its properties. */
export function AddFingerAccessButton({ label = "Add finger access", className, onAdd, testId = "button-add-finger-hole" }: {
  label?: string; className?: string; onAdd?: () => void; testId?: string;
}): JSX.Element {
  const addFingerAccess = useAddFingerAccess(onAdd);
  return <AddObjectButton className={className} data-testid={testId} onClick={addFingerAccess}>{label}</AddObjectButton>;
}
