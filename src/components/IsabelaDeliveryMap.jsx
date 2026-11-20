import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIconRetina from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import {
  ISABELA_BARANGAYS,
  ISABELA_DELIVERY_MAP_BOUNDS,
  ISABELA_DELIVERY_MAP_CENTER,
  isWithinIsabelaDeliveryBounds,
} from "../constants/isabelaAddress";
import {
  normalizeBarangayName,
} from "../utils/deliveryScope.js";
import "leaflet/dist/leaflet.css";
import "../styles/IsabelaDeliveryMap.css";

const isabelaBounds = L.latLngBounds(ISABELA_DELIVERY_MAP_BOUNDS);
const deliveryPinIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const OUTSIDE_ISABELA_MESSAGE =
  "Choose a delivery location within Isabela, Negros Occidental.";
const BARANGAY_NOT_FOUND_MESSAGE =
  "Barangay not found in the available options. Please check the spelling or choose from the list.";

// Approximate map anchors only; the draggable pin remains the precise delivery location.
const BARANGAY_MAP_POINTS = {
  Amin: [10.2199781, 123.0719939],
  Banogbanog: [10.1808262, 123.1086581],
  Bulad: [10.2548254, 122.9983657],
  Bungahin: [10.2517802, 123.0205784],
  Cabcab: [10.2109536, 123.067529],
  Camangcamang: [10.1795878, 122.9865669],
  "Camp Clark": [10.2292185, 123.0756171],
  Cansalongon: [10.1638321, 123.0055881],
  Guintubhan: [10.2073225, 122.9613313],
  Libas: [10.2302926, 123.0874747],
  Limalima: [10.1887008, 123.0794227],
  Makilignit: [10.1716769, 123.0780014],
  Mansablay: [10.1864897, 123.0137235],
  Maytubig: [10.2048826, 123.0223723],
  Panaquiao: [10.2436283, 123.0288219],
  "Barangay 1 (Poblacion)": [10.205, 122.9871],
  "Barangay 2 (Poblacion)": [10.204, 122.9874],
  "Barangay 3 (Poblacion)": [10.2035, 122.989],
  "Barangay 4 (Poblacion)": [10.2055615, 122.9884443],
  "Barangay 5 (Poblacion)": [10.2065, 122.9879],
  "Barangay 6 (Poblacion)": [10.2062, 122.9893],
  "Barangay 7 (Poblacion)": [10.2044, 122.9914],
  "Barangay 8 (Poblacion)": [10.2034, 122.9926],
  "Barangay 9 (Poblacion)": [10.202595, 122.9948489],
  Riverside: [10.1749223, 123.0544182],
  Rumirang: [10.2177056, 122.9694656],
  "San Agustin": [10.218179, 123.0461158],
  Sebucawan: [10.2154508, 123.1163666],
  Sikatuna: [10.1879159, 123.1286323],
  Tinongan: [10.2141477, 123.0319305],
};

const getBarangayCoordinates = (barangay) => {
  const mapBarangay = Object.keys(BARANGAY_MAP_POINTS).find(
    (name) => normalizeBarangayName(name) === normalizeBarangayName(barangay),
  );
  return mapBarangay ? BARANGAY_MAP_POINTS[mapBarangay] : null;
};

function MapClickHandler({ onPickLocation, onOutsideIsabela }) {
  useMapEvents({
    click(event) {
      if (!isWithinIsabelaDeliveryBounds(event.latlng)) {
        onOutsideIsabela();
        return;
      }

      onPickLocation(event.latlng);
    },
  });

  return null;
}

function RecenterMap({ location, focusTarget }) {
  const map = useMap();
  const lastFocusId = useRef(null);
  const latitude = location?.lat;
  const longitude = location?.lng;

  useEffect(() => {
    if (focusTarget) {
      if (focusTarget.id !== lastFocusId.current) {
        lastFocusId.current = focusTarget.id;
        map.flyTo(
          [focusTarget.lat, focusTarget.lng],
          focusTarget.zoom,
          { animate: true, duration: 0.8 },
        );
      }

      return;
    }

    const target = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lng: longitude }
      : {
        lat: ISABELA_DELIVERY_MAP_CENTER[0],
        lng: ISABELA_DELIVERY_MAP_CENTER[1],
      };
    map.panTo([target.lat, target.lng], { animate: true });
  }, [focusTarget, latitude, longitude, map]);

  return null;
}

