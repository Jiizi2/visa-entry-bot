from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.parser import parse_mrz_data


class ParserTests(unittest.TestCase):
    def test_prefers_explicit_mrz_lines_over_text_noise(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "A1234567<8IDN9001011M3001012<<<<<<<<<<<<<<04",
                "text": "NOTMRZ\nALSO NOISE",
            }
        )

        self.assertEqual(parsed["passportNumber"], "A1234567")
        self.assertEqual(parsed["dob"], "1990-01-01")
        self.assertEqual(parsed["expiryDate"], "2030-01-01")
        self.assertEqual(parsed["gender"], "MALE")

    def test_accepts_direct_ocr_line2_with_single_filler(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "line2": "E8710852<5IDN1906017M30010866403050106000214",
            }
        )

        self.assertEqual(parsed["firstName"], "KARIM ALFARIZI")
        self.assertEqual(parsed["familyName"], "RAMADAN")
        self.assertEqual(parsed["passportNumber"], "E8710852")
        self.assertEqual(parsed["nationality"], "INDONESIA")
        self.assertEqual(parsed["dob"], "2019-06-01")
        self.assertEqual(parsed["expiryDate"], "2030-01-08")
        self.assertEqual(parsed["gender"], "MALE")

    def test_repairs_line2_nationality_confusion_before_parsing(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "line2": "E8710852<51DN1906017L30010866403050106000214",
            }
        )

        self.assertEqual(parsed["nationality"], "INDONESIA")
        self.assertEqual(parsed["gender"], "MALE")

    def test_repairs_ion_country_confusion_before_parsing(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNDIANA<<RIKA<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "E2657423<310N8808073F33030231305034708000254",
            }
        )

        self.assertEqual(parsed["nationality"], "INDONESIA")

    def test_prefers_valid_line_document_over_shifted_passporteye_number(self) -> None:
        parsed = parse_mrz_data(
            {
                "number": "7E9229500",
                "line1": "P<IDNHAZIQ<<MUHAMMAD<FADIL<<<<<<<<<<<<<<<<<",
                "line2": "E9229500<3IDN0708270M35071086309062708000274",
            }
        )

        self.assertEqual(parsed["passportNumber"], "E9229500")

    def test_rejects_line2_without_any_valid_check_digit(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "A1234567<0IDN9001010M3001010<<<<<<<<<<<<<<04",
            }
        )

        self.assertEqual(parsed["passportNumber"], "")
        self.assertEqual(parsed["dob"], "")
        self.assertEqual(parsed["expiryDate"], "")

    def test_drops_direct_mrz_name_filler_tokens(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMAULIDDHAN<<RASYDDIQ<<<<<<<<<<<SKK6KKKK",
                "line2": "X4068853<1IDN1003031M29112056403050303000138",
            }
        )

        self.assertEqual(parsed["firstName"], "RASYDDIQ")
        self.assertEqual(parsed["familyName"], "MAULIDDHAN")

    def test_drops_k_dominant_name_filler_tokens(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNSALSAHBILLA<<MEYSI<<K<<<<<KKSKE<KEKKK<<",
                "line2": "X6724875<4IDN0305255F30111796403056505000282",
            }
        )

        self.assertEqual(parsed["firstName"], "MEYSI")
        self.assertEqual(parsed["familyName"], "SALSAHBILLA")

    def test_drops_short_k_filler_after_given_names(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNGIFARI<<MUHAMMAD<MUGNI<ZAR<<<<<<<<<KK<<",
                "line2": "X6724876<7IDN1003042M30111796403050403000168",
            }
        )

        self.assertEqual(parsed["firstName"], "MUHAMMAD MUGNI ZAR")
        self.assertEqual(parsed["familyName"], "GIFARI")

    def test_repairs_k_noise_in_indonesian_name_particles(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNFATIH<<ABDULLAH<KYAZID<KAL<<<<<<<<<<<<",
                "line2": "X4980079<4IDN2005113M30071473506151105000432",
            }
        )

        self.assertEqual(parsed["firstName"], "ABDULLAH KYAZID AL")
        self.assertEqual(parsed["familyName"], "FATIH")

    def test_preserves_real_name_ending_in_k_and_repairs_family_ocr_v_noise(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNHIDAYVAT<K<TAUFIK<<<<<<KK<K<SKSKKKSEKRK",
                "line2": "X6725075<9IDN8703237M35112666403052303000594",
            }
        )

        self.assertEqual(parsed["firstName"], "TAUFIK")
        self.assertEqual(parsed["familyName"], "HIDAYAT")

    def test_repairs_djumadi_prefix_confusion(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNYUSUF<<DIUMADI<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "E8710852<5IDN1906017M30010866403050106000214",
            }
        )

        self.assertEqual(parsed["firstName"], "DJUMADI")

    def test_repairs_noisy_k_name_separator_from_mrz_line1(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNGHAISAN<K<FAITH<<<<<<<S<SKKSKSKKRKSK<<<",
                "line2": "X6725077<5IDN1001015M30112617316020101000296",
            }
        )

        self.assertEqual(parsed["firstName"], "FAITH")
        self.assertEqual(parsed["familyName"], "GHAISAN")

    def test_repairs_noisy_direct_mrz_name_separator_and_fillers(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNGAFURSK<SARIFINSABAUSSSSSSSNSSNSSRNNSNN",
                "line2": "E3668886<1IDN6107255M33070546271032506000198",
            }
        )

        self.assertEqual(parsed["firstName"], "ARIFIN ABAU")
        self.assertEqual(parsed["familyName"], "GAFUR")

    def test_repairs_embedded_k_separator_in_given_name(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMAULANA<<RAYHANKARIFK<<<<<K<KKKKKKKKKKK",
                "line2": "X6725321<5IDN1101133M30121546403091301000102",
            }
        )

        self.assertEqual(parsed["firstName"], "RAYHAN ARIF")
        self.assertEqual(parsed["familyName"], "MAULANA")

    def test_embedded_k_separator_does_not_split_real_name_prefix(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNPUTRA<<MASKURDI<SKUNDA<<<<<<<<<K<66EEK6",
                "line2": "E2657415<2IDN8706179M33030231376031706000110",
            }
        )

        self.assertEqual(parsed["firstName"], "MASKURDI SKUNDA")
        self.assertEqual(parsed["familyName"], "PUTRA")

    def test_salvages_direct_mrz_given_names_embedded_in_family_segment(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNSAPUTRAK<KEAN<KWIJAYA<<<<K<<K<KKKKKKKKK",
                "line2": "X5605969<5IDN1112054M30042306403060512000158",
            }
        )

        self.assertEqual(parsed["firstName"], "KEAN WIJAYA")
        self.assertEqual(parsed["familyName"], "SAPUTRA")

    def test_salvages_direct_mrz_x_separator_and_k_ayu_noise(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNSAPUTRA<X<KIRANA<KAYU<K<<<<<<KKKSKEEEEK",
                "line2": "X5606246<8IDN1607037F30042493273214307000110",
            }
        )

        self.assertEqual(parsed["firstName"], "KIRANA AYU")
        self.assertEqual(parsed["familyName"], "SAPUTRA")

    def test_prefers_line_family_when_passporteye_shifts_given_name_into_surname(self) -> None:
        parsed = parse_mrz_data(
            {
                "raw_text": (
                    "P<IDNKURNIAWANK<ERWINK<<<<K<<KKKKKKKKKKKKKKKK\n"
                    "E6369752<61DN7404283M33120503277032804000994"
                ),
                "surname": "KURNIAWANK ERWINK",
                "names": "K KKKKK",
                "line2": "E6369752<6IDN7404283M33120503277032804000994",
            }
        )

        self.assertEqual(parsed["firstName"], "ERWIN")
        self.assertEqual(parsed["familyName"], "KURNIAWAN")

    def test_repairs_sp_prefix_and_cs_name_separator_noise(self) -> None:
        parsed = parse_mrz_data(
            {
                "raw_text": (
                    "SP<IDNSUDRAGAT<<ALSACSALSABILACS<<\n"
                    "<0051599<11DNO105020F270721132731"
                ),
                "line2": "<0051599<1IDN0105020F270721132731<<<<<<<<<<<",
            }
        )

        self.assertEqual(parsed["firstName"], "ALSA SALSABILA")
        self.assertEqual(parsed["familyName"], "SUDRAJAT")

    def test_repairs_missing_indonesia_prefix_before_family_initial(self) -> None:
        parsed = parse_mrz_data(
            {
                "raw_text": (
                    "P<DNBUSTOMI<<ADEN<<<<<<<<<<6<<<<6666SKKSEKKK\n"
                    "X5218457<910N9403316M30031163201013103000552"
                ),
                "line2": "X5218457<9IDN9403316M30031163201013103000552",
            }
        )

        self.assertEqual(parsed["firstName"], "ADEN")
        self.assertEqual(parsed["familyName"], "BUSTOMI")

    def test_does_not_split_real_family_name_with_embedded_k(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMARNIKASARI<<GITA<K<<<<<<6<6666666E0666",
                "line2": "X7506205<2IDN6703093F35102473273144903000668",
            }
        )

        self.assertEqual(parsed["firstName"], "GITA")
        self.assertEqual(parsed["familyName"], "MARNIKASARI")

    def test_uses_repaired_explicit_line2_with_raw_line1(self) -> None:
        parsed = parse_mrz_data(
            {
                "raw_text": (
                    "P<IDNHAZIQ<<MUHAMMAD<FADIL<<<<<<<<<K<KKKKKKK\n"
                    "7E9229500<31DNO708270M35071086309062708000270"
                ),
                "line2": "E9229500<3IDN0708270M35071086309062708000270",
                "sex": "O",
            }
        )

        self.assertEqual(parsed["firstName"], "MUHAMMAD FADIL")
        self.assertEqual(parsed["familyName"], "HAZIQ")
        self.assertEqual(parsed["gender"], "MALE")

    def test_noisy_k_name_separator_does_not_break_single_word_name(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMARGONO<K<<<<<<<<KK<KKKKKKKKKKKKKKKKKKK",
                "line2": "X6725059<7IDN6312154M30112616403051512000360",
            }
        )

        self.assertEqual(parsed["firstName"], "")
        self.assertEqual(parsed["familyName"], "MARGONO")

    def test_single_name_line_ignores_single_separator_filler(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNPURWANTO<K<<<<<<<<KKKKKKKEKKKKKEKKKKKKK",
                "line2": "X6725279<3IDN8005300M30121106403093005000680",
            }
        )

        self.assertEqual(parsed["firstName"], "")
        self.assertEqual(parsed["familyName"], "PURWANTO")


if __name__ == "__main__":
    unittest.main()
