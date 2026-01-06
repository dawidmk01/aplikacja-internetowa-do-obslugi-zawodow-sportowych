import { Outlet, useParams } from "react-router-dom";
import TournamentFlowNav from "../components/TournamentFlowNav";

export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      {/* Tu może być tytuł turnieju w przyszłości */}
      <TournamentFlowNav />

      {/* Strony kroku */}
      <Outlet />
    </div>
  );
}
