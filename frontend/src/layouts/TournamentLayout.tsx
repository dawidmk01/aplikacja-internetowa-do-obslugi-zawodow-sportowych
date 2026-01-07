import { Outlet, useParams } from "react-router-dom";
import TournamentFlowNav from "../components/TournamentFlowNav";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";
import TournamentStepFooter from "../components/TournamentStepFooter";

export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <TournamentFlowGuardProvider>
      <div style={{ padding: "2rem", maxWidth: 900 }}>
        <TournamentFlowNav />
        <Outlet />
        <TournamentStepFooter />
      </div>
    </TournamentFlowGuardProvider>
  );
}
