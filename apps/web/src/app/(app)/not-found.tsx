import { SearchX } from "lucide-react";
import { EmptyState } from "@/design/components/empty-state";
import { LinkButton } from "@/design/components";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Nothing here" action={<LinkButton href="/projects">Go to projects</LinkButton>}>
      The project or scan does not exist, or it was deleted.
    </EmptyState>
  );
}
