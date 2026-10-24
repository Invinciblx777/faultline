import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Nothing here" action={<LinkButton href="/projects">Go to projects</LinkButton>}>
      The project or scan does not exist, or it was deleted.
    </EmptyState>
  );
}
