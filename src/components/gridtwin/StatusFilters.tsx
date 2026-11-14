import { Checkbox } from "@/components/ui/checkbox";
import { statusLabels, type MapStatus, type StatusSelection } from "@/lib/gridtwin/map-status";

export function StatusFilters({ selected, onChange }: { selected: StatusSelection; onChange: (next: StatusSelection) => void }) {
  return <fieldset className="status-filters"><legend>Starea rețelei</legend>
    {(Object.entries(statusLabels) as [MapStatus, string][]).map(([key,label]) => <label key={key} className="status-filter">
      <Checkbox aria-label={label} checked={selected[key]} onCheckedChange={checked => onChange({ ...selected, [key]: checked === true })} />
      <span className={key}>{label}</span>
    </label>)}
  </fieldset>;
}