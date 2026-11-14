import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, Map, Camera, Upload, Moon, Sun, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
const OperatorContext = createContext("");
export const useOperator = () => useContext(OperatorContext);
export function AppShell({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState("");
  const [name, setName] = useState("");
  const [ask, setAsk] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("gridtwin-operator");
    if (saved) setActor(saved);
    else setAsk(true);
    const theme = localStorage.getItem("gridtwin-theme") === "dark";
    setDark(theme);
    document.documentElement.classList.toggle("dark", theme);
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("gridtwin-theme", next ? "dark" : "light");
  }
  return (
    <OperatorContext.Provider value={actor}>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/birou" className="brand">
            <span className="brand-mark">
              <Activity />
            </span>
            GridTwin
          </Link>
          <nav className="header-nav">
            <Link to="/birou" activeProps={{ className: "active" }}>
              <Map />
              Birou
            </Link>
            <Link to="/teren" activeProps={{ className: "active" }}>
              <Camera />
              Teren
            </Link>
            <Link to="/import" activeProps={{ className: "active" }}>
              <Upload />
              Import
            </Link>
          </nav>
          <div className="header-right">
            <span className="live">Sincronizat</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title={dark ? "Mod luminos" : "Mod întunecat"}
              aria-label={dark ? "Mod luminos" : "Mod întunecat"}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setName(actor);
                setAsk(true);
              }}
              className="px-1"
              title="Schimbă operatorul"
            >
              <span className="avatar">
                {actor
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "OP"}
              </span>
              <span className="actor-name text-xs">{actor || "Operator"}</span>
            </Button>
          </div>
        </header>
        {children}
      </div>
      <Toaster position="top-center" richColors />
      {ask && (
        <div className="modal-shade">
          <form
            className="name-modal"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length < 2) return;
              localStorage.setItem("gridtwin-operator", name.trim());
              setActor(name.trim());
              setAsk(false);
            }}
          >
            <div className="brand">
              <span className="brand-mark">
                <Activity />
              </span>
              GridTwin
            </div>
            <h2>Cum te cheamă?</h2>
            <p>Numele tău va însoți deciziile și rapoartele din jurnal.</p>
            <label className="form-label" htmlFor="operator">
              Nume operator
            </label>
            <input
              autoFocus
              id="operator"
              className="form-control"
              placeholder="Nume și prenume"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
            <Button type="submit" disabled={name.trim().length < 2}>
              Intră în GridTwin <ArrowRight />
            </Button>
          </form>
        </div>
      )}
    </OperatorContext.Provider>
  );
}
