import { useParams } from "react-router-dom";

export default function TournamentDetail() {
  const { id } = useParams();

  return (
    <div>
      <h1>Szczegóły turnieju</h1>
      <p>ID turnieju: {id}</p>
    </div>
  );
}
