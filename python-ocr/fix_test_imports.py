import re

def fix_imports(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # test_ocr_mode.py
    if 'test_ocr_mode.py' in filepath:
        content = content.replace('from main import _classify_ocr_mode, _ocr_mode_reasons', 'from services.scan_budget import _classify_ocr_mode, _ocr_mode_reasons')
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return

    # test_ocr_performance_guards.py
    if 'test_ocr_performance_guards.py' in filepath:
        replacements = [
            'from services.data_repairs import _apply_final_name_repairs, _apply_fast_date_repairs, _apply_fast_mrz_repairs, _apply_indonesian_visual_repairs, _apply_verified_mrz_name_repairs, _apply_verified_single_word_name, _repair_impossible_expiry_date',
            'from services.passport_logic import _can_infer_missing_issue_date, _missing_profile_visual_panel_fields, _missing_speed_location_panel_fields, _ocr_rotation_degrees, _pick_preferred_full_name, _select_balanced_visual_field_names, _select_heavy_visual_field_names, _select_panel_field_names, _select_profile_panel_field_names, _select_speed_visual_field_names, _select_visual_field_names, _should_run_initial_panel_scan, _should_refine_names, _should_skip_panel_for_direct_location_only, _should_try_recovery_location_ocr, _should_try_speed_location_ocr, _visual_fields_need_aligned_page',
            'from services.scan_budget import _build_budget_notes, _has_ocr_budget_for_elapsed, _is_balanced_scan, _is_heavy_scan, _is_speed_first_scan, _ocr_budget_ms, _ocr_profile'
        ]
        
        pattern = r'from main import \([\s\S]*?\)'
        content = re.sub(pattern, '\n'.join(replacements), content)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

fix_imports('tests/test_ocr_mode.py')
fix_imports('tests/test_ocr_performance_guards.py')

print('Fixed test imports')
