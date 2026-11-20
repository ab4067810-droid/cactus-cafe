export const ISABELA_MUNICIPALITY = "Isabela";
export const NEGROS_OCCIDENTAL_PROVINCE = "Negros Occidental";
export const ISABELA_DELIVERY_MAP_CENTER = [10.2050, 122.9880];
export const ISABELA_DELIVERY_MAP_BOUNDS = [
  [10.1100, 122.9100],
  [10.2900, 123.1300],
];
export const ISABELA_OTHER_STREET_OPTION =
  "Other (Specify house number / street)";

export const isWithinIsabelaDeliveryBounds = (location) => {
  if (!location || typeof location !== "object") return false;

  const { lat, lng } = location;
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= ISABELA_DELIVERY_MAP_BOUNDS[0][0]
    && lat <= ISABELA_DELIVERY_MAP_BOUNDS[1][0]
    && lng >= ISABELA_DELIVERY_MAP_BOUNDS[0][1]
    && lng <= ISABELA_DELIVERY_MAP_BOUNDS[1][1];
};

export const ISABELA_BARANGAYS = [
  "Amin",
  "Banogbanog",
  "Bulad",
  "Bungahin",
  "Cabcab",
  "Camangcamang",
  "Camp Clark",
  "Cansalongon",
  "Guintubhan",
  "Libas",
  "Limalima",
  "Makilignit",
  "Mansablay",
  "Maytubig",
  "Panaquiao",
  "Barangay 1 (Poblacion)",
  "Barangay 2 (Poblacion)",
  "Barangay 3 (Poblacion)",
  "Barangay 4 (Poblacion)",
  "Barangay 5 (Poblacion)",
  "Barangay 6 (Poblacion)",
  "Barangay 7 (Poblacion)",
  "Barangay 8 (Poblacion)",
  "Barangay 9 (Poblacion)",
  "Riverside",
  "Rumirang",
  "San Agustin",
  "Sebucawan",
  "Sikatuna",
  "Tinongan",
];

// These user-provided examples are generic suggestions, not verified per-barangay data.
const POBLACION_STREET_OPTIONS = [
  "Rizal Street",
  "Bonifacio Street",
  "Burgos Street",
  "Mabini Street",
  "Gomez Street",
  "Zamora Street",
  "Lopez Jaena Street",
  "Aguinaldo Street",
  "Del Pilar Street",
  "Araneta Street",
  "Lacson Street",
  "Locsin Street",
  "Montilla Street",
  "Yulo Street",
  "Gonzaga Street",
  "Magallanes Street",
  "Sto. Niño Street",
  "San Isidro Street",
  "Purok 1",
  "Purok 2",
  "Purok 3",
  "Purok 4",
  "Purok 5",
  "Purok 6",
  "Purok 7",
];

const OUTLYING_BARANGAY_STREET_OPTIONS = [
  "Purok 1",
  "Purok 2",
  "Purok 3",
  "Purok 4",
  "Purok 5",
  "Purok 6",
  "Purok 7",
  "Barangay Proper",
  "National Highway",
];

export const ISABELA_STREETS_BY_BARANGAY = Object.fromEntries(
  ISABELA_BARANGAYS.map((barangay) => [
    barangay,
    [
      ...(barangay.endsWith("(Poblacion)")
        ? POBLACION_STREET_OPTIONS
        : OUTLYING_BARANGAY_STREET_OPTIONS),
      ISABELA_OTHER_STREET_OPTION,
    ],
  ]),
);
