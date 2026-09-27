import { useEffect, useState, type KeyboardEvent } from 'react';
import { getSearchLocationsQueryKey, useSearchLocations } from '@workspace/api-client-react';

export type LocationValue = {
  city: string;
  state: string;
  country: string;
  location_manual: boolean;
};

type Props = {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
};

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = Array.from({ length: 26 * 26 }, (_, index) => {
  const code = String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26);
  return { code, name: countryNames.of(code) ?? code };
}).filter(({ code, name }) => name !== code && name !== 'Unknown Region')
  .sort((a, b) => a.name.localeCompare(b.name));

export function LocationPicker({ value, onChange }: Props) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (value.location_manual || value.country || value.city.trim().length < 2) {
      setTerm('');
      return;
    }
    const timer = window.setTimeout(() => setTerm(value.city.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [value.city, value.country, value.location_manual]);

  const params = { query: term };
  const search = useSearchLocations(params, {
    query: {
      queryKey: getSearchLocationsQueryKey(params),
      enabled: term.length >= 2 && !value.country && !value.location_manual,
      staleTime: 5 * 60_000,
      retry: false,
    },
  });
  const current = term.toLocaleLowerCase() === value.city.trim().toLocaleLowerCase();
  const locations = current ? search.data?.locations ?? [] : [];
  const showList = open && !value.location_manual && !value.country && term.length >= 2 && current && locations.length > 0;

  function select(index: number) {
    const location = locations[index];
    if (!location) return;
    onChange({ city: location.city, state: location.region, country: location.country_code, location_manual: false });
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (!showList) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(index => (index + 1) % locations.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => index <= 0 ? locations.length - 1 : index - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      select(active);
    }
  }

  const countryName = value.country ? countryNames.of(value.country) ?? value.country : '';

  return <div className="fm-location" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {value.location_manual ? <>
      <div className="fm-field">
        <label htmlFor="city" className="fm-label">City</label>
        <input id="city" data-testid="input-city" className="fm-input" value={value.city}
          onChange={event => onChange({ ...value, city: event.target.value })} autoComplete="address-level2" required />
      </div>
      <div className="fm-location-grid">
        <div className="fm-field">
          <label htmlFor="state" className="fm-label">Region / State <span className="fm-small">· optional</span></label>
          <input id="state" data-testid="input-state" className="fm-input" value={value.state}
            onChange={event => onChange({ ...value, state: event.target.value })} autoComplete="address-level1" />
        </div>
        <div className="fm-field">
          <label htmlFor="country" className="fm-label">Country</label>
          <select id="country" data-testid="input-country" className="fm-input" value={value.country}
            onChange={event => onChange({ ...value, country: event.target.value })} autoComplete="country" required>
            <option value="">Select country</option>
            {countries.map(({ code, name }) => <option value={code} key={code}>{name}</option>)}
          </select>
        </div>
      </div>
      <button type="button" className="fm-location-switch" data-testid="button-search-city" onClick={() => {
        onChange({ ...value, state: '', country: '', location_manual: false });
        setOpen(true);
      }}>Search for a city instead</button>
    </> : <>
      <div className="fm-field fm-location-search">
        <label htmlFor="city" className="fm-label">City</label>
        <div className="fm-location-box">
        <input id="city" data-testid="input-city" className="fm-input" value={value.city}
          onChange={event => {
            onChange({ city: event.target.value, state: '', country: '', location_manual: false });
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)} onKeyDown={handleKeyDown} autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={showList}
          aria-controls={showList ? 'city-location-options' : undefined}
          aria-activedescendant={showList && active >= 0 ? `city-location-option-${active}` : undefined}
          placeholder="Start typing your city" required />
        {showList && <ul id="city-location-options" className="fm-location-results" role="listbox" aria-label="Matching cities">
          {locations.map((location, index) => <li key={`${location.city}-${location.region}-${location.country_code}-${index}`}
            id={`city-location-option-${index}`} role="option" aria-selected={index === active}
            className={index === active ? 'active' : ''} data-testid={`option-location-${index}`}
            onPointerDown={event => { event.preventDefault(); select(index); }} onClick={() => select(index)}>
            <strong>{location.city}</strong><span>{[location.region, location.country].filter(Boolean).join(', ')}</span>
          </li>)}
        </ul>}
        </div>
        {!value.country && value.city.trim().length >= 2 && (
          <p className="fm-small" role="status" data-testid="status-city-search">
            {!current || search.isFetching ? 'Searching cities…' : search.isError ? 'City search is unavailable right now. You can enter your location manually.' :
              locations.length === 0 ? 'No matching cities found. Try a different spelling or enter it manually.' : 'Choose a city from the suggestions to fill in its region and country.'}
          </p>
        )}
      </div>
      <div className="fm-location-grid">
        <div className="fm-field">
          <label htmlFor="state" className="fm-label">Region / State</label>
          <input id="state" data-testid="input-state" className="fm-input" value={value.state}
            readOnly placeholder="Filled when you choose a city" />
        </div>
        <div className="fm-field">
          <label htmlFor="country" className="fm-label">Country</label>
          <input id="country" data-testid="input-country" className="fm-input" value={countryName}
            readOnly placeholder="Filled when you choose a city" />
        </div>
      </div>
      <button type="button" className="fm-location-switch" data-testid="button-manual-location" onClick={() => {
        onChange({ ...value, state: '', country: '', location_manual: true });
        setOpen(false);
      }}>Can’t find your city? Enter it manually</button>
    </>}
  </div>;
}