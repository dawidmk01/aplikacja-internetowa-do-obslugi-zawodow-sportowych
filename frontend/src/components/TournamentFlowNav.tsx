import { NavLink, useParams } from "react-router-dom";

type Step = {
  label: string;
  path: (id: string) => string;
};

const STEPS: Step[] = [
  { label: "Dane", path: (id) => `/tournaments/${id}/edit` },
  { label: "Setup", path: (id) => `/tournaments/${id}/setup` },
  { label: "Uczestnicy", path: (id) => `/tournaments/${id}/teams` },
  { label: "Mecze", path: (id) => `/tournaments/${id}/matches` },
  { label: "Harmonogram", path: (id) => `/tournaments/${id}/schedule` },
  { label: "Wyniki", path: (id) => `/tournaments/${id}/results` },
];

export default function TournamentFlowNav() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <nav style={{ margin: "1.5rem 0" }}>
      <ol style={{
        display: "flex",
        gap: "1rem",
        listStyle: "none",
        padding: 0,
        flexWrap: "wrap"
      }}>
        {STEPS.map((step, index) => (
          <li key={step.label}>
            <NavLink
              to={step.path(id)}
              style={({ isActive }) => ({
                padding: "0.35rem 0.6rem",
                borderRadius: 6,
                textDecoration: "none",
                fontWeight: isActive ? 700 : 400,
                background: isActive ? "#2a2a2a" : "transparent",
                color: "inherit",
                border: "1px solid #333",
              })}
            >
              {index + 1}. {step.label}
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
