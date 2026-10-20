import { useLocation } from 'react-router-dom';

/** Renders the current pathname so tests can assert on navigation. */
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

export default LocationProbe;
