import { createFileRoute } from "@tanstack/react-router";
import { PublicSharePage } from "@/components/public-share-page";

export const Route = createFileRoute("/share/$sessionId")({
  component: ShareSessionRoute,
  head: () => ({
    meta: [
      {
        title: "Shared transcript • gitinspect",
      },
      {
        content: "noindex,nofollow",
        name: "robots",
      },
    ],
  }),
});

function ShareSessionRoute() {
  const { sessionId } = Route.useParams();

  return <PublicSharePage sessionId={sessionId} />;
}