function DeliveryMarker({ location, onPickLocation, onOutsideIsabela }) {
  return (
    <Marker
      position={[location.lat, location.lng]}
      draggable
      icon={deliveryPinIcon}
      eventHandlers={{
        dragend(event) {
          const marker = event.target;
          const nextLocation = marker.getLatLng();

          if (!isWithinIsabelaDeliveryBounds(nextLocation)) {
            marker.setLatLng([location.lat, location.lng]);
            onOutsideIsabela();
            return;
          }

          onPickLocation(nextLocation);
        },
      }}
    />
  );
}

export default function IsabelaDeliveryMap({
  location,
  onChange,
  selectedBarangay = "",
  barangays = ISABELA_BARANGAYS,
}) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [barangayQuery, setBarangayQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [focusTarget, setFocusTarget] = useState(null);
  const focusSequence = useRef(0);
  const lastSyncedBarangay = useRef("");
  const onChangeRef = useRef(onChange);
  const pinnedLocation = isWithinIsabelaDeliveryBounds(location)
    ? location
    : null;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const focusMap = (coordinates, zoom) => {
    focusSequence.current += 1;
    setFocusTarget({
      id: focusSequence.current,
      lat: coordinates[0],
      lng: coordinates[1],
      zoom,
    });
  };

  const pickLocation = (nextLocation) => {
    if (!isWithinIsabelaDeliveryBounds(nextLocation)) {
      setMessage(OUTSIDE_ISABELA_MESSAGE);
      return;
    }

    onChange({
      lat: nextLocation.lat,
      lng: nextLocation.lng,
    });
    setFocusTarget(null);
    setMessage("");
  };

  const selectBarangay = (barangay) => {
    const coordinates = getBarangayCoordinates(barangay);
    if (!coordinates) {
      setSearchMessage(BARANGAY_NOT_FOUND_MESSAGE);
      focusMap(ISABELA_DELIVERY_MAP_CENTER, 14);
      return;
    }

    setBarangayQuery(barangay);
    setSearchMessage("");
    setMessage("");
    pickLocation({ lat: coordinates[0], lng: coordinates[1] });
    focusMap(coordinates, 16);
  };

  // Reflect checkout's selected barangay in the local search and map state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const normalizedSelection = normalizeBarangayName(selectedBarangay);
    if (!normalizedSelection) {
      lastSyncedBarangay.current = "";
      setBarangayQuery("");
      setSearchMessage("");
      return;
    }

    const matchingBarangay = barangays.find(
      (barangay) => (
        normalizeBarangayName(barangay) === normalizedSelection
      ),
    );
    if (!matchingBarangay) {
      lastSyncedBarangay.current = "";
      setBarangayQuery("");
      return;
    }

    setBarangayQuery(selectedBarangay);
    if (lastSyncedBarangay.current === normalizedSelection) return;
    lastSyncedBarangay.current = normalizedSelection;

    const coordinates = getBarangayCoordinates(matchingBarangay);
    if (!coordinates) {
      setSearchMessage(BARANGAY_NOT_FOUND_MESSAGE);
      return;
    }

    setSearchMessage("");
    setMessage("");
    onChangeRef.current({
      lat: coordinates[0],
      lng: coordinates[1],
    });
    focusSequence.current += 1;
    setFocusTarget({
      id: focusSequence.current,
      lat: coordinates[0],
      lng: coordinates[1],
      zoom: 16,
    });
  }, [barangays, selectedBarangay]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleBarangaySearchChange = (event) => {
    const query = event.target.value;
    const normalizedQuery = normalizeBarangayName(query);
    setBarangayQuery(query);
    setSearchMessage("");

    if (!normalizedQuery) return;

    const exactMatch = barangays.find(
      (barangay) => normalizeBarangayName(barangay) === normalizedQuery,
    );
    if (exactMatch) {
      selectBarangay(exactMatch);
      return;
    }

    const matchingBarangays = barangays.filter((barangay) =>
      normalizeBarangayName(barangay).includes(normalizedQuery),
    );
    if (matchingBarangays.length === 0) {
      setSearchMessage(BARANGAY_NOT_FOUND_MESSAGE);
      focusMap(ISABELA_DELIVERY_MAP_CENTER, 14);
    }
  };

  const handleBarangaySearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const normalizedQuery = normalizeBarangayName(barangayQuery);
    const exactMatch = barangays.find(
      (barangay) => normalizeBarangayName(barangay) === normalizedQuery,
    );
    if (exactMatch) {
      selectBarangay(exactMatch);
      return;
    }

    const matchingBarangays = barangays.filter((barangay) =>
      normalizeBarangayName(barangay).includes(normalizedQuery),
    );
    if (matchingBarangays.length === 1) {
      selectBarangay(matchingBarangays[0]);
    } else if (matchingBarangays.length > 1) {
      setSearchMessage(
        "Several barangays match. Choose the full barangay name from the list.",
      );
      focusMap(ISABELA_DELIVERY_MAP_CENTER, 14);
    } else {
      setSearchMessage(BARANGAY_NOT_FOUND_MESSAGE);
      focusMap(ISABELA_DELIVERY_MAP_CENTER, 14);
    }
  };

  const rejectOutsideLocation = () => {
    setMessage(OUTSIDE_ISABELA_MESSAGE);
  };

  const useCurrentLocation = () => {
    setMessage("");

    if (!navigator.geolocation) {
      setMessage("Location access is unavailable in this browser.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        pickLocation({ lat: coords.latitude, lng: coords.longitude });
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setMessage("Allow location access in your browser, or place the pin manually.");
        } else if (error.code === error.TIMEOUT) {
          setMessage("We could not get your location in time. Try again or place the pin manually.");
        } else {
          setMessage("Unable to get your location. Place the pin manually instead.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  const clearLocation = () => {
    onChange(null);
    setBarangayQuery("");
    setSearchMessage("");
    setFocusTarget(null);
    setMessage("");
  };

  return (
    <section className="isabela-delivery-map" aria-label="Delivery pin map">
      <p className="isabela-delivery-map-help">
        Click the map or drag the pin to your delivery location in Isabela.
      </p>
      <div className="isabela-delivery-map-search">
        <label htmlFor="isabela-barangay-search">
          Search Isabela barangay
        </label>
        <input
          id="isabela-barangay-search"
          type="search"
          list="isabela-barangay-options"
          value={barangayQuery}
          onChange={handleBarangaySearchChange}
          onKeyDown={handleBarangaySearchKeyDown}
          placeholder="e.g., Camangcamang, Barangay 1 Poblacion"
          aria-invalid={Boolean(searchMessage)}
          aria-describedby={
            searchMessage ? "isabela-barangay-search-message" : undefined
          }
          autoComplete="off"
        />
        <datalist id="isabela-barangay-options">
          {barangays.map((barangay) => (
            <option value={barangay} key={barangay} />
          ))}
        </datalist>
        {searchMessage && (
          <p
            className="isabela-delivery-map-search-message"
            id="isabela-barangay-search-message"
            role="alert"
          >
            {searchMessage}
          </p>
        )}
      </div>
      <div className="isabela-delivery-map-canvas">
        <MapContainer
          center={ISABELA_DELIVERY_MAP_CENTER}
          zoom={14}
          minZoom={12}
          maxBounds={isabelaBounds}
          maxBoundsViscosity={1.0}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler
            onPickLocation={pickLocation}
            onOutsideIsabela={rejectOutsideLocation}
          />
          <RecenterMap
            location={pinnedLocation}
            focusTarget={focusTarget}
          />
          {pinnedLocation && (
            <DeliveryMarker
              location={pinnedLocation}
              onPickLocation={pickLocation}
              onOutsideIsabela={rejectOutsideLocation}
            />
          )}
        </MapContainer>
      </div>
      <div className="isabela-delivery-map-controls">
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
        >
          {locating ? "Finding location..." : "Use my current location"}
        </button>
        <button
          type="button"
          onClick={clearLocation}
          disabled={!pinnedLocation}
        >
          Clear pin
        </button>
      </div>
      <p className="isabela-delivery-map-coordinates" aria-live="polite">
        {pinnedLocation
          ? `Pinned: ${pinnedLocation.lat.toFixed(4)}, ${pinnedLocation.lng.toFixed(4)}`
          : "No delivery pin selected."}
      </p>
      {message && (
        <p className="isabela-delivery-map-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
