import re
import os

def replace_in_file(filepath, pattern, replacement):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    new_content = re.sub(pattern, replacement, content, flags=re.MULTILINE | re.DOTALL)
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

path_utils_import = 'from services.path_utils import normalize_filesystem_path as _normalize_filesystem_path\n\n'
path_utils_pattern = r'def _normalize_filesystem_path\(path: str\) -> str:.*?(?=\n\n|\Z)'
path_utils_pattern = r'def _normalize_filesystem_path\(path: str\) -> str:.*?return text\n'

# Fix path utils
replace_in_file('main.py', r'from services.pipeline_stages import \(', path_utils_import + r'from services.pipeline_stages import (')
replace_in_file('main.py', path_utils_pattern, '')

replace_in_file('scan_session.py', r'from services.image_preprocessor import', path_utils_import + r'from services.image_preprocessor import')
replace_in_file('scan_session.py', path_utils_pattern, '')

replace_in_file('services/nusuk_manifest.py', r'from services.transliterator import transliterate_name\n', r'from services.transliterator import transliterate_name\n' + path_utils_import)
replace_in_file('services/nusuk_manifest.py', path_utils_pattern, '')

# Fix mrz check
mrz_import = 'from services.mrz_validation import calculate_mrz_check_digit as _mrz_check_digit\n\n'
mrz_check_pattern = r'def _mrz_check_digit\(value: str\) -> str:.*?return str\(sum\(_mrz_char_value\(char\) \* \(7, 3, 1\)\[index % 3\] for index, char in enumerate\(value\)\) % 10\)\n'
mrz_char_pattern = r'def _mrz_char_value\(char: str\) -> int:.*?return 0 if char == "<" else int\(char\) if char.isdigit\(\) else ord\(char\) - 55\n'

replace_in_file('services/mrz_extractor.py', r'from services.ocr_runner import get_tesseract_config\n', r'from services.ocr_runner import get_tesseract_config\n' + mrz_import)
replace_in_file('services/mrz_extractor.py', mrz_check_pattern, '')
replace_in_file('services/mrz_extractor.py', mrz_char_pattern, '')

replace_in_file('services/parser.py', r'from services.mrz_extractor import MrzHint\n', r'from services.mrz_extractor import MrzHint\n' + mrz_import)
replace_in_file('services/parser.py', mrz_check_pattern, '')
replace_in_file('services/parser.py', mrz_char_pattern, '')

replace_in_file('services/panel_fallback.py', r'from services.passport_page import collect_ocr_lines, crop_relative\n', r'from services.passport_page import collect_ocr_lines, crop_relative\n' + mrz_import)
replace_in_file('services/panel_fallback.py', mrz_check_pattern, '')
replace_in_file('services/panel_fallback.py', mrz_char_pattern, '')

print("Done")
