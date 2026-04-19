import { useState, useRef, useEffect } from 'react';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export default function AddressSearch({ value, onChange, placeholder = 'Search NYC address...' }) {
  const [query, setQuery] = useState(value?.address || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (query.length < 3) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${NOMINATIM}?q=${encodeURIComponent(query + ' New York')}&format=json&addressdetails=1&limit=6&countrycodes=us`,
          { 
            headers: { 
              'Accept-Language': 'en',
              'User-Agent': 'NYC-War-Game (justinlapuff@gmail.com)'
            } 
          }
        );
        const data = await res.json();
        setResults(data);
      } catch { setResults([]); }
      setLoading(false);
    }, 400);
  }, [query]);

  function select(item) {
    const addr = item.address || {};
    const zipcode = addr.postcode || '';
    const city = addr.city || addr.town || addr.suburb || addr.county || 'New York';
    const address = item.display_name;
    setQuery(address);
    setResults([]);
    onChange({ city, address, zipcode, lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full border-3 border-black rounded-2xl px-4 py-3 text-sm font-medium bg-white focus:outline-none focus:bg-yellow-50 shadow-[3px_3px_0px_black]"
      />
      {loading && (
        <div className="absolute right-4 top-3 text-sm">⏳</div>
      )}
      {results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border-3 border-black rounded-2xl shadow-[5px_5px_0px_black] overflow-hidden">
          {results.map(item => (
            <li
              key={item.place_id}
              onClick={() => select(item)}
              className="px-4 py-3 text-sm cursor-pointer hover:bg-yellow-100 border-b border-gray-100 last:border-0 font-medium"
            >
              📍 {item.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}