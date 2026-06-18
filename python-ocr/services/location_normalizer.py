from __future__ import annotations

import os
import re
from difflib import SequenceMatcher
from functools import lru_cache

from services.reference_loader import load_reference_workbook

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(ROOT_DIR, "data")
FIELDS = ("placeOfBirth", "issuingOffice")
COMMON_INDONESIAN_LOCATIONS = {
    "ACEH",
    "ACEH BARAT",
    "ACEH BARAT DAYA",
    "ACEH BESAR",
    "ACEH JAYA",
    "ACEH SELATAN",
    "ACEH SINGKIL",
    "ACEH TAMIANG",
    "ACEH TENGAH",
    "ACEH TENGGARA",
    "ACEH TIMUR",
    "ACEH UTARA",
    "AGAM",
    "ALOR",
    "AMBON",
    "AMUNTAI",
    "ASAHAN",
    "ASMAT",
    "BADUNG",
    "BALANGAN",
    "BALI",
    "BALIKPAPAN",
    "BANDA ACEH",
    "BANDAR LAMPUNG",
    "BANDUNG",
    "BANDUNG BARAT",
    "BANGGAI",
    "BANGGAI KEPULAUAN",
    "BANGGAI LAUT",
    "BANGKA",
    "BANGKA BARAT",
    "BANGKA SELATAN",
    "BANGKA TENGAH",
    "BANGKALAN",
    "BANGLI",
    "BANJAR",
    "BANJAR BARU",
    "BANJARBARU",
    "BANJARMASIN",
    "BANJARNEGARA",
    "BANTAENG",
    "BANTUL",
    "BANYU ASIN",
    "BANYUMAS",
    "BANYUWANGI",
    "BARABAI",
    "BARITO KUALA",
    "BARITO SELATAN",
    "BARITO TIMUR",
    "BARITO UTARA",
    "BARRU",
    "BATAM",
    "BATANG",
    "BATANG HARI",
    "BATU",
    "BATU AMPAR",
    "BATU BARA",
    "BATU REDI",
    "BAUBAU",
    "BEKASI",
    "BELITUNG",
    "BELITUNG TIMUR",
    "BELU",
    "BENER MERIAH",
    "BENGKALIS",
    "BENGKAYANG",
    "BENGKULU",
    "BENGKULU SELATAN",
    "BENGKULU TENGAH",
    "BENGKULU UTARA",
    "BERAU",
    "BIAK NUMFOR",
    "BIMA",
    "BINJAI",
    "BINTAN",
    "BIREUEN",
    "BITUNG",
    "BLITAR",
    "BLORA",
    "BOALEMO",
    "BOGOR",
    "BOJONEGORO",
    "BOLAANG MONGONDOW",
    "BOLAANG MONGONDOW SELATAN",
    "BOLAANG MONGONDOW TIMUR",
    "BOLAANG MONGONDOW UTARA",
    "BOMBANA",
    "BONDOWOSO",
    "BONE",
    "BONE BOLANGO",
    "BONTANG",
    "BOVEN DIGOEL",
    "BOYOLALI",
    "BREBES",
    "BUKITTINGGI",
    "BULELENG",
    "BULUKUMBA",
    "BULUNGAN",
    "BUNGO",
    "BUOL",
    "BURU",
    "BURU SELATAN",
    "BUTON",
    "BUTON SELATAN",
    "BUTON TENGAH",
    "BUTON UTARA",
    "CIAMIS",
    "CIANJUR",
    "CILACAP",
    "CILEGON",
    "CIMAHI",
    "CIREBON",
    "DAIRI",
    "DEIYAI",
    "DELI SERDANG",
    "DEMAK",
    "DENPASAR",
    "DEPOK",
    "DHARMASRAYA",
    "DOGIYAI",
    "DOMPU",
    "DONGGALA",
    "DUMAI",
    "EMPAT LAWANG",
    "ENDE",
    "ENREKANG",
    "FAK-FAK",
    "FLORES TIMUR",
    "GARUT",
    "GAYO LUES",
    "GIANYAR",
    "GORONTALO",
    "GORONTALO UTARA",
    "GOWA",
    "GRESIK",
    "GROBOGAN",
    "GUNUNG KIDUL",
    "GUNUNG MAS",
    "GUNUNGSITOLI",
    "HALMAHERA BARAT",
    "HALMAHERA SELATAN",
    "HALMAHERA TENGAH",
    "HALMAHERA TIMUR",
    "HALMAHERA UTARA",
    "HULU SUNGAI SELATAN",
    "HULU SUNGAI TENGAH",
    "HULU SUNGAI UTARA",
    "HUMBANG HASUNDUTAN",
    "INDRAGIRI HILIR",
    "INDRAGIRI HULU",
    "INDRAMAYU",
    "INTAN JAYA",
    "JAKARTA",
    "JAKARTA BARAT",
    "JAKARTA PUSAT",
    "JAKARTA SELATAN",
    "JAKARTA TIMUR",
    "JAKARTA UTARA",
    "JAMBI",
    "JAYAPURA",
    "JAYAWIJAYA",
    "JEMBER",
    "JEMBRANA",
    "JENEPONTO",
    "JEPARA",
    "JOMBANG",
    "KAIMANA",
    "KAMPAR",
    "KAPUAS",
    "KAPUAS HULU",
    "KARANG ASEM",
    "KARANGANYAR",
    "KARAWANG",
    "KARIMUN",
    "KARO",
    "KATINGAN",
    "KAUR",
    "KAYONG UTARA",
    "KEBUMEN",
    "KEDIRI",
    "KEEROM",
    "KENDAL",
    "KENDARI",
    "KEPAHIANG",
    "KEPULAUAN ANAMBAS",
    "KEPULAUAN ARU",
    "KEPULAUAN MENTAWAI",
    "KEPULAUAN MERANTI",
    "KEPULAUAN SANGIHE",
    "KEPULAUAN SELAYAR",
    "KEPULAUAN SERIBU",
    "KEPULAUAN SULA",
    "KEPULAUAN TALAUD",
    "KEPULAUAN YAPEN",
    "KERINCI",
    "KETAPANG",
    "KLATEN",
    "KLUNGKUNG",
    "KOLAKA",
    "KOLAKA TIMUR",
    "KOLAKA UTARA",
    "KONAWE",
    "KONAWE KEPULAUAN",
    "KONAWE SELATAN",
    "KONAWE UTARA",
    "KOTA BARU",
    "KOTA MOBAGU",
    "KOTABARU",
    "KOTAMOBAGU",
    "KOTAWARINGIN BARAT",
    "KOTAWARINGIN TIMUR",
    "KUANTAN SINGINGI",
    "KUBU RAYA",
    "KUDUS",
    "KULON PROGO",
    "KUNINGAN",
    "KUPANG",
    "KUTAI BARAT",
    "KUTAI KARTANEGARA",
    "KUTAI TIMUR",
    "LABUHAN BATU",
    "LABUHAN BATU SELATAN",
    "LABUHAN BATU UTARA",
    "LAHAT",
    "LAMANDAU",
    "LAMONGAN",
    "LAMPUNG",
    "LAMPUNG BARAT",
    "LAMPUNG SELATAN",
    "LAMPUNG TENGAH",
    "LAMPUNG TIMUR",
    "LAMPUNG UTARA",
    "LANDAK",
    "LANGKAT",
    "LANGSA",
    "LANNY JAYA",
    "LEBAK",
    "LEBONG",
    "LEMBATA",
    "LHOKSEUMAWE",
    "LIMA PULUH KOTA",
    "LINGGA",
    "LOMBOK BARAT",
    "LOMBOK TENGAH",
    "LOMBOK TIMUR",
    "LOMBOK UTARA",
    "LUBUK LINGGAU",
    "LUMAJANG",
    "LUWU",
    "LUWU TIMUR",
    "LUWU UTARA",
    "MADIUN",
    "MAGELANG",
    "MAGETAN",
    "MAHAKAM HULU",
    "MAJALENGKA",
    "MAJENE",
    "MAKASSAR",
    "MALAKA",
    "MALANG",
    "MALINAU",
    "MALUANG",
    "MALUKU BARAT DAYA",
    "MALUKU TENGAH",
    "MALUKU TENGGARA",
    "MALUKU TENGGARA BARAT",
    "MAMASA",
    "MAMBERAMO RAYA",
    "MAMBERAMO TENGAH",
    "MAMUJU",
    "MAMUJU TENGAH",
    "MAMUJU UTARA",
    "MANADO",
    "MANDAILING NATAL",
    "MANGGARAI",
    "MANGGARAI BARAT",
    "MANGGARAI TIMUR",
    "MANOKWARI",
    "MANOKWARI SELATAN",
    "MAPPI",
    "MAROS",
    "MARTAPURA",
    "MATARAM",
    "MAYBRAT",
    "MEDAN",
    "MELAWI",
    "MEMPAWAH",
    "MERANGIN",
    "MERAUKE",
    "MESUJI",
    "METRO",
    "MIMIKA",
    "MINAHASA",
    "MINAHASA SELATAN",
    "MINAHASA TENGGARA",
    "MINAHASA UTARA",
    "MOJOKERTO",
    "MOROWALI",
    "MOROWALI UTARA",
    "MUARA ENIM",
    "MUARO JAMBI",
    "MUKOMUKO",
    "MUNA",
    "MUNA BARAT",
    "MURUNG RAYA",
    "MUSI BANYU ASIN",
    "MUSI RAWAS",
    "MUSI RAWAS UTARA",
    "NABIRE",
    "NAGAN RAYA",
    "NAGEKEO",
    "NATUNA",
    "NDUGA",
    "NGADA",
    "NGANJUK",
    "NGAWI",
    "NIAS",
    "NIAS BARAT",
    "NIAS SELATAN",
    "NIAS UTARA",
    "NUNUKAN",
    "OGAN ILIR",
    "OGAN KOMERING ILIR",
    "OGAN KOMERING ULU",
    "OGAN KOMERING ULU SELATAN",
    "OGAN KOMERING ULU TIMUR",
    "PACITAN",
    "PADANG",
    "PADANG LAWAS",
    "PADANG LAWAS UTARA",
    "PADANG PANJANG",
    "PADANG PARIAMAN",
    "PADANG SIDEMPUAN",
    "PAGAR ALAM",
    "PAKPAK BHARAT",
    "PALANGKA RAYA",
    "PALANGKARAYA",
    "PALEMBANG",
    "PALOPO",
    "PALU",
    "PAMEKASAN",
    "PANDEGLANG",
    "PANGANDARAN",
    "PANGKAJENE DAN KEPULAUAN",
    "PANGKAL PINANG",
    "PANIAI",
    "PAREPARE",
    "PARIAMAN",
    "PARIGI MOUTONG",
    "PASAMAN",
    "PASAMAN BARAT",
    "PASER",
    "PASURUAN",
    "PATI",
    "PAYAKUMBUH",
    "PEGUNUNGAN ARFAK",
    "PEGUNUNGAN BINTANG",
    "PEKALONGAN",
    "PEKANBARU",
    "PELALAWAN",
    "PEMALANG",
    "PEMATANG SIANTAR",
    "PENAJAM PASER UTARA",
    "PENUKAL ABAB LEMATANG ILIR",
    "PESAWARAN",
    "PESISIR BARAT",
    "PESISIR SELATAN",
    "PIDIE",
    "PIDIE JAYA",
    "PINRANG",
    "POHUWATO",
    "POLEWALI MANDAR",
    "PONOROGO",
    "PONTIANAK",
    "POSO",
    "PRABUMULIH",
    "PRINGSEWU",
    "PROBOLINGGO",
    "PULANG PISAU",
    "PULAU MOROTAI",
    "PULAU TALIABU",
    "PUNCAK",
    "PUNCAK JAYA",
    "PURBALINGGA",
    "PURWAKARTA",
    "PURWOKERTO",
    "PURWOREJO",
    "RAJA AMPAT",
    "RANTAU",
    "REJANG LEBONG",
    "REMBANG",
    "ROKAN HILIR",
    "ROKAN HULU",
    "ROTE NDAO",
    "SABANG",
    "SABU RAIJUA",
    "SALATIGA",
    "SAMARINDA",
    "SAMBAS",
    "SAMOSIR",
    "SAMPANG",
    "SANGGAU",
    "SARMI",
    "SAROLANGUN",
    "SAWAH LUNTO",
    "SEKADAU",
    "SELUMA",
    "SEMARANG",
    "SERAM BAGIAN BARAT",
    "SERAM BAGIAN TIMUR",
    "SERANG",
    "SERDANG BEDAGAI",
    "SERUYAN",
    "SIAK",
    "SIAU TAGULANDANG BIARO",
    "SIBOLGA",
    "SIDENRENG RAPPANG",
    "SIDOARJO",
    "SIGI",
    "SIJUNJUNG",
    "SIKKA",
    "SIMALUNGUN",
    "SIMEULUE",
    "SINGKAWANG",
    "SINJAI",
    "SINTANG",
    "SITUBONDO",
    "SLEMAN",
    "SOLO",
    "SOLOK",
    "SOLOK SELATAN",
    "SOPPENG",
    "SORONG",
    "SORONG SELATAN",
    "SRAGEN",
    "SUBANG",
    "SUBULUSSALAM",
    "SUKABUMI",
    "SUKAMARA",
    "SUKOHARJO",
    "SULSEL",
    "SUMBA BARAT",
    "SUMBA BARAT DAYA",
    "SUMBA TENGAH",
    "SUMBA TIMUR",
    "SUMBAWA",
    "SUMBAWA BARAT",
    "SUMEDANG",
    "SUMENEP",
    "SUNGAI PENUH",
    "SUPIORI",
    "SURABAYA",
    "SURAKARTA",
    "TABALONG",
    "TABANAN",
    "TAKALAR",
    "TAMBRAUW",
    "TANA TIDUNG",
    "TANA TORAJA",
    "TANAH BUMBU",
    "TANAH DATAR",
    "TANAH KAMPUNG",
    "TANAH LAUT",
    "TANGERANG",
    "TANGERANG SELATAN",
    "TANGGAMUS",
    "TANJUNG",
    "TANJUNG BALAI",
    "TANJUNG JABUNG BARAT",
    "TANJUNG JABUNG TIMUR",
    "TANJUNG PINANG",
    "TANJUNG REDEB",
    "TAPANULI SELATAN",
    "TAPANULI TENGAH",
    "TAPANULI UTARA",
    "TAPIN",
    "TARAKAN",
    "TASIKMALAYA",
    "TEBING TINGGI",
    "TEBO",
    "TEGAL",
    "TELUK BAYUR",
    "TELUK BINTUNI",
    "TELUK WONDAMA",
    "TEMANGGUNG",
    "TERNATE",
    "TIDORE KEPULAUAN",
    "TIMOR TENGAH SELATAN",
    "TIMOR TENGAH UTARA",
    "TOBA SAMOSIR",
    "TOJO UNA-UNA",
    "TOLI-TOLI",
    "TOLIKARA",
    "TOMOHON",
    "TORAJA UTARA",
    "TRENGGALEK",
    "TUAL",
    "TUBAN",
    "TULANG BAWANG BARAT",
    "TULANGBAWANG",
    "TULUNGAGUNG",
    "UJUNG PANDANG",
    "WAJO",
    "WAKATOBI",
    "WAROPEN",
    "WAY KANAN",
    "WONOGIRI",
    "WONOSOBO",
    "YAHUKIMO",
    "YALIMO",
    "YOGYAKARTA",
}
BUILTINS = {
    "placeOfBirth": COMMON_INDONESIAN_LOCATIONS,
    "issuingOffice": COMMON_INDONESIAN_LOCATIONS
    | {"TANJUNG PRIOK", "TANJONG REDEB", "TANJUG REDEB", "TARAKAN"},
}
CANONICAL_ALIASES = {
    "placeOfBirth": {
        "BANJARMA SIN": "BANJARMASIN",
        "PALANGKARAYA": "PALANGKA RAYA",
        "PARE PARE": "PAREPARE",
    },
    "issuingOffice": {
        "BANJARMA SIN": "BANJARMASIN",
        "PALANGKA RAYA": "PALANGKARAYA",
        "PARE PARE": "PAREPARE",
        "TANJONG REDEB": "TANJUNG REDEB",
        "TANJUG REDEB": "TANJUNG REDEB",
    },
}


def normalize_location_value(field_name: str, value: str) -> str:
    return pick_best_location_value(field_name, [value])


def is_known_location_value(field_name: str, value: str) -> bool:
    return _canonical_value(field_name, _clean_text(value)) in _known_values(field_name)


def pick_best_location_value(field_name: str, candidates: list[str]) -> str:
    cleaned = [_canonical_value(field_name, _clean_text(value)) for value in candidates if _clean_text(value)]
    if not cleaned:
        return ""
    if field_name == "issuingOffice":
        specific_value = _pick_specific_issuing_office(cleaned)
        if specific_value:
            return specific_value
    vocabulary = _known_values(field_name)
    best_value = cleaned[0]
    best_score = -1.0
    for candidate in cleaned:
        score = float(cleaned.count(candidate)) * 18.0
        normalized, match_score = _best_vocabulary_match(candidate, vocabulary)
        if normalized:
            score += match_score
            if score > best_score:
                best_value, best_score = normalized, score
            continue
        if score > best_score:
            best_value, best_score = candidate, score
    if best_value in vocabulary:
        return best_value
    if field_name == "issuingOffice":
        return ""
    if len(best_value.replace(" ", "")) < 4:
        return ""
    return best_value if cleaned.count(best_value) > 1 else ""


def _pick_specific_issuing_office(candidates: list[str]) -> str:
    for candidate in candidates:
        for variant in _variants(candidate):
            compact = _compact(variant)
            if (
                "TANJUNGREDEB" in compact
                or "TANJUNGREDES" in compact
                or "TANJONGREDEB" in compact
                or "TANJUGREDEB" in compact
            ):
                return "TANJUNG REDEB"
            if "TANJ" in compact and compact.endswith(("REDEB", "REDES")):
                return "TANJUNG REDEB"
    return ""


def _best_vocabulary_match(candidate: str, vocabulary: set[str]) -> tuple[str, float]:
    best_value = ""
    best_score = 0.0
    for variant in _variants(candidate):
        compact = _compact(variant)
        if len(compact) < 4:
            continue
        for known in vocabulary:
            score = _score(compact, _compact(known))
            if score > best_score:
                best_value, best_score = known, score
    threshold = 86.0 if candidate.replace(" ", "").endswith("REDEB") else 82.0
    return (best_value, best_score) if best_value and best_score >= threshold else ("", 0.0)


@lru_cache(maxsize=1)
def _known_values(field_name: str) -> set[str]:
    values = {_canonical_value(field_name, value) for value in BUILTINS.get(field_name, set())}
    for root, _, files in os.walk(DATA_DIR):
        for file_name in files:
            if not file_name.lower().endswith(".xlsx"):
                continue
            try:
                rows = load_reference_workbook(os.path.join(root, file_name))
            except Exception:  # noqa: BLE001
                continue
            for row in rows:
                value = _canonical_value(field_name, _clean_text(row.get(field_name, "")))
                if value:
                    values.add(value)
    return values


def _score(candidate: str, known: str) -> float:
    if candidate == known:
        return 120.0
    if candidate in known and len(candidate) >= 5:
        return 102.0 + min(len(candidate), len(known))
    if known in candidate and len(known) >= 5:
        return 96.0 + min(len(candidate), len(known))
    return SequenceMatcher(None, candidate, known).ratio() * 100.0


def _variants(value: str) -> list[str]:
    variants = [value]
    compact = _compact(value)
    if compact and compact not in variants:
        variants.append(compact)
    if len(compact) >= 6:
        for offset in (1, 2, 3, 4):
            trimmed = compact[offset:]
            if trimmed not in variants:
                variants.append(trimmed)
    return variants


def _clean_text(value: str) -> str:
    digit_table = str.maketrans({"0": "O", "1": "I", "2": "Z", "3": "E", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B"})
    normalized = str(value or "").upper().translate(digit_table)
    normalized = re.sub(r"[^A-Z\s-]", " ", normalized)
    normalized = normalized.replace("-", " ")
    return re.sub(r"\s+", " ", normalized).strip()


def _canonical_value(field_name: str, value: str) -> str:
    return CANONICAL_ALIASES.get(field_name, {}).get(value, value)


def _compact(value: str) -> str:
    return re.sub(r"[^A-Z]", "", value.upper())
